import type { AgencyClient, DraftAttempt } from '../types/agency'
import { syncToSupabase } from './remoteSync'

const STORAGE_KEY = 'ai-ops:agency-clients'

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}

const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

function readAll(): AgencyClient[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(clients: AgencyClient[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clients))
  } catch {
    // localStorage 사용 불가 시 조용히 무시
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return toIsoDate(d)
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}

function daysBetween(fromIso: string, toIsoStr: string): number {
  const from = new Date(`${fromIso}T00:00:00`)
  const to = new Date(`${toIsoStr}T00:00:00`)
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

export function listClients(): AgencyClient[] {
  return readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function getClient(id: string): AgencyClient | undefined {
  return readAll().find((c) => c.id === id)
}

export function createClient(params: {
  name: string
  business: string
  persona: string
  threadUrl: string
  startDate?: string
  monthlyFeeKrw?: number
  referenceImageIds?: string[]
}): AgencyClient {
  const startDate = params.startDate ?? toIsoDate(new Date())
  const now = new Date().toISOString()
  const client: AgencyClient = {
    id: makeId(),
    name: params.name,
    business: params.business,
    persona: params.persona,
    threadUrl: params.threadUrl,
    memo: '',
    status: 'active',
    startDate,
    endDate: addMonths(startDate, 1),
    monthlyFeeKrw: params.monthlyFeeKrw,
    history: [{ date: now, type: 'start', note: `계약 시작 ${startDate}` }],
    todayDrafts: [],
    recentDraftTexts: [],
    referenceImageIds: params.referenceImageIds ?? [],
    createdAt: now,
  }
  writeAll([...readAll(), client])
  syncToSupabase('agency_clients', client)
  return client
}

function updateClient(
  id: string,
  updater: (client: AgencyClient) => AgencyClient,
): AgencyClient | undefined {
  const clients = readAll()
  const idx = clients.findIndex((c) => c.id === id)
  if (idx === -1) return undefined
  clients[idx] = updater(clients[idx])
  writeAll(clients)
  return clients[idx]
}

export function extendClient(id: string): AgencyClient | undefined {
  const now = new Date().toISOString()
  const result = updateClient(id, (c) => ({
    ...c,
    endDate: addMonths(c.endDate, 1),
    history: [
      ...c.history,
      { date: now, type: 'extend', note: '1개월 연장' },
    ],
  }))
  if (result) syncToSupabase('agency_clients', result)
  return result
}

export function pauseClient(id: string): AgencyClient | undefined {
  const now = new Date().toISOString()
  const today = toIsoDate(new Date())
  const result = updateClient(id, (c) => ({
    ...c,
    status: 'paused',
    pausedAt: today,
    history: [...c.history, { date: now, type: 'pause', note: '일시중단' }],
  }))
  if (result) syncToSupabase('agency_clients', result)
  return result
}

export function resumeClient(id: string): AgencyClient | undefined {
  const now = new Date().toISOString()
  const today = toIsoDate(new Date())
  const result = updateClient(id, (c) => {
    const pausedDays = c.pausedAt ? daysBetween(c.pausedAt, today) : 0
    return {
      ...c,
      status: 'active',
      pausedAt: undefined,
      endDate: addDays(c.endDate, Math.max(0, pausedDays)),
      history: [
        ...c.history,
        {
          date: now,
          type: 'resume',
          note: `재개 (정지 ${pausedDays}일 → 종료일 순연)`,
        },
      ],
    }
  })
  if (result) syncToSupabase('agency_clients', result)
  return result
}

export function saveMemo(id: string, memo: string): AgencyClient | undefined {
  const result = updateClient(id, (c) => ({ ...c, memo }))
  if (result) syncToSupabase('agency_clients', result)
  return result
}

export function saveReferenceImages(
  id: string,
  referenceImageIds: string[],
): AgencyClient | undefined {
  const result = updateClient(id, (c) => ({ ...c, referenceImageIds }))
  if (result) syncToSupabase('agency_clients', result)
  return result
}

const MAX_RECENT_DRAFTS = 30

export function saveTodayDrafts(
  id: string,
  drafts: DraftAttempt[],
): AgencyClient | undefined {
  const result = updateClient(id, (c) => ({
    ...c,
    todayDrafts: drafts,
    todayDraftsDate: toIsoDate(new Date()),
    recentDraftTexts: [
      ...drafts.map((d) => d.draft.text),
      ...c.recentDraftTexts,
    ].slice(0, MAX_RECENT_DRAFTS),
  }))
  if (result) syncToSupabase('agency_clients', result)
  return result
}

export function deleteClient(id: string): void {
  writeAll(readAll().filter((c) => c.id !== id))
}

function fromSupabaseRow(row: Record<string, unknown>): AgencyClient {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    business: String(row.business ?? ''),
    persona: String(row.persona ?? ''),
    threadUrl: String(row.thread_url ?? ''),
    memo: String(row.memo ?? ''),
    status: row.status === 'paused' ? 'paused' : 'active',
    startDate: String(row.start_date ?? ''),
    endDate: String(row.end_date ?? ''),
    pausedAt: typeof row.paused_at === 'string' ? row.paused_at : undefined,
    monthlyFeeKrw: typeof row.monthly_fee_krw === 'number' ? row.monthly_fee_krw : undefined,
    history: Array.isArray(row.history) ? (row.history as AgencyClient['history']) : [],
    todayDrafts: Array.isArray(row.today_drafts) ? (row.today_drafts as DraftAttempt[]) : [],
    todayDraftsDate: typeof row.today_drafts_date === 'string' ? row.today_drafts_date : undefined,
    recentDraftTexts: Array.isArray(row.recent_draft_texts)
      ? (row.recent_draft_texts as string[])
      : [],
    referenceImageIds: Array.isArray(row.reference_image_ids)
      ? (row.reference_image_ids as string[])
      : [],
    createdAt: String(row.created_at ?? ''),
  }
}

// 크론(api/cron/agency.ts)이 매일 아침 서버에서 직접 초안을 생성해 Supabase에
// 저장한다 — 이 함수는 화면 진입 시 그 결과를 로컬로 끌어와 병합한다(원격에
// 있는 클라이언트가 우선, 로컬에만 있고 아직 동기화 안 된 것은 그대로 유지).
export async function syncClientsFromSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agency_clients?select=*`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
    if (!res.ok) return
    const rows = (await res.json()) as Record<string, unknown>[]
    if (rows.length === 0) return
    const remote = rows.map(fromSupabaseRow)
    const remoteIds = new Set(remote.map((c) => c.id))
    const localOnly = readAll().filter((c) => !remoteIds.has(c.id))
    writeAll([...remote, ...localOnly])
  } catch {
    // 네트워크 실패는 조용히 무시 — 로컬 데이터로 계속 동작
  }
}

export function daysRemaining(client: AgencyClient): number {
  const today = toIsoDate(new Date())
  return daysBetween(today, client.endDate)
}

export function daysElapsed(client: AgencyClient): number {
  const today = toIsoDate(new Date())
  return Math.max(0, daysBetween(client.startDate, today))
}

export function pausedDaysSoFar(client: AgencyClient): number {
  if (!client.pausedAt) return 0
  const today = toIsoDate(new Date())
  return daysBetween(client.pausedAt, today)
}

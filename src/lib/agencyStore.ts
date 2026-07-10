import type { AgencyClient, DraftAttempt } from '../types/agency'
import { syncToSupabase } from './remoteSync'

const STORAGE_KEY = 'ai-ops:agency-clients'

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
  return updateClient(id, (c) => ({
    ...c,
    endDate: addMonths(c.endDate, 1),
    history: [
      ...c.history,
      { date: now, type: 'extend', note: '1개월 연장' },
    ],
  }))
}

export function pauseClient(id: string): AgencyClient | undefined {
  const now = new Date().toISOString()
  const today = toIsoDate(new Date())
  return updateClient(id, (c) => ({
    ...c,
    status: 'paused',
    pausedAt: today,
    history: [...c.history, { date: now, type: 'pause', note: '일시중단' }],
  }))
}

export function resumeClient(id: string): AgencyClient | undefined {
  const now = new Date().toISOString()
  const today = toIsoDate(new Date())
  return updateClient(id, (c) => {
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
}

export function saveMemo(id: string, memo: string): AgencyClient | undefined {
  return updateClient(id, (c) => ({ ...c, memo }))
}

const MAX_RECENT_DRAFTS = 30

export function saveTodayDrafts(
  id: string,
  drafts: DraftAttempt[],
): AgencyClient | undefined {
  return updateClient(id, (c) => ({
    ...c,
    todayDrafts: drafts,
    todayDraftsDate: toIsoDate(new Date()),
    recentDraftTexts: [
      ...drafts.map((d) => d.draft.text),
      ...c.recentDraftTexts,
    ].slice(0, MAX_RECENT_DRAFTS),
  }))
}

export function deleteClient(id: string): void {
  writeAll(readAll().filter((c) => c.id !== id))
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

import type { Brand } from '../types/brand.js'
import { syncToSupabase } from './remoteSync.js'

export type WorkLogStatus = 'running' | 'done' | 'error' | 'attention'

export interface WorkLogEntry {
  id: string
  agent: string
  brand: Brand
  kind: string
  status: WorkLogStatus
  statusLabel: string
  startedAt: string
  endedAt?: string
  costUsd?: number
  note: string
  detailHtml: string
}

const STORAGE_KEY = 'ai-ops:work-log'
const MAX_ENTRIES_PER_AGENT = 30

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}
const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

function readAll(): WorkLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries: WorkLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage 사용 불가 시 조용히 무시 — 근무기록은 best-effort
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function startWorkLog(params: {
  agent: string
  brand: Brand
  kind: string
  note?: string
}): string {
  const id = makeId()
  const entries = readAll()
  entries.unshift({
    id,
    agent: params.agent,
    brand: params.brand,
    kind: params.kind,
    status: 'running',
    statusLabel: '진행중',
    startedAt: new Date().toISOString(),
    note: params.note ?? '—',
    detailHtml: '',
  })
  const perAgent = entries.filter((e) => e.agent === params.agent)
  if (perAgent.length > MAX_ENTRIES_PER_AGENT) {
    const overflowIds = new Set(
      perAgent.slice(MAX_ENTRIES_PER_AGENT).map((e) => e.id),
    )
    writeAll(entries.filter((e) => !overflowIds.has(e.id)))
  } else {
    writeAll(entries)
  }
  return id
}

export function finishWorkLog(
  id: string,
  patch: {
    status: WorkLogStatus
    statusLabel: string
    costUsd?: number
    note?: string
    detailHtml?: string
  },
): void {
  const entries = readAll()
  const idx = entries.findIndex((e) => e.id === id)
  if (idx === -1) return
  entries[idx] = {
    ...entries[idx],
    status: patch.status,
    statusLabel: patch.statusLabel,
    endedAt: new Date().toISOString(),
    costUsd: patch.costUsd,
    note: patch.note ?? entries[idx].note,
    detailHtml: patch.detailHtml ?? entries[idx].detailHtml,
  }
  writeAll(entries)
  syncToSupabase('work_log', entries[idx])
}

export function getWorkLog(agent?: string, brand?: Brand): WorkLogEntry[] {
  let entries = readAll()
  if (agent) entries = entries.filter((e) => e.agent === agent)
  if (brand) entries = entries.filter((e) => e.brand === brand)
  return entries
}

function fromSupabaseRow(row: Record<string, unknown>): WorkLogEntry {
  return {
    id: String(row.id ?? ''),
    agent: String(row.agent ?? ''),
    brand: (row.brand as Brand) ?? '마잘남',
    kind: String(row.kind ?? ''),
    status: (row.status as WorkLogStatus) ?? 'done',
    statusLabel: String(row.status_label ?? ''),
    startedAt: String(row.started_at ?? new Date().toISOString()),
    endedAt: typeof row.ended_at === 'string' ? row.ended_at : undefined,
    costUsd: typeof row.cost_usd === 'number' ? row.cost_usd : undefined,
    note: String(row.note ?? ''),
    detailHtml: typeof row.detail_html === 'string' ? row.detail_html : '',
  }
}

// 서버 크론(스레드 매일 시안·콘텐츠 스케줄·브레인 등)이 만든 근무기록은
// Supabase에만 있고 브라우저 localStorage엔 없어서 팀채팅에 안 보였다 —
// 화면 진입 시 최근 것을 당겨온다(캘린더·결재함과 동일 방식).
export async function syncWorkLogFromSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/work_log?select=*&order=started_at.desc&limit=120`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return
    const rows = (await res.json()) as Record<string, unknown>[]
    if (rows.length === 0) return
    const remote = rows.map(fromSupabaseRow)
    const remoteIds = new Set(remote.map((e) => e.id))
    const localOnly = readAll().filter((e) => !remoteIds.has(e.id))
    writeAll([...remote, ...localOnly])
  } catch {
    // 네트워크 실패는 조용히 무시 — 로컬 데이터로 계속 동작
  }
}

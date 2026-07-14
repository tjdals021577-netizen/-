import type {
  CalendarEntry,
  CalendarChannel,
  CalendarStatus,
  ChecklistStageKey,
} from '../types/calendar.js'
import type { Brand } from '../types/brand.js'
import { getWorkLog } from './workLog.js'
import { syncToSupabase } from './remoteSync.js'

// 크론(api/cron/content-schedule.ts)이 서버에서 만든 캘린더 항목은 Supabase에만
// 쓰여서, 브라우저 localStorage만 읽는 화면에는 원래 안 보인다(대행 자동 생성
// 때 겪었던 문제와 동일) — syncEntriesFromSupabase()로 화면 진입 시 끌어온다.
function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}

const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

const STORAGE_KEY = 'ai-ops:content-calendar'

function readAll(): CalendarEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries: CalendarEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage 사용 불가 시 조용히 무시 — 캘린더는 best-effort 로컬 저장
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getEntries(brand?: Brand): CalendarEntry[] {
  const all = readAll().sort((a, b) => a.date.localeCompare(b.date))
  return brand ? all.filter((e) => e.brand === brand) : all
}

export function getEntriesForDate(date: string, brand?: Brand): CalendarEntry[] {
  return getEntries(brand).filter((e) => e.date === date)
}

export function createEntry(params: {
  date: string
  brand: Brand
  channel: CalendarChannel
  title: string
  status?: CalendarStatus
  note?: string
  contentHtml?: string
  checklist?: CalendarEntry['checklist']
  sourceWorkLogId?: string
}): CalendarEntry {
  const entries = readAll()
  if (params.sourceWorkLogId) {
    const existing = entries.find((e) => e.sourceWorkLogId === params.sourceWorkLogId)
    if (existing) return existing
  }
  const entry: CalendarEntry = {
    id: makeId(),
    date: params.date,
    brand: params.brand,
    channel: params.channel,
    title: params.title,
    status: params.status ?? 'planned',
    note: params.note ?? '',
    contentHtml: params.contentHtml,
    checklist: params.checklist,
    createdAt: new Date().toISOString(),
    sourceWorkLogId: params.sourceWorkLogId,
  }
  entries.push(entry)
  writeAll(entries)
  syncToSupabase('calendar_entries', entry)
  return entry
}

export function toggleChecklistStage(id: string, key: ChecklistStageKey): void {
  const entries = readAll()
  const idx = entries.findIndex((e) => e.id === id)
  if (idx === -1) return
  const checklist = entries[idx].checklist ?? []
  const nextChecklist = checklist.map((s) => (s.key === key ? { ...s, done: !s.done } : s))
  entries[idx] = { ...entries[idx], checklist: nextChecklist }
  writeAll(entries)
  syncToSupabase('calendar_entries', entries[idx])
}

export function updateEntry(
  id: string,
  patch: Partial<Pick<CalendarEntry, 'date' | 'channel' | 'title' | 'status' | 'note'>>,
): void {
  const entries = readAll()
  const idx = entries.findIndex((e) => e.id === id)
  if (idx === -1) return
  entries[idx] = { ...entries[idx], ...patch }
  writeAll(entries)
  syncToSupabase('calendar_entries', entries[idx])
}

export function deleteEntry(id: string): void {
  writeAll(readAll().filter((e) => e.id !== id))
}

function fromSupabaseRow(row: Record<string, unknown>): CalendarEntry {
  return {
    id: String(row.id ?? ''),
    date: String(row.date ?? ''),
    brand: (row.brand as Brand) ?? '마잘남',
    channel: (row.channel as CalendarChannel) ?? 'etc',
    title: String(row.title ?? ''),
    status: (row.status as CalendarStatus) ?? 'planned',
    note: String(row.note ?? ''),
    contentHtml: typeof row.content_html === 'string' ? row.content_html : undefined,
    checklist: Array.isArray(row.checklist) ? (row.checklist as CalendarEntry['checklist']) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    sourceWorkLogId: typeof row.source_work_log_id === 'string' ? row.source_work_log_id : undefined,
  }
}

// 서버 크론이 만든 항목을 병합해온다 — 이미 로컬에 있는 id는 원격 값으로 덮어써서
// 체크리스트 등 다른 화면(대시보드 등)에서의 변경도 최신으로 맞춘다.
export async function syncEntriesFromSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/calendar_entries?select=*&order=date.desc&limit=500`,
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

const AGENT_TO_CHANNEL: Record<string, CalendarChannel> = {
  writer: 'blog',
  buzz: 'thread',
  remix: 'youtube',
}

// 캘린더가 근무기록에서 오늘 완료된 콘텐츠를 찾아 아직 캘린더에 없는 것만
// "발행 예정(planned)" 항목으로 등록한다 — 각 컴포저가 생성 직후 바로
// createEntry를 호출하지만, 그걸 놓친 경로(팀 채팅 등)를 위한 안전망으로
// 캘린더 화면 진입 시 자동으로 한 번 더 돌린다(중복은 createEntry가 막아줌).
export function importTodayFromWorkLog(brand: Brand): number {
  const today = new Date().toISOString().slice(0, 10)
  const existingSourceIds = new Set(
    readAll()
      .map((e) => e.sourceWorkLogId)
      .filter((id): id is string => !!id),
  )
  const candidates = getWorkLog(undefined, brand).filter(
    (e) =>
      e.status === 'done' &&
      e.startedAt.slice(0, 10) === today &&
      AGENT_TO_CHANNEL[e.agent] &&
      !existingSourceIds.has(e.id),
  )
  for (const c of candidates) {
    createEntry({
      date: today,
      brand,
      channel: AGENT_TO_CHANNEL[c.agent],
      title: c.note || c.kind,
      status: 'planned',
      note: '근무기록에서 자동 등록됨 — 검토 후 발행하세요.',
      contentHtml: c.detailHtml,
      sourceWorkLogId: c.id,
    })
  }
  return candidates.length
}

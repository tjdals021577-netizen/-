import type { CalendarEntry, CalendarChannel, CalendarStatus } from '../types/calendar.js'
import type { Brand } from '../types/brand.js'
import { getWorkLog } from './workLog.js'
import { syncToSupabase } from './remoteSync.js'

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
    createdAt: new Date().toISOString(),
    sourceWorkLogId: params.sourceWorkLogId,
  }
  entries.push(entry)
  writeAll(entries)
  syncToSupabase('calendar_entries', entry)
  return entry
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

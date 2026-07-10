import type { CalendarEntry, CalendarChannel, CalendarStatus } from '../types/calendar'
import { getWorkLog } from './workLog'

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

export function getEntries(): CalendarEntry[] {
  return readAll().sort((a, b) => a.date.localeCompare(b.date))
}

export function getEntriesForDate(date: string): CalendarEntry[] {
  return getEntries().filter((e) => e.date === date)
}

export function createEntry(params: {
  date: string
  channel: CalendarChannel
  title: string
  status?: CalendarStatus
  note?: string
  sourceWorkLogId?: string
}): CalendarEntry {
  const entry: CalendarEntry = {
    id: makeId(),
    date: params.date,
    channel: params.channel,
    title: params.title,
    status: params.status ?? 'planned',
    note: params.note ?? '',
    createdAt: new Date().toISOString(),
    sourceWorkLogId: params.sourceWorkLogId,
  }
  const entries = readAll()
  entries.push(entry)
  writeAll(entries)
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
// "발행 예정(planned)" 항목으로 자동 등록한다 — 자동 스케줄러 없이도 동작.
export function importTodayFromWorkLog(): number {
  const today = new Date().toISOString().slice(0, 10)
  const existingSourceIds = new Set(
    readAll()
      .map((e) => e.sourceWorkLogId)
      .filter((id): id is string => !!id),
  )
  const candidates = getWorkLog().filter(
    (e) =>
      e.status === 'done' &&
      e.startedAt.slice(0, 10) === today &&
      AGENT_TO_CHANNEL[e.agent] &&
      !existingSourceIds.has(e.id),
  )
  const entries = readAll()
  for (const c of candidates) {
    entries.push({
      id: makeId(),
      date: today,
      channel: AGENT_TO_CHANNEL[c.agent],
      title: c.note || c.kind,
      status: 'planned',
      note: '근무기록에서 자동 등록됨 — 검토 후 발행하세요.',
      createdAt: new Date().toISOString(),
      sourceWorkLogId: c.id,
    })
  }
  if (candidates.length > 0) writeAll(entries)
  return candidates.length
}

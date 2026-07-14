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

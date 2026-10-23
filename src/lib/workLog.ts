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

// 진행 중(running)으로 멈춰 있는 근무기록을 전부 '취소됨'으로 정리한다.
// 페이지를 새로고침하면 진행 중이던 비동기 작업(Promise)은 사라지는데
// 근무기록은 localStorage/Supabase에 'running'으로 남아 "처리 중…"이 영원히
// 떠 있는(그래서 취소 버튼도 안 뜨는) 문제가 있었다 — 대표님이 누르는 '중단'이
// 이 고아 기록을 강제로 정리한다. 실제로 아직 돌고 있는 프록시 호출은
// cancelActiveClaudeCalls()가 따로 abort한다(이 함수는 기록 정리만 담당).
// 정리한 건수를 돌려준다(0이면 이미 진행 중인 게 없었다는 뜻).
export function cancelRunningWorkLogs(brand?: Brand): number {
  const running = readAll().filter(
    (e) => e.status === 'running' && (!brand || e.brand === brand),
  )
  for (const e of running) {
    finishWorkLog(e.id, {
      status: 'attention',
      statusLabel: '취소됨',
      note: '대표님이 중단함',
      detailHtml: '작업을 중단했습니다.',
    })
  }
  return running.length
}

// 페이지가 백그라운드로 내려가거나(특히 모바일) 새로고침되면, 진행 중이던
// 호출은 중간에 죽는데 근무기록은 'running'으로 남는다 — 그러면 화면의
// "처리 중… N분 경과"가 끝없이 올라가고 에러도 안 뜬다(살아있는 호출이 없어서
// 타임아웃조차 못 친다). 실제 호출은 이미 120초 안팎에서 끝나므로(생성 재시도까지
// 합쳐 최대 ~6분), 그보다 한참 지난(기본 8분) 'running'은 사실상 죽은 유령
// 기록이다. 이걸 자동으로 '시간 초과'로 정리해 화면이 스스로 회복되게 한다.
// 화면 진입 시·주기적 갱신 때 호출한다. 정리한 건수를 돌려준다.
export function reapStaleRunningWorkLogs(maxAgeMs = 8 * 60_000): number {
  const now = Date.now()
  const stale = readAll().filter(
    (e) => e.status === 'running' && now - new Date(e.startedAt).getTime() > maxAgeMs,
  )
  for (const e of stale) {
    finishWorkLog(e.id, {
      status: 'attention',
      statusLabel: '시간 초과',
      note: '응답이 없어 자동 정리됨',
      detailHtml: '작업이 시간 안에 끝나지 않아 자동으로 정리했어요. 다시 시도해 주세요.',
    })
  }
  return stale.length
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

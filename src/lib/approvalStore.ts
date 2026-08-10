import type { ApprovalItem, ApprovalAgent, ApprovalStatus } from '../types/approval.js'
import type { Brand } from '../types/brand.js'
import { syncToSupabase, deleteFromSupabase } from './remoteSync.js'

const STORAGE_KEY = 'ai-ops:approval-queue'
const MAX_ITEMS = 200

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}
const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

function readAll(): ApprovalItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: ApprovalItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // localStorage 사용 불가 시 조용히 무시 — 결재함은 best-effort 로컬 저장
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 라이터·버즈·리믹서가 결과물을 만들 때마다 호출 — 대표님이 한 곳에서
// 전부 모아 보고 승인/반려할 수 있게 결재함에 올린다.
export function submitForApproval(params: {
  agent: ApprovalAgent
  brand: Brand
  title: string
  contentHtml: string
  passed: boolean
  scoreLabel: string
  sourceWorkLogId?: string
}): ApprovalItem {
  const item: ApprovalItem = {
    id: makeId(),
    agent: params.agent,
    brand: params.brand,
    title: params.title,
    contentHtml: params.contentHtml,
    passed: params.passed,
    scoreLabel: params.scoreLabel,
    createdAt: new Date().toISOString(),
    status: 'pending',
    sourceWorkLogId: params.sourceWorkLogId,
  }
  const items = readAll()
  items.unshift(item)
  writeAll(items.slice(0, MAX_ITEMS))
  syncToSupabase('approval_queue', item)
  return item
}

export function getApprovalQueue(status?: ApprovalStatus, brand?: Brand): ApprovalItem[] {
  let items = readAll()
  if (status) items = items.filter((i) => i.status === status)
  if (brand) items = items.filter((i) => i.brand === brand)
  return items
}

function fromSupabaseRow(row: Record<string, unknown>): ApprovalItem {
  return {
    id: String(row.id ?? ''),
    agent: (row.agent as ApprovalAgent) ?? 'writer',
    brand: (row.brand as Brand) ?? '마잘남',
    title: String(row.title ?? ''),
    contentHtml: typeof row.content_html === 'string' ? row.content_html : '',
    passed: Boolean(row.passed),
    scoreLabel: String(row.score_label ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    status: (row.status as ApprovalStatus) ?? 'pending',
    sourceWorkLogId: typeof row.source_work_log_id === 'string' ? row.source_work_log_id : undefined,
    reviewedAt: typeof row.reviewed_at === 'string' ? row.reviewed_at : undefined,
    reviewNote: typeof row.review_note === 'string' ? row.review_note : undefined,
  }
}

// 서버 크론(agency·thread-daily·content-schedule)이 만든 결재 항목은 Supabase에만
// 있고 브라우저 localStorage엔 없어서 결재함에 안 보였다 — 화면 진입 시 원격 것을
// 병합해온다(캘린더의 syncEntriesFromSupabase와 동일 방식). 로컬에서 이미 승인/반려한
// 항목은 로컬 상태를 유지하려고, 원격에 없는 로컬 항목은 남기고 원격은 덮어쓴다.
export async function syncApprovalsFromSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/approval_queue?select=*&order=created_at.desc&limit=${MAX_ITEMS}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return
    const rows = (await res.json()) as Record<string, unknown>[]
    if (rows.length === 0) return
    const remote = rows.map(fromSupabaseRow)
    const remoteIds = new Set(remote.map((i) => i.id))
    const localOnly = readAll().filter((i) => !remoteIds.has(i.id))
    writeAll([...remote, ...localOnly].slice(0, MAX_ITEMS))
  } catch {
    // 네트워크 실패는 조용히 무시 — 로컬 데이터로 계속 동작
  }
}

// 테스트하며 쌓인 "미달(통과 못한) 대기 항목"을 한 번에 정리(삭제)한다 —
// 로컬 + Supabase 둘 다에서 지운다(안 그러면 다음 동기화 때 다시 딸려온다).
// 승인/반려한 항목은 건드리지 않고, 대기중(pending) + passed=false만 지운다.
export function clearFailedPending(brand?: Brand): number {
  const all = readAll()
  const toRemove = all.filter(
    (i) => i.status === 'pending' && !i.passed && (!brand || i.brand === brand),
  )
  if (toRemove.length === 0) return 0
  const removeIds = new Set(toRemove.map((i) => i.id))
  writeAll(all.filter((i) => !removeIds.has(i.id)))
  for (const item of toRemove) deleteFromSupabase('approval_queue', item.id)
  return toRemove.length
}

export function reviewItem(
  id: string,
  status: 'approved' | 'rejected',
  note?: string,
): void {
  const items = readAll()
  const idx = items.findIndex((i) => i.id === id)
  if (idx === -1) return
  items[idx] = {
    ...items[idx],
    status,
    reviewedAt: new Date().toISOString(),
    reviewNote: note,
  }
  writeAll(items)
  syncToSupabase('approval_queue', items[idx])
}

import type { ApprovalItem, ApprovalAgent, ApprovalStatus } from '../types/approval'
import type { Brand } from '../types/brand'

const STORAGE_KEY = 'ai-ops:approval-queue'
const MAX_ITEMS = 200

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
  return item
}

export function getApprovalQueue(status?: ApprovalStatus, brand?: Brand): ApprovalItem[] {
  let items = readAll()
  if (status) items = items.filter((i) => i.status === status)
  if (brand) items = items.filter((i) => i.brand === brand)
  return items
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
}

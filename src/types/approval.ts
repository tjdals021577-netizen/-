import type { Brand } from './brand'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export type ApprovalAgent = 'writer' | 'buzz' | 'remix'

export interface ApprovalItem {
  id: string
  agent: ApprovalAgent
  brand: Brand
  title: string
  contentHtml: string
  passed: boolean
  scoreLabel: string
  createdAt: string
  status: ApprovalStatus
  reviewedAt?: string
  reviewNote?: string
  sourceWorkLogId?: string
}

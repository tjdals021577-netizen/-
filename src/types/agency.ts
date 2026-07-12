import type { ThreadDraft, ThreadReview } from './thread'

export type ClientStatus = 'active' | 'paused'

export type ContractEventType = 'start' | 'extend' | 'pause' | 'resume'

export interface ContractEvent {
  date: string // ISO datetime
  type: ContractEventType
  note?: string
}

export interface DraftAttempt {
  draft: ThreadDraft
  review: ThreadReview
}

export interface AgencyClient {
  id: string
  name: string
  business: string
  persona: string
  threadUrl: string
  memo: string
  status: ClientStatus
  startDate: string // ISO date (yyyy-mm-dd)
  endDate: string // ISO date (yyyy-mm-dd)
  pausedAt?: string // ISO date
  monthlyFeeKrw?: number
  history: ContractEvent[]
  todayDrafts: DraftAttempt[]
  todayDraftsDate?: string // ISO date — 어느 날짜의 초안인지
  recentDraftTexts: string[] // 반복 방지용 최근 초안 텍스트(최대 30개)
  referenceImageIds: string[] // 카피라이팅 레퍼런스로 참고할 이미지(레퍼런스 라이브러리 id)
  createdAt: string
}

export interface AgencyOnboardingResult {
  name: string
  business: string
  persona: string
  threadUrl: string
}

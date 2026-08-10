import type { Brand } from './brand.js'

export type CalendarStatus = 'planned' | 'done' | 'open'

export type CalendarChannel = 'blog' | 'thread' | 'youtube' | 'agency' | 'etc'

// 콘텐츠 한 건이 발행되기까지 거치는 5단계. "기획"은 AI가 초안을 만들면 자동으로
// 체크되고, 나머지 4단계(컨펌·피드백·데이터 파악·레퍼런스)는 대표님이 직접 체크한다
// — 게시물 단위 조회수 연동이 아직 없어서 "데이터 파악"을 자동으로 감지할 방법이
// 없다(레이더는 브랜드 전체 합산만 수집함). 억지로 자동화하는 대신 정직하게 수동
// 체크리스트로 둔다.
export type ChecklistStageKey = 'plan' | 'confirm' | 'feedback' | 'data' | 'reference'

export interface ChecklistStage {
  key: ChecklistStageKey
  done: boolean
}

export const CHECKLIST_STAGE_LABEL: Record<ChecklistStageKey, string> = {
  plan: '기획',
  confirm: '컨펌',
  feedback: '피드백',
  data: '데이터 파악',
  reference: '레퍼런스',
}

export const CHECKLIST_STAGE_KEYS: ChecklistStageKey[] = ['plan', 'confirm', 'feedback', 'data', 'reference']

export function makeDefaultChecklist(planDone = false): ChecklistStage[] {
  return CHECKLIST_STAGE_KEYS.map((key) => ({ key, done: key === 'plan' ? planDone : false }))
}

export interface CalendarEntry {
  id: string
  date: string // YYYY-MM-DD
  brand: Brand
  channel: CalendarChannel
  title: string
  status: CalendarStatus
  note: string
  contentHtml?: string
  checklist?: ChecklistStage[]
  createdAt: string
  sourceWorkLogId?: string
}

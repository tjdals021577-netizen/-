// 업메리 상담 신청(리드) — 아임웹 코드 블록 폼이 Supabase leads 테이블에 직접 넣고,
// 대시보드에서 상태를 바꾸면 매일 크론(meta-capi)이 메타 전환 API로 보낸다(2026-10 대표님 요청).
// 서버(api/_lib/leads.ts)·화면(LeadsPanel)·폼 코드(leadFormSnippet)가 같이 쓰는 단일 정의.

export const LEAD_STATUSES = ['신청', '카톡 대화', '통화 완료', '결제', '이탈'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const TAROT_EXPERIENCE_OPTIONS = ['처음', '배워봤음', '상담 중'] as const
export const DAILY_TIME_OPTIONS = ['30분', '1시간', '2시간 이상'] as const

// 상태 → 메타 전환 이벤트. 신청은 폼 제출 순간 브라우저 픽셀로도 같은 event_id(리드 ID)로 보낸다.
export const LEAD_META_EVENTS = {
  lead: 'Lead',
  called: 'Contact',
  paid: 'Purchase',
} as const

export interface LeadRow {
  id: string
  brand: string
  name: string
  phone: string
  tarot_experience: string | null
  daily_time: string | null
  consent: boolean
  consent_at: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  fbclid: string | null
  fbc: string | null
  fbp: string | null
  page_url: string | null
  user_agent: string | null
  status: LeadStatus
  status_updated_at: string | null
  called_at: string | null
  paid_at: string | null
  paid_amount: number | null
  capi_lead_sent_at: string | null
  capi_contact_sent_at: string | null
  capi_purchase_sent_at: string | null
  created_at: string
}

export function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === 'string' && (LEAD_STATUSES as readonly string[]).includes(v)
}

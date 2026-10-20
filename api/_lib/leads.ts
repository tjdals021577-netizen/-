// 업메리 상담 신청(리드) 서버 로직 — 2026-10 대표님 요청.
// · 폼(아임웹 코드 블록)은 anon 키로 leads에 insert만 한다(RLS: insert만 허용, 읽기·수정 금지).
// · 대시보드 목록·상태 변경은 api/radar-refresh.ts(앱 비밀번호)로 들어와 여기서 service 키로 처리한다
//   (서버 함수 12개 한도라 새 함수를 만들지 않음).
// · 매일 크론(api/cron/[task].ts의 meta-capi)이 아직 안 보낸 이벤트를 메타 전환 API로 보낸다.
//   신청 = Lead(event_id = 리드 ID, 폼의 브라우저 픽셀과 같은 값이라 메타가 중복 제거), 통화 완료 = Contact,
//   결제 = Purchase(금액 KRW). 전화번호는 SHA-256 해시로만 나간다.
// ★ 리드 개인정보(이름·전화)는 근무기록·로그·카톡에 원문으로 남기지 않는다 — 건수만 남긴다.
// ★ 테이블이 없거나(SQL 전) 메타 키가 없으면 조용히 건너뛴다.
import { createHash } from 'node:crypto'
import { supabaseInsert, supabaseSelect, supabaseUpdate } from './supabaseAdmin.js'
import { isLeadStatus, LEAD_META_EVENTS, type LeadRow } from '../../src/types/lead.js'

const TABLE = 'leads'
// 메타 Graph API 버전 — 오래된 버전은 2년쯤 뒤 닫히므로 env로 바꿀 수 있게 둔다.
const DEFAULT_GRAPH_VERSION = 'v23.0'
// 메타 전환 API는 7일 넘은 이벤트를 받지 않는다 — 그보다 오래된 건 보내지 않고 처리됨으로 표시한다.
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /PGRST205|42P01|Could not find the table|does not exist/i.test(msg)
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// 메타 규격: 숫자만, 국가번호 포함(010-1234-5678 → 821012345678).
export function normalizeKrPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('82')) return digits
  if (digits.startsWith('0')) return `82${digits.slice(1)}`
  return digits
}

// ── 대시보드 ──

export type LeadListResult =
  | { ok: true; leads: LeadRow[]; pixelId: string | null; capiConfigured: boolean }
  | { ok: false; tableMissing: true; pixelId: string | null; capiConfigured: boolean }

export async function listLeads(): Promise<LeadListResult> {
  const pixelId = process.env.META_PIXEL_ID?.trim() || null
  const capiConfigured = !!(pixelId && process.env.META_CAPI_TOKEN?.trim())
  try {
    const leads = await supabaseSelect<LeadRow>(TABLE, 'select=*&order=created_at.desc&limit=300')
    return { ok: true, leads, pixelId, capiConfigured }
  } catch (err) {
    if (isMissingTableError(err)) return { ok: false, tableMissing: true, pixelId, capiConfigured }
    throw err
  }
}

export async function updateLeadStatus(params: {
  id: string
  status: unknown
  amount?: unknown
}): Promise<{ ok: true; lead: LeadRow } | { ok: false; error: string }> {
  const { id, status } = params
  if (!id || typeof id !== 'string') return { ok: false, error: '리드 ID가 없습니다.' }
  if (!isLeadStatus(status)) return { ok: false, error: '알 수 없는 상태입니다.' }
  const rows = await supabaseSelect<LeadRow>(TABLE, `id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
  const current = rows[0]
  if (!current) return { ok: false, error: '리드를 찾지 못했습니다.' }

  const nowIso = new Date().toISOString()
  const patch: Partial<LeadRow> = { status, status_updated_at: nowIso }
  // 전환 시각은 "처음 그 단계가 된 순간"만 기록한다(상태를 되돌려도 이미 보낸 이벤트는 취소되지 않음).
  if (status === '통화 완료' && !current.called_at) patch.called_at = nowIso
  if (status === '결제') {
    if (!current.paid_at) patch.paid_at = nowIso
    const amount = Number(params.amount)
    if (Number.isFinite(amount) && amount > 0) patch.paid_amount = Math.round(amount)
  }
  await supabaseUpdate(TABLE, `id=eq.${encodeURIComponent(id)}`, patch)
  return { ok: true, lead: { ...current, ...patch } }
}

// ── 메타 전환 API ──

type EventKind = keyof typeof LEAD_META_EVENTS

interface PendingEvent {
  leadId: string
  kind: EventKind
  payload: Record<string, unknown>
}

function eventTimeOf(lead: LeadRow, kind: EventKind): string | null {
  if (kind === 'lead') return lead.created_at
  if (kind === 'called') return lead.called_at
  return lead.paid_at
}

function sentAtOf(lead: LeadRow, kind: EventKind): string | null {
  if (kind === 'lead') return lead.capi_lead_sent_at
  if (kind === 'called') return lead.capi_contact_sent_at
  return lead.capi_purchase_sent_at
}

const SENT_COLUMN: Record<EventKind, keyof LeadRow> = {
  lead: 'capi_lead_sent_at',
  called: 'capi_contact_sent_at',
  paid: 'capi_purchase_sent_at',
}

// 순수 함수(테스트용으로 export) — 아직 안 보낸 이벤트를 메타 규격으로 만든다. 7일 넘은 건 tooOld로 따로 돌려준다.
export function buildMetaEvents(
  leads: LeadRow[],
  now: number = Date.now(),
): { events: PendingEvent[]; tooOld: { leadId: string; kind: EventKind }[] } {
  const events: PendingEvent[] = []
  const tooOld: { leadId: string; kind: EventKind }[] = []
  for (const lead of leads) {
    const userData: Record<string, unknown> = {
      ph: [sha256(normalizeKrPhone(lead.phone))],
      external_id: [sha256(lead.id)],
      country: [sha256('kr')],
    }
    if (lead.fbc) userData.fbc = lead.fbc
    if (lead.fbp) userData.fbp = lead.fbp
    for (const kind of ['lead', 'called', 'paid'] as EventKind[]) {
      const at = eventTimeOf(lead, kind)
      if (!at || sentAtOf(lead, kind)) continue
      const ms = Date.parse(at)
      if (!Number.isFinite(ms)) continue
      if (now - ms > MAX_EVENT_AGE_MS) {
        tooOld.push({ leadId: lead.id, kind })
        continue
      }
      const base = {
        event_name: LEAD_META_EVENTS[kind],
        event_time: Math.floor(ms / 1000),
        // 신청은 폼의 브라우저 픽셀과 같은 event_id(=리드 ID) → 메타가 둘을 하나로 친다.
        event_id: kind === 'lead' ? lead.id : `${lead.id}-${kind}`,
      }
      if (kind === 'lead') {
        events.push({
          leadId: lead.id,
          kind,
          payload: {
            ...base,
            action_source: 'website',
            event_source_url: lead.page_url ?? undefined,
            user_data: { ...userData, client_user_agent: lead.user_agent ?? undefined },
            custom_data: { content_name: '업메리 상담 신청' },
          },
        })
      } else if (kind === 'called') {
        events.push({
          leadId: lead.id,
          kind,
          payload: { ...base, action_source: 'phone_call', user_data: userData, custom_data: { content_name: '업메리 상담 통화 완료' } },
        })
      } else {
        events.push({
          leadId: lead.id,
          kind,
          payload: {
            ...base,
            action_source: 'system_generated',
            user_data: userData,
            custom_data: { content_name: '업메리 컨설팅 결제', currency: 'KRW', value: lead.paid_amount ?? 0 },
          },
        })
      }
    }
  }
  return { events, tooOld }
}

async function markSent(pairs: { leadId: string; kind: EventKind }[], nowIso: string): Promise<void> {
  for (const kind of ['lead', 'called', 'paid'] as EventKind[]) {
    const ids = [...new Set(pairs.filter((p) => p.kind === kind).map((p) => p.leadId))]
    // URL이 너무 길어지지 않게 50개씩.
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50).map((x) => `"${x.replace(/"/g, '')}"`).join(',')
      await supabaseUpdate(TABLE, `id=in.(${encodeURIComponent(chunk)})`, { [SENT_COLUMN[kind]]: nowIso })
    }
  }
}

async function logRun(note: string, status: 'done' | 'error', detail = ''): Promise<void> {
  const nowIso = new Date().toISOString()
  await supabaseInsert('work_log', {
    id: makeId(),
    agent: 'radar',
    brand: '업메리',
    kind: '메타 전환 전송',
    status,
    status_label: status === 'done' ? '완료' : '오류',
    started_at: nowIso,
    ended_at: nowIso,
    note,
    detail_html: detail,
  }).catch(() => undefined)
}

// 매일 크론 — 결과 문자열에도 개인정보는 넣지 않는다(건수만).
export async function sendLeadConversions(): Promise<string> {
  const pixelId = process.env.META_PIXEL_ID?.trim()
  const token = process.env.META_CAPI_TOKEN?.trim()
  if (!pixelId || !token) return '메타 전환 API 미설정(META_PIXEL_ID·META_CAPI_TOKEN) — 건너뜀'

  let leads: LeadRow[]
  try {
    leads = await supabaseSelect<LeadRow>(
      TABLE,
      'select=*&or=(capi_lead_sent_at.is.null,and(called_at.not.is.null,capi_contact_sent_at.is.null),and(paid_at.not.is.null,capi_purchase_sent_at.is.null))&order=created_at.asc&limit=1000',
    )
  } catch (err) {
    if (isMissingTableError(err)) return 'leads 테이블 없음(SQL 실행 전) — 건너뜀'
    throw err
  }

  const { events, tooOld } = buildMetaEvents(leads)
  const nowIso = new Date().toISOString()
  if (tooOld.length > 0) await markSent(tooOld, nowIso)
  if (events.length === 0) {
    const msg = `보낼 이벤트 없음${tooOld.length > 0 ? ` · 7일 지난 ${tooOld.length}건은 메타가 안 받아 건너뜀` : ''}`
    if (tooOld.length > 0) await logRun(msg, 'done')
    return msg
  }

  const version = process.env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION
  const body: Record<string, unknown> = { data: events.map((e) => e.payload) }
  const testCode = process.env.META_TEST_EVENT_CODE?.trim()
  if (testCode) body.test_event_code = testCode

  const res = await fetch(
    `https://graph.facebook.com/${version}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  const text = await res.text()
  if (!res.ok) {
    // 메타 오류 메시지만 남긴다(요청 본문·토큰은 남기지 않음). 다음 크론 때 다시 시도된다.
    let reason = text.slice(0, 300)
    try {
      reason = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? reason
    } catch {
      // 원문 앞부분 그대로.
    }
    const msg = `메타 전송 실패(${res.status}) — 이벤트 ${events.length}건은 다음 크론 때 다시 보냄`
    await logRun(msg, 'error', reason)
    return `${msg}: ${reason}`
  }

  await markSent(events, nowIso)
  const count = (kind: EventKind) => events.filter((e) => e.kind === kind).length
  const msg =
    `메타 전환 전송 ${events.length}건 — 신청 ${count('lead')} · 통화 완료 ${count('called')} · 결제 ${count('paid')}` +
    (testCode ? ' (테스트 코드 사용 중)' : '') +
    (tooOld.length > 0 ? ` · 7일 지난 ${tooOld.length}건 건너뜀` : '')
  await logRun(msg, 'done')
  return msg
}


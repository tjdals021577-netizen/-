// "지금 매출 새로고침" 버튼용 — 레이더 크론(매일 새벽)을 기다리지 않고 대시보드에서
// 즉시 아임웹 이번 달 매출을 당겨온다. 업메리·마잘남 둘 다. CRON_SECRET이 아니라 앱
// 비밀번호로 막는다(브라우저에서 호출). 아임웹 키는 서버 환경변수에만 있고 브라우저로
// 나가지 않는다(브라우저는 이 엔드포인트만 호출).
// 2026-10: 서버 함수 12개 한도 때문에 대시보드의 "업메리 상담 신청(리드)" 목록·상태 변경도
// 여기서 받는다(본문 action = 'leads' | 'lead-status'). 리드는 개인정보라 앱 비밀번호가
// 설정돼 있을 때만 열어 준다.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fetchImwebOrderSummary } from './_lib/imweb.js'
import { supabaseInsert } from './_lib/supabaseAdmin.js'
import { sendJson, sendText } from './_lib/cronHandler.js'
import { listLeads, updateLeadStatus } from './_lib/leads.js'
import { BRANDS, type Brand } from '../src/types/brand.js'

const IMWEB_ENV_KEYS: Record<Brand, { apiKey: string; secret: string }> = {
  업메리: { apiKey: 'IMWEB_API_KEY_UPMERY', secret: 'IMWEB_SECRET_KEY_UPMERY' },
  마잘남: { apiKey: 'IMWEB_API_KEY_MAJALNAM', secret: 'IMWEB_SECRET_KEY_MAJALNAM' },
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
function kstMonthStart(): string {
  return `${kstToday().slice(0, 7)}-01`
}
function kstMonthsAgoStart(months: number): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCMonth(d.getUTCMonth() - months, 1)
  return d.toISOString().slice(0, 10)
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendText(res, 405, 'POST만 지원합니다.')
    return
  }
  const configuredPassword = process.env.VITE_APP_PASSWORD
  if (configuredPassword && req.headers['x-app-password'] !== configuredPassword) {
    sendText(res, 401, '인증 실패')
    return
  }

  const body = await readJsonBody(req)
  if (body.action === 'leads' || body.action === 'lead-status') {
    if (!configuredPassword) {
      sendJson(res, 403, { error: '앱 비밀번호(VITE_APP_PASSWORD)가 설정돼 있어야 리드를 볼 수 있습니다.' })
      return
    }
    try {
      if (body.action === 'leads') sendJson(res, 200, await listLeads())
      else sendJson(res, 200, await updateLeadStatus({ id: String(body.id ?? ''), status: body.status, amount: body.amount }))
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  const nowIso = new Date().toISOString()
  const results: string[] = []
  for (const brand of BRANDS) {
    const keys = IMWEB_ENV_KEYS[brand]
    const apiKey = process.env[keys.apiKey]
    const secretKey = process.env[keys.secret]
    if (!apiKey || !secretKey) {
      results.push(`${brand}: 아임웹 미설정`)
      continue
    }
    try {
      const summary = await fetchImwebOrderSummary({
        apiKey,
        secretKey,
        dateFrom: kstMonthsAgoStart(5),
        dateTo: kstToday(),
      })
      const monthStart = kstMonthStart()
      const thisMonth = summary.daily.filter((d) => d.date >= monthStart)
      const monthRevenue = thisMonth.reduce((s, d) => s + d.revenue, 0)
      const monthOrders = thisMonth.reduce((s, d) => s + d.orderCount, 0)
      await supabaseInsert('radar_snapshots', {
        id: makeId(),
        brand,
        source: 'imweb',
        period_label: '이번 달',
        sessions: 0,
        active_users: 0,
        conversions: 0,
        top_pages: [],
        traffic_sources: [],
        order_count: monthOrders,
        revenue_krw: monthRevenue,
        daily_revenue: summary.daily,
        created_at: nowIso,
      })
      results.push(`${brand}: 이번 달 주문 ${monthOrders}건 / 매출 ${monthRevenue}원`)
    } catch (err) {
      results.push(`${brand}: 실패 (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  sendJson(res, 200, { ok: true, results })
}

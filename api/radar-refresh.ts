// "지금 매출 새로고침" 버튼용 — 레이더 크론(매일 새벽)을 기다리지 않고 대시보드에서
// 즉시 아임웹 이번 달 매출을 당겨온다. 업메리·마잘남 둘 다. CRON_SECRET이 아니라 앱
// 비밀번호로 막는다(브라우저에서 호출). 아임웹 키는 서버 환경변수에만 있고 브라우저로
// 나가지 않는다(브라우저는 이 엔드포인트만 호출).
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fetchImwebOrderSummary } from './_lib/imweb.js'
import { supabaseInsert } from './_lib/supabaseAdmin.js'
import { sendJson, sendText } from './_lib/cronHandler.js'
import { BRANDS, type Brand } from '../src/types/brand.js'

const IMWEB_ENV_KEYS: Record<Brand, { apiKey: string; secret: string }> = {
  업메리: { apiKey: 'IMWEB_API_KEY_UPMERY', secret: 'IMWEB_SECRET_KEY_UPMERY' },
  마잘남: { apiKey: 'IMWEB_API_KEY_MAJALNAM', secret: 'IMWEB_SECRET_KEY_MAJALNAM' },
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

  const nowIso = new Date().toISOString()
  const results: string[] = []
  const samples: string[] = []
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
        dateFrom: kstMonthStart(),
        dateTo: kstToday(),
      })
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
        order_count: summary.orderCount,
        revenue_krw: summary.revenueKrw,
        created_at: nowIso,
      })
      results.push(`${brand}: 주문 ${summary.orderCount}건 / 매출 ${summary.revenueKrw ?? '?'}원`)
      // 진단용: 첫 주문의 원본 JSON — 금액 필드를 정확히 맞추기 위해 노출한다(임시).
      samples.push(`[${brand}] ${summary.rawSample}`)
    } catch (err) {
      results.push(`${brand}: 실패 (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  sendJson(res, 200, { ok: true, results, samples })
}

// 메타 마케팅 API(읽기) — 업메리 광고 계정의 광고별·일별 노출·클릭·비용·리드 수(2026-10 대표님 요청).
// radar 크론이 매일 최근 30일치를 다시 받아 radar_snapshots(source 'meta_ads')에 통째로 저장한다
// (메타는 며칠 뒤까지 수치를 보정하므로 매일 30일을 새로 받는 편이 정확). AI 호출 없음.
// env: META_AD_ACCOUNT_ID(act_ 있어도 없어도 됨), META_ACCESS_TOKEN(ads_read 권한), 선택 META_GRAPH_VERSION.
import type { MetaAdDailyRow } from '../../src/lib/adFunnel.js'

const DEFAULT_GRAPH_VERSION = 'v23.0'
// 리드로 셀 action_type — 'lead'가 있으면 그것(픽셀·인스턴트 양식 합계), 없으면 개별 유형 합.
const LEAD_ACTION_TOTAL = 'lead'
const LEAD_ACTION_PARTS = ['offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped']

interface InsightRow {
  date_start?: string
  campaign_id?: string
  campaign_name?: string
  ad_id?: string
  ad_name?: string
  impressions?: string
  clicks?: string
  inline_link_clicks?: string
  spend?: string
  actions?: { action_type?: string; value?: string }[]
}

function num(v: string | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function leadCountFromActions(actions: InsightRow['actions']): number {
  if (!actions) return 0
  const total = actions.find((a) => a.action_type === LEAD_ACTION_TOTAL)
  if (total) return num(total.value)
  return actions.filter((a) => LEAD_ACTION_PARTS.includes(a.action_type ?? '')).reduce((s, a) => s + num(a.value), 0)
}

export function toMetaAdDailyRow(r: InsightRow): MetaAdDailyRow | null {
  if (!r.date_start || !r.ad_id) return null
  return {
    date: r.date_start,
    campaignId: r.campaign_id ?? '',
    campaignName: r.campaign_name ?? '',
    adId: r.ad_id,
    adName: r.ad_name ?? '',
    impressions: num(r.impressions),
    // 퍼널의 "클릭" = 랜딩으로 넘어간 링크 클릭(없으면 전체 클릭).
    clicks: r.inline_link_clicks !== undefined ? num(r.inline_link_clicks) : num(r.clicks),
    spend: num(r.spend),
    metaLeads: leadCountFromActions(r.actions),
  }
}

export async function fetchMetaAdInsights(params: {
  accountId: string
  accessToken: string
  since: string
  until: string
}): Promise<MetaAdDailyRow[]> {
  const version = process.env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION
  const account = params.accountId.trim().replace(/^act_/, '')
  const query = new URLSearchParams({
    level: 'ad',
    time_increment: '1',
    time_range: JSON.stringify({ since: params.since, until: params.until }),
    fields: 'date_start,campaign_id,campaign_name,ad_id,ad_name,impressions,clicks,inline_link_clicks,spend,actions',
    limit: '500',
    access_token: params.accessToken,
  })
  let url: string | null = `https://graph.facebook.com/${version}/act_${encodeURIComponent(account)}/insights?${query}`
  const rows: MetaAdDailyRow[] = []
  // 광고가 많아도 무한히 돌지 않게 페이지 상한.
  for (let page = 0; url && page < 20; page++) {
    const res: Response = await fetch(url)
    const text = await res.text()
    if (!res.ok) {
      // 토큰이 들어간 URL은 남기지 않고 메타 오류 메시지만.
      let reason = text.slice(0, 200)
      try {
        reason = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? reason
      } catch {
        // 원문 앞부분.
      }
      throw new Error(`메타 광고 인사이트 ${res.status}: ${reason}`)
    }
    const body = JSON.parse(text) as { data?: InsightRow[]; paging?: { next?: string } }
    for (const r of body.data ?? []) {
      const row = toMetaAdDailyRow(r)
      if (row) rows.push(row)
    }
    url = body.paging?.next ?? null
  }
  return rows
}

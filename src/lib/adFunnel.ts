// 업메리 광고 퍼널(노출 → 클릭 → 신청 → 통화 → 결제)과 비용 대비 성과 — 2026-10 대표님 요청.
// AI 호출 없이 코드만으로 집계한다(비용 0). 대시보드 "광고" 카드(AdsPanel)·당근 CSV 업로드(설정)·테스트가 같이 쓴다.
// · 메타 광고: radar 크론이 광고별·일별 노출·클릭·비용·메타 집계 리드를 radar_snapshots(source 'meta_ads')에 저장.
// · 당근 광고: API 대신 설정 화면 CSV 업로드(날짜·비용·노출·클릭) → radar_snapshots(source 'daangn_ads').
// · 신청·통화·결제: leads 테이블. 채널은 utm_source(소문자로 통일)로 묶는다.
import type { LeadRow } from '../types/lead.js'

export const AD_CHANNELS = ['meta', 'daangn', 'threads', 'instagram', '기타'] as const
export type AdChannel = (typeof AD_CHANNELS)[number]

export const AD_CHANNEL_LABEL: Record<AdChannel, string> = {
  meta: '메타 광고',
  daangn: '당근',
  threads: '스레드',
  instagram: '인스타그램',
  기타: '기타·알 수 없음',
}

// utm_source → 채널. 대소문자·공백은 무시한다.
const CHANNEL_ALIASES: Record<Exclude<AdChannel, '기타'>, string[]> = {
  meta: ['meta', 'facebook', 'fb', 'meta_ads', 'facebook_ads'],
  daangn: ['daangn', 'karrot', '당근', '당근마켓'],
  threads: ['threads', 'thread', '스레드'],
  instagram: ['instagram', 'ig', 'insta', '인스타', '인스타그램'],
}

export function normalizeUtm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

export function channelOf(utmSource: string | null | undefined): AdChannel {
  const s = normalizeUtm(utmSource)
  if (!s) return '기타'
  for (const ch of ['meta', 'daangn', 'threads', 'instagram'] as const) {
    if (CHANNEL_ALIASES[ch].includes(s)) return ch
  }
  return '기타'
}

// 메타 광고 인사이트 한 줄(광고 1개 × 하루).
export interface MetaAdDailyRow {
  date: string
  campaignId: string
  campaignName: string
  adId: string
  adName: string
  impressions: number
  clicks: number
  spend: number
  metaLeads: number
}

// 당근 CSV 한 줄(하루).
export interface DaangnDailyRow {
  date: string
  spend: number
  impressions: number
  clicks: number
}

// ── 당근 CSV ──

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

export function normalizeCsvDate(raw: string): string | null {
  const m = raw.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toNumber(raw: string | undefined): number {
  const n = Number((raw ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// 머리줄에서 열을 찾는다. "클릭률"·"클릭당 비용"·"CPC" 같은 파생 지표 열은 피한다.
function findColumn(headers: string[], include: RegExp): number {
  return headers.findIndex((h) => include.test(h) && !/률|율|rate|ctr|당|cpc|cpm|평균/i.test(h))
}

export function parseDaangnCsv(text: string): { rows: DaangnDailyRow[]; error: string | null } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { rows: [], error: '내용이 없어요. 머리줄과 데이터가 있는 CSV인지 확인해 주세요.' }
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ','
  const headers = splitCsvLine(lines[0], delimiter)
  const col = {
    date: findColumn(headers, /날짜|일자|기간|date|day/i),
    spend: findColumn(headers, /비용|금액|소진|지출|spend|cost/i),
    impressions: findColumn(headers, /노출|impression/i),
    clicks: findColumn(headers, /클릭|click/i),
  }
  const missing = Object.entries(col)
    .filter(([, i]) => i < 0)
    .map(([k]) => ({ date: '날짜', spend: '비용', impressions: '노출', clicks: '클릭' })[k])
  if (missing.length > 0) return { rows: [], error: `CSV 머리줄에서 ${missing.join('·')} 열을 찾지 못했어요.` }
  const byDate = new Map<string, DaangnDailyRow>()
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter)
    const date = normalizeCsvDate(cells[col.date] ?? '')
    if (!date) continue // 합계 줄 등은 건너뜀
    const prev = byDate.get(date) ?? { date, spend: 0, impressions: 0, clicks: 0 }
    byDate.set(date, {
      date,
      spend: prev.spend + toNumber(cells[col.spend]),
      impressions: prev.impressions + toNumber(cells[col.impressions]),
      clicks: prev.clicks + toNumber(cells[col.clicks]),
    })
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (rows.length === 0) return { rows: [], error: '날짜를 읽을 수 있는 줄이 없어요. 날짜 형식(예: 2026-10-19)을 확인해 주세요.' }
  return { rows, error: null }
}

// 새로 올린 날짜는 덮어쓰고, 나머지 날짜는 그대로 둔다(여러 번 나눠 올려도 쌓이게).
export function mergeDaangnRows(prev: DaangnDailyRow[], next: DaangnDailyRow[]): DaangnDailyRow[] {
  const map = new Map(prev.map((r) => [r.date, r]))
  for (const r of next) map.set(r.date, r)
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ── 집계 ──

export function kstDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// 기간 = 어제까지 N일(KST). 광고비는 하루가 끝나야 확정되므로 신청도 같은 날짜 범위로 맞춘다.
export function periodRange(days: number, todayKst: string): { from: string; to: string } {
  const to = addDays(todayKst, -1)
  return { from: addDays(to, -(days - 1)), to }
}

export interface FunnelStats {
  impressions: number | null
  clicks: number | null
  spend: number | null
  leads: number
  calls: number
  purchases: number
  revenue: number
  metaLeads?: number
}

export interface ChannelFunnel extends FunnelStats {
  channel: AdChannel
}

export interface AdFunnel extends FunnelStats {
  adId: string
  adName: string
  campaignName: string
}

export interface AdFunnelReport {
  from: string
  to: string
  channels: ChannelFunnel[]
  ads: AdFunnel[]
  unmatchedMetaLeads: number
  yesterdayMetaSpend: number | null
}

function leadCounts(leads: LeadRow[]): Pick<FunnelStats, 'leads' | 'calls' | 'purchases' | 'revenue'> {
  return {
    leads: leads.length,
    // 통화 = 통화 완료까지 간 사람(결제까지 간 사람 포함).
    calls: leads.filter((l) => l.called_at || l.paid_at).length,
    purchases: leads.filter((l) => l.paid_at).length,
    revenue: leads.reduce((s, l) => s + (l.paid_at ? (l.paid_amount ?? 0) : 0), 0),
  }
}

export function buildAdFunnelReport(params: {
  leads: LeadRow[]
  metaRows: MetaAdDailyRow[]
  daangnRows: DaangnDailyRow[]
  days: number
  todayKst: string
}): AdFunnelReport {
  const { from, to } = periodRange(params.days, params.todayKst)
  const inRange = (d: string) => d >= from && d <= to
  const leads = params.leads.filter((l) => inRange(kstDateOf(l.created_at)))
  const metaRows = params.metaRows.filter((r) => inRange(r.date))
  const daangnRows = params.daangnRows.filter((r) => inRange(r.date))
  const hasMeta = params.metaRows.length > 0
  const hasDaangn = params.daangnRows.length > 0

  const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0)
  const channels: ChannelFunnel[] = AD_CHANNELS.map((channel) => {
    const own = leads.filter((l) => channelOf(l.utm_source) === channel)
    const base = { channel, ...leadCounts(own) }
    if (channel === 'meta' && hasMeta) {
      return {
        ...base,
        impressions: sum(metaRows, (r) => r.impressions),
        clicks: sum(metaRows, (r) => r.clicks),
        spend: sum(metaRows, (r) => r.spend),
        metaLeads: sum(metaRows, (r) => r.metaLeads),
      }
    }
    if (channel === 'daangn' && hasDaangn) {
      return {
        ...base,
        impressions: sum(daangnRows, (r) => r.impressions),
        clicks: sum(daangnRows, (r) => r.clicks),
        spend: sum(daangnRows, (r) => r.spend),
      }
    }
    return { ...base, impressions: null, clicks: null, spend: null }
  })

  // 메타 광고별 — 리드는 utm_content를 광고 ID 또는 광고 이름(소문자)과 맞춘다.
  const metaLeadRows = leads.filter((l) => channelOf(l.utm_source) === 'meta')
  const adMap = new Map<string, { adName: string; campaignName: string; rows: MetaAdDailyRow[] }>()
  for (const r of metaRows) {
    const cur = adMap.get(r.adId) ?? { adName: r.adName, campaignName: r.campaignName, rows: [] }
    cur.rows.push(r)
    adMap.set(r.adId, cur)
  }
  const matched = new Set<string>()
  const ads: AdFunnel[] = [...adMap.entries()].map(([adId, a]) => {
    const keys = new Set([normalizeUtm(adId), normalizeUtm(a.adName)].filter(Boolean))
    const own = metaLeadRows.filter((l) => keys.has(normalizeUtm(l.utm_content)))
    own.forEach((l) => matched.add(l.id))
    return {
      adId,
      adName: a.adName,
      campaignName: a.campaignName,
      impressions: sum(a.rows, (r) => r.impressions),
      clicks: sum(a.rows, (r) => r.clicks),
      spend: sum(a.rows, (r) => r.spend),
      metaLeads: sum(a.rows, (r) => r.metaLeads),
      ...leadCounts(own),
    }
  })
  ads.sort((x, y) => (y.spend ?? 0) - (x.spend ?? 0))

  return {
    from,
    to,
    channels,
    ads,
    unmatchedMetaLeads: metaLeadRows.filter((l) => !matched.has(l.id)).length,
    yesterdayMetaSpend: hasMeta ? sum(params.metaRows.filter((r) => r.date === to), (r) => r.spend) : null,
  }
}

// 표시용 비율 — 분모가 없으면 null(화면에서 "—").
export function costPer(spend: number | null, count: number): number | null {
  return spend !== null && count > 0 ? spend / count : null
}

export function roas(revenue: number, spend: number | null): number | null {
  return spend !== null && spend > 0 ? revenue / spend : null
}

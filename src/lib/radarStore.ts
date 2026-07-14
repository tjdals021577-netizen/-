// 레이더 크론(api/cron/radar.ts)이 매일 Supabase radar_snapshots에 저장한
// 최신 GA4 스냅샷을 프론트에서 읽기 전용으로 가져온다. anon 키로 select만 하므로
// 안전하고, remoteSync.ts와 동일한 환경변수 정제 방식을 쓴다.
import type { Brand } from '../types/brand.js'

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}

const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

export interface RadarSnapshot {
  brand: Brand
  source: string
  periodLabel: string
  sessions: number
  activeUsers: number
  conversions: number
  topPages: { path: string; views: number }[]
  trafficSources: { source: string; sessions: number }[]
  naverLandingPages: { landingPage: string; sessions: number }[]
  orderCount: number | null
  revenueKrw: number | null
  createdAt: string
}

function fromRow(row: Record<string, unknown>): RadarSnapshot {
  return {
    brand: String(row.brand ?? '') as Brand,
    source: String(row.source ?? ''),
    periodLabel: String(row.period_label ?? ''),
    sessions: Number(row.sessions ?? 0),
    activeUsers: Number(row.active_users ?? 0),
    conversions: Number(row.conversions ?? 0),
    topPages: Array.isArray(row.top_pages) ? (row.top_pages as RadarSnapshot['topPages']) : [],
    trafficSources: Array.isArray(row.traffic_sources)
      ? (row.traffic_sources as RadarSnapshot['trafficSources'])
      : [],
    naverLandingPages: Array.isArray(row.naver_landing_pages)
      ? (row.naver_landing_pages as RadarSnapshot['naverLandingPages'])
      : [],
    orderCount: typeof row.order_count === 'number' ? row.order_count : null,
    revenueKrw: typeof row.revenue_krw === 'number' ? row.revenue_krw : null,
    createdAt: String(row.created_at ?? ''),
  }
}

export async function fetchLatestRadarSnapshot(
  brand: Brand,
  source?: string,
): Promise<RadarSnapshot | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  try {
    const sourceFilter = source ? `&source=eq.${encodeURIComponent(source)}` : ''
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/radar_snapshots?brand=eq.${encodeURIComponent(brand)}${sourceFilter}&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return null
    const rows = (await res.json()) as Record<string, unknown>[]
    return rows[0] ? fromRow(rows[0]) : null
  } catch {
    return null
  }
}

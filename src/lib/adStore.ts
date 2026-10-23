// 광고 데이터 읽기·쓰기(업메리) — radar_snapshots의 광고 줄 목록(traffic_sources 칸)을 다룬다.
// · meta_ads: radar 크론이 매일 최근 30일치를 저장 → 최신 1행만 읽으면 된다.
// · daangn_ads: 설정 화면 CSV 업로드 → 직전 최신 행과 날짜별로 합쳐 새 행으로 저장(올릴수록 쌓임).
// radar_snapshots는 공개 키로 select·insert가 열려 있어 브라우저에서 바로 읽고 쓴다(광고 숫자라 개인정보 없음).
import type { DaangnDailyRow, MetaAdDailyRow } from './adFunnel'

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}

const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)
const BRAND = '업메리'

export interface AdRowsSnapshot<T> {
  rows: T[]
  createdAt: string | null
}

async function latestRows<T>(source: string): Promise<AdRowsSnapshot<T>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { rows: [], createdAt: null }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/radar_snapshots?brand=eq.${encodeURIComponent(BRAND)}&source=eq.${source}&order=created_at.desc&limit=1&select=traffic_sources,created_at`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return { rows: [], createdAt: null }
    const data = (await res.json()) as { traffic_sources?: unknown; created_at?: string }[]
    const row = data[0]
    return {
      rows: Array.isArray(row?.traffic_sources) ? (row.traffic_sources as T[]) : [],
      createdAt: row?.created_at ?? null,
    }
  } catch {
    return { rows: [], createdAt: null }
  }
}

export function fetchMetaAdRows(): Promise<AdRowsSnapshot<MetaAdDailyRow>> {
  return latestRows<MetaAdDailyRow>('meta_ads')
}

export function fetchDaangnRows(): Promise<AdRowsSnapshot<DaangnDailyRow>> {
  return latestRows<DaangnDailyRow>('daangn_ads')
}

export async function saveDaangnRows(rows: DaangnDailyRow[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase 환경변수가 없어 저장할 수 없어요.')
  const nowIso = new Date().toISOString()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/radar_snapshots`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      brand: BRAND,
      source: 'daangn_ads',
      period_label: rows.length > 0 ? `${rows[0].date}~${rows[rows.length - 1].date} 당근 CSV` : '당근 CSV',
      sessions: Math.round(rows.reduce((s, r) => s + r.clicks, 0)),
      active_users: Math.round(rows.reduce((s, r) => s + r.impressions, 0)),
      conversions: 0,
      top_pages: [],
      traffic_sources: rows,
      created_at: nowIso,
    }),
  })
  if (!res.ok) throw new Error(`저장 실패 (${res.status}) ${(await res.text()).slice(0, 200)}`)
}

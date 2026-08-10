// 레이더 크론(api/cron/radar.ts)이 매일 Supabase youtube_video_stats에 저장한
// 최근 영상 통계를 프론트에서 읽기 전용으로 가져온다. anon 키로 select만
// 하므로 안전하고, radarStore.ts와 동일한 환경변수 정제 방식을 쓴다.
import type { Brand } from '../types/brand.js'

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}

const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

export interface YoutubeVideoStatRow {
  videoId: string
  brand: Brand
  title: string
  publishedAt: string
  viewCount: number
  likeCount: number
  commentCount: number
  thumbnailUrl: string
}

function fromRow(row: Record<string, unknown>): YoutubeVideoStatRow {
  return {
    videoId: String(row.video_id ?? ''),
    brand: String(row.brand ?? '') as Brand,
    title: String(row.title ?? ''),
    publishedAt: String(row.published_at ?? ''),
    viewCount: Number(row.view_count ?? 0),
    likeCount: Number(row.like_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    thumbnailUrl: String(row.thumbnail_url ?? ''),
  }
}

export async function fetchYoutubeVideoStats(brand: Brand, limit = 10): Promise<YoutubeVideoStatRow[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/youtube_video_stats?brand=eq.${encodeURIComponent(brand)}&order=published_at.desc&limit=${limit}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return []
    const rows = (await res.json()) as Record<string, unknown>[]
    return rows.map(fromRow)
  } catch {
    return []
  }
}

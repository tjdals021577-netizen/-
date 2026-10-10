// 레이더 크론(api/cron/radar.ts)이 매일 Supabase에 저장한 스레드 성과를
// 프론트에서 읽기 전용으로 가져온다. youtubeStatsStore.ts와 동일한 방식
// (anon 키로 select만). 마잘남 스레드 계정 전용이지만 brand 파라미터로 일반화.
import type { Brand } from '../types/brand.js'

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}

const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

export interface ThreadPostStatRow {
  threadId: string
  brand: Brand
  text: string
  permalink: string
  postedAt: string
  views: number
  likes: number
  replies: number
  reposts: number
  quotes: number
}

export interface ThreadFollowerDayRow {
  date: string
  followerCount: number
}

function headers() {
  return { apikey: SUPABASE_ANON_KEY as string, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
}

function postFromRow(row: Record<string, unknown>): ThreadPostStatRow {
  return {
    threadId: String(row.thread_id ?? ''),
    brand: String(row.brand ?? '') as Brand,
    text: String(row.text ?? ''),
    permalink: String(row.permalink ?? ''),
    postedAt: String(row.posted_at ?? ''),
    views: Number(row.views ?? 0),
    likes: Number(row.likes ?? 0),
    replies: Number(row.replies ?? 0),
    reposts: Number(row.reposts ?? 0),
    quotes: Number(row.quotes ?? 0),
  }
}

export async function fetchThreadPostStats(brand: Brand, limit = 15): Promise<ThreadPostStatRow[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/thread_post_stats?brand=eq.${encodeURIComponent(brand)}&order=posted_at.desc&limit=${limit}`,
      { headers: headers() },
    )
    if (!res.ok) return []
    const rows = (await res.json()) as Record<string, unknown>[]
    return rows.map(postFromRow)
  } catch {
    return []
  }
}

// 최근 N일치 팔로워 스냅샷을 최신순으로 가져온다 — [0]=오늘, [1]=어제 …
// UI에서 오늘값과 어제값의 차이로 일일 증감을 계산한다.
export async function fetchThreadFollowerDaily(brand: Brand, limit = 8): Promise<ThreadFollowerDayRow[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/thread_follower_daily?brand=eq.${encodeURIComponent(brand)}&order=date.desc&limit=${limit}`,
      { headers: headers() },
    )
    if (!res.ok) return []
    const rows = (await res.json()) as Record<string, unknown>[]
    return rows.map((r) => ({
      date: String(r.date ?? ''),
      followerCount: Number(r.follower_count ?? 0),
    }))
  } catch {
    return []
  }
}

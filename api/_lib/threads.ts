// Threads(메타) Graph API — 읽기 전용 성과 수집. 마잘남 본인 계정의 최근 글
// 조회수·좋아요·답글·리포스트·인용 수와 계정 팔로워 수를 가져온다.
// 공식 문서: https://developers.facebook.com/docs/threads
//   - 최근 글: GET /me/threads?fields=id,media_type,text,permalink,timestamp
//   - 글 인사이트: GET /{media-id}/insights?metric=views,likes,replies,reposts,quotes
//   - 계정 인사이트: GET /me/threads_insights?metric=followers_count
// 필요한 권한(스코프): threads_basic, threads_manage_insights (발행은 안 하므로
// threads_content_publish는 필요 없음 — 읽기 전용).
//
// 주의: 인사이트 응답이 지표에 따라 values:[{value}] 또는 total_value:{value}로
// 오기 때문에 두 형태를 모두 방어적으로 파싱한다. 처음 실제로 돌 때 rawSample을
// work_log에 남겨서 필드가 다르면 바로 확인·수정할 수 있게 한다(아임웹과 동일한 방식).

const BASE_URL = 'https://graph.threads.net/v1.0'

export interface ThreadPostStat {
  threadId: string
  text: string
  permalink: string
  timestamp: string
  views: number
  likes: number
  replies: number
  reposts: number
  quotes: number
}

export interface ThreadStatsResult {
  posts: ThreadPostStat[]
  followerCount: number | null
  rawSample: string
}

interface ThreadsListResponse {
  data?: {
    id?: string
    media_type?: string
    text?: string
    permalink?: string
    timestamp?: string
  }[]
}

interface InsightMetric {
  name?: string
  values?: { value?: number }[]
  total_value?: { value?: number }
}

interface InsightsResponse {
  data?: InsightMetric[]
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Threads API 실패: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

// 지표 하나의 값을 values / total_value 두 형태 모두에서 안전하게 꺼낸다.
function metricValue(metrics: InsightMetric[] | undefined, name: string): number {
  const m = metrics?.find((x) => x.name === name)
  if (!m) return 0
  const fromValues = m.values?.[0]?.value
  if (typeof fromValues === 'number') return fromValues
  const fromTotal = m.total_value?.value
  if (typeof fromTotal === 'number') return fromTotal
  return 0
}

async function fetchPostInsights(threadId: string, accessToken: string): Promise<InsightMetric[]> {
  const metrics = 'views,likes,replies,reposts,quotes'
  const url = `${BASE_URL}/${encodeURIComponent(threadId)}/insights?metric=${metrics}&access_token=${encodeURIComponent(accessToken)}`
  try {
    const data = await getJson<InsightsResponse>(url)
    return data.data ?? []
  } catch {
    // 글 하나의 인사이트 조회가 실패해도(예: 너무 오래된 글) 전체를 멈추지 않는다.
    return []
  }
}

async function fetchFollowerCount(accessToken: string): Promise<number | null> {
  const url = `${BASE_URL}/me/threads_insights?metric=followers_count&access_token=${encodeURIComponent(accessToken)}`
  try {
    const data = await getJson<InsightsResponse>(url)
    const v = metricValue(data.data, 'followers_count')
    return Number.isFinite(v) ? v : null
  } catch {
    // 팔로워 수 조회 실패는 치명적이지 않다 — null로 두고 글 통계는 계속 수집.
    return null
  }
}

export async function fetchThreadStats(params: {
  accessToken: string
  maxResults?: number
}): Promise<ThreadStatsResult> {
  const { accessToken, maxResults = 15 } = params

  const listUrl = `${BASE_URL}/me/threads?fields=id,media_type,text,permalink,timestamp&limit=${maxResults}&access_token=${encodeURIComponent(accessToken)}`
  const list = await getJson<ThreadsListResponse>(listUrl)
  const items = (list.data ?? []).filter((it) => typeof it.id === 'string' && it.id.length > 0)

  const posts: ThreadPostStat[] = []
  let firstInsightSample = ''
  for (const it of items) {
    const threadId = it.id as string
    const metrics = await fetchPostInsights(threadId, accessToken)
    if (!firstInsightSample && metrics.length > 0) {
      firstInsightSample = JSON.stringify(metrics).slice(0, 800)
    }
    posts.push({
      threadId,
      text: it.text ?? '',
      permalink: it.permalink ?? '',
      timestamp: it.timestamp ?? '',
      views: metricValue(metrics, 'views'),
      likes: metricValue(metrics, 'likes'),
      replies: metricValue(metrics, 'replies'),
      reposts: metricValue(metrics, 'reposts'),
      quotes: metricValue(metrics, 'quotes'),
    })
  }

  const followerCount = await fetchFollowerCount(accessToken)
  const rawSample = `목록 ${items.length}건 · 팔로워 ${followerCount ?? '?'}<br/>첫 글 인사이트 원본: ${firstInsightSample || '(없음)'}`

  return { posts, followerCount, rawSample }
}

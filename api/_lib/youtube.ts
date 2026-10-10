// YouTube Data API v3를 API 키만으로 호출한다(공개 통계라 OAuth 불필요) —
// 채널의 업로드 재생목록에서 최근 영상 ID를 가져온 뒤, 그 영상들의
// 조회수·좋아요·댓글 수를 한 번에 조회한다.

export interface YoutubeVideoStat {
  videoId: string
  title: string
  publishedAt: string
  viewCount: number
  likeCount: number
  commentCount: number
  thumbnailUrl: string
}

interface ChannelsResponse {
  items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]
}

interface PlaylistItemsResponse {
  items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[]
}

interface VideosResponse {
  items?: {
    id?: string
    snippet?: { title?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string } } }
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
  }[]
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`YouTube API 실패: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

async function getUploadsPlaylistId(channelId: string, apiKey: string): Promise<string> {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`
  const data = await getJson<ChannelsResponse>(url)
  const playlistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!playlistId) throw new Error('업로드 재생목록을 찾을 수 없습니다 — 채널 ID를 확인해주세요.')
  return playlistId
}

async function getRecentVideoIds(playlistId: string, apiKey: string, maxResults: number): Promise<string[]> {
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=${maxResults}&key=${apiKey}`
  const data = await getJson<PlaylistItemsResponse>(url)
  return (data.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id))
}

export async function fetchRecentVideoStats(params: {
  channelId: string
  apiKey: string
  maxResults?: number
}): Promise<YoutubeVideoStat[]> {
  const { channelId, apiKey, maxResults = 10 } = params
  const playlistId = await getUploadsPlaylistId(channelId, apiKey)
  const videoIds = await getRecentVideoIds(playlistId, apiKey, maxResults)
  if (videoIds.length === 0) return []

  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(',')}&key=${apiKey}`
  const data = await getJson<VideosResponse>(url)
  return (data.items ?? []).map((item) => ({
    videoId: item.id ?? '',
    title: item.snippet?.title ?? '(제목 없음)',
    publishedAt: item.snippet?.publishedAt ?? '',
    viewCount: Number(item.statistics?.viewCount ?? 0),
    likeCount: Number(item.statistics?.likeCount ?? 0),
    commentCount: Number(item.statistics?.commentCount ?? 0),
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? '',
  }))
}

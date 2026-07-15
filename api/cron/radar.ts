import type { IncomingMessage, ServerResponse } from 'node:http'
import { supabaseInsert, supabaseSelect } from '../_lib/supabaseAdmin.js'
import { fetchGa4Report } from '../_lib/ga4.js'
import { fetchImwebOrderSummary } from '../_lib/imweb.js'
import { fetchRecentVideoStats } from '../_lib/youtube.js'
import { fetchThreadStats } from '../_lib/threads.js'
import { analyzeYoutubeContent } from '../../src/agents/runYoutubeAnalysis.js'
import { BRANDS, BRAND_CONTEXT, BRAND_CHANNELS, type Brand } from '../../src/types/brand.js'
import { requireCronAuth, sendJson } from '../_lib/cronHandler.js'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 아임웹 매출은 "어제 하루"가 아니라 "이번 달 누적(오늘 포함)"으로 보여준다
// (대표님 요청) — 이번 달 1일 00:00 ~ 오늘까지, 전부 KST 기준.
function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
function kstMonthStart(): string {
  return `${kstToday().slice(0, 7)}-01`
}

// 브랜드별 GA4 속성 ID / 아임웹 API 키 환경변수 — 공용 자격증명(GA4 서비스 계정,
// 아임웹은 브랜드마다 발급받음)은 재사용하고 브랜드별 값만 다르다. 특정 브랜드의
// 환경변수가 비어있으면 그 소스는 조용히 건너뛴다(에러 아님 — 하나씩 순차 연결 전제).
const GA4_PROPERTY_ID_ENV_KEY: Record<Brand, string> = {
  업메리: 'GA4_PROPERTY_ID_UPMERY',
  마잘남: 'GA4_PROPERTY_ID_MAJALNAM',
}

const IMWEB_ENV_KEYS: Record<Brand, { apiKey: string; secret: string }> = {
  업메리: { apiKey: 'IMWEB_API_KEY_UPMERY', secret: 'IMWEB_SECRET_KEY_UPMERY' },
  마잘남: { apiKey: 'IMWEB_API_KEY_MAJALNAM', secret: 'IMWEB_SECRET_KEY_MAJALNAM' },
}

const YOUTUBE_CHANNEL_ID_ENV_KEY: Record<Brand, string> = {
  업메리: 'YOUTUBE_CHANNEL_ID_UPMERY',
  마잘남: 'YOUTUBE_CHANNEL_ID_MAJALNAM',
}

// 스레드(메타) 액세스 토큰 — 대표님 결정: 성과 수집만, 마잘남 본인 계정만.
// 업메리는 스레드를 운영하지 않아 값이 비어 있고 조용히 건너뛴다.
const THREADS_TOKEN_ENV_KEY: Record<Brand, string> = {
  업메리: 'THREADS_ACCESS_TOKEN_UPMERY',
  마잘남: 'THREADS_ACCESS_TOKEN_MAJALNAM',
}

// 매일 07:50 KST에 돌아서(모닝 크론 10분 전, vercel.json 참고), 어제 하루치
// GA4 방문자 데이터 + 아임웹 주문/매출 데이터를 브랜드별로 Supabase radar_snapshots에
// 저장한다. 모닝 크론이 이 값을 읽어서 브리핑에 반영하고, 대시보드도 이 테이블을 읽는다.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return

  const results: string[] = []
  const apiKey = process.env.ANTHROPIC_API_KEY
  const ga4KeyJson = process.env.GA4_SERVICE_ACCOUNT_KEY
  const nowIso = new Date().toISOString()

  for (const brand of BRANDS) {
    // GA4
    const propertyId = process.env[GA4_PROPERTY_ID_ENV_KEY[brand]]
    if (ga4KeyJson && propertyId) {
      try {
        const report = await fetchGa4Report({
          serviceAccountKeyJson: ga4KeyJson,
          propertyId,
          startDate: 'yesterday',
          endDate: 'yesterday',
        })
        await supabaseInsert('radar_snapshots', {
          id: makeId(),
          brand,
          source: 'ga4',
          period_label: '어제',
          sessions: report.sessions,
          active_users: report.activeUsers,
          conversions: report.conversions,
          top_pages: report.topPages,
          traffic_sources: report.trafficSources,
          naver_landing_pages: report.naverLandingPages,
          blog_referrers: report.blogReferrers,
          created_at: nowIso,
        })
        results.push(`${brand} GA4: 방문자 ${report.activeUsers}명 / 세션 ${report.sessions}회`)
      } catch (err) {
        results.push(`${brand} GA4: 실패 (${err instanceof Error ? err.message : String(err)})`)
      }
    } else {
      results.push(`${brand} GA4: 건너뜀 (미설정)`)
    }

    // 아임웹
    const imwebKeys = IMWEB_ENV_KEYS[brand]
    const imwebApiKey = process.env[imwebKeys.apiKey]
    const imwebSecret = process.env[imwebKeys.secret]
    if (imwebApiKey && imwebSecret) {
      try {
        const summary = await fetchImwebOrderSummary({
          apiKey: imwebApiKey,
          secretKey: imwebSecret,
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
        // 첫 실행 때 응답 필드명이 예상과 다를 수 있어 원본 샘플을 work_log에 남겨서
        // 나중에 확인할 수 있게 한다(레이더 자체 진단용 — 실패는 아님).
        await supabaseInsert('work_log', {
          id: makeId(),
          agent: 'radar',
          brand,
          kind: '아임웹 주문 응답 샘플(디버그)',
          status: 'done',
          status_label: '완료',
          started_at: nowIso,
          ended_at: nowIso,
          note: `주문 ${summary.orderCount}건, 매출 ${summary.revenueKrw ?? '(필드 확인 필요)'}원`,
          detail_html: summary.rawSample,
        })
        results.push(`${brand} 아임웹: 주문 ${summary.orderCount}건 / 매출 ${summary.revenueKrw ?? '?'}원`)
      } catch (err) {
        results.push(`${brand} 아임웹: 실패 (${err instanceof Error ? err.message : String(err)})`)
      }
    } else {
      results.push(`${brand} 아임웹: 건너뜀 (미설정)`)
    }

    // 유튜브 — 조회수·좋아요·댓글 수는 공개 정보라 API 키만으로 조회 가능
    // (OAuth 불필요). 채널 탭 "내 콘텐츠 분석"이 이 테이블을 읽는다.
    const youtubeApiKey = process.env.YOUTUBE_API_KEY
    const youtubeChannelId = process.env[YOUTUBE_CHANNEL_ID_ENV_KEY[brand]]
    if (youtubeApiKey && youtubeChannelId) {
      try {
        // 분석을 매일 돌리면 새 영상이 없는 날에도 API 비용이 나간다(대표님
        // 지적) — 갱신 전에 기존 video_id를 먼저 조회해서, 이번에 처음 보는
        // 영상이 있을 때만 AI 분석을 실행하도록 제한한다. 통계 자체(조회수
        // 갱신)는 비용이 안 드는 순수 API 호출이라 매일 갱신해도 무방하다.
        const existingRows = await supabaseSelect<{ video_id: string }>(
          'youtube_video_stats',
          `brand=eq.${encodeURIComponent(brand)}&select=video_id`,
        )
        const existingIds = new Set(existingRows.map((r) => r.video_id))

        const stats = await fetchRecentVideoStats({ channelId: youtubeChannelId, apiKey: youtubeApiKey })
        const hasNewVideo = stats.some((v) => !existingIds.has(v.videoId))
        await Promise.all(
          stats.map((v) =>
            supabaseInsert('youtube_video_stats', {
              video_id: v.videoId,
              brand,
              title: v.title,
              published_at: v.publishedAt || null,
              view_count: v.viewCount,
              like_count: v.likeCount,
              comment_count: v.commentCount,
              thumbnail_url: v.thumbnailUrl,
              updated_at: nowIso,
            }),
          ),
        )
        results.push(`${brand} 유튜브: 영상 ${stats.length}개 통계 갱신`)

        // 통계만 쌓아두지 않고, 새 영상이 올라온 날에만 AI가 어떤 영상이 잘
        // 됐는지 분석해서 팀채팅(전략 카드)·결재함에 자동으로 올려준다 —
        // 채널 탭 "내 콘텐츠 분석"은 숫자만 보여주고, 실제 해석·다음 기획
        // 방향은 여기서 나온다.
        if (apiKey && stats.length > 0 && hasNewVideo) {
          try {
            const analysis = await analyzeYoutubeContent({ apiKey, brandContext: BRAND_CONTEXT[brand], stats })
            const analysisHtml = `<b>${analysis.summary}</b><br/><br/><b>분석</b><br/>${analysis.findings
              .map((f) => `- ${f}`)
              .join('<br/>')}<br/><br/><b>다음 기획 추천</b><br/>${analysis.nextSteps
              .map((n) => `- ${n}`)
              .join('<br/>')}`
            const analysisLogId = makeId()
            await supabaseInsert('work_log', {
              id: analysisLogId,
              agent: 'remix',
              brand,
              kind: '유튜브 콘텐츠 분석(자동)',
              status: 'done',
              status_label: '완료',
              started_at: nowIso,
              ended_at: nowIso,
              note: analysis.summary,
              detail_html: analysisHtml,
            })
            await supabaseInsert('approval_queue', {
              id: makeId(),
              agent: 'remix',
              brand,
              title: `유튜브 콘텐츠 분석 — ${analysis.summary}`,
              content_html: analysisHtml,
              passed: true,
              score_label: '분석 리포트',
              created_at: nowIso,
              status: 'pending',
              source_work_log_id: analysisLogId,
            })
            results.push(`${brand} 유튜브 분석: 완료`)
          } catch (err) {
            results.push(`${brand} 유튜브 분석: 실패 (${err instanceof Error ? err.message : String(err)})`)
          }
        } else if (apiKey && stats.length > 0) {
          results.push(`${brand} 유튜브 분석: 건너뜀 (새 영상 없음)`)
        }
      } catch (err) {
        results.push(`${brand} 유튜브: 실패 (${err instanceof Error ? err.message : String(err)})`)
      }
    } else {
      results.push(`${brand} 유튜브: 건너뜀 (미설정)`)
    }

    // 스레드(메타) — 성과 수집만(AI 분석 없음, 토큰 0). 스레드를 운영하는
    // 브랜드(마잘남)이면서 액세스 토큰이 있을 때만 돈다. 조회수·좋아요·답글·
    // 리포스트·인용 + 계정 팔로워 수를 저장한다.
    const threadsToken = process.env[THREADS_TOKEN_ENV_KEY[brand]]
    if (BRAND_CHANNELS[brand].includes('스레드') && threadsToken) {
      try {
        const { posts, followerCount, rawSample } = await fetchThreadStats({ accessToken: threadsToken })
        await Promise.all(
          posts.map((p) =>
            supabaseInsert('thread_post_stats', {
              thread_id: p.threadId,
              brand,
              text: p.text,
              permalink: p.permalink,
              posted_at: p.timestamp || null,
              views: p.views,
              likes: p.likes,
              replies: p.replies,
              reposts: p.reposts,
              quotes: p.quotes,
              updated_at: nowIso,
            }),
          ),
        )
        if (followerCount !== null) {
          // 날짜별(KST 기준)로 한 행씩 쌓는다 — 같은 날 재실행은 덮어쓰고,
          // 날이 바뀌면 새 행이 생겨 "어제 대비 오늘 증감"을 계산할 수 있다.
          const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
          await supabaseInsert('thread_follower_daily', {
            brand,
            date: kstDate,
            follower_count: followerCount,
            created_at: nowIso,
          })
        }
        // 첫 실행 때 인사이트 응답 필드가 예상과 다를 수 있어 원본 샘플을
        // work_log에 남긴다(아임웹과 동일 — 필드 다르면 바로 확인·수정).
        await supabaseInsert('work_log', {
          id: makeId(),
          agent: 'radar',
          brand,
          kind: '스레드 성과 응답 샘플(디버그)',
          status: 'done',
          status_label: '완료',
          started_at: nowIso,
          ended_at: nowIso,
          note: `글 ${posts.length}개 · 팔로워 ${followerCount ?? '?'}명`,
          detail_html: rawSample,
        })
        results.push(`${brand} 스레드: 글 ${posts.length}개 통계 갱신 / 팔로워 ${followerCount ?? '?'}명`)
      } catch (err) {
        results.push(`${brand} 스레드: 실패 (${err instanceof Error ? err.message : String(err)})`)
      }
    } else {
      results.push(`${brand} 스레드: 건너뜀 (미설정)`)
    }
  }

  sendJson(res, 200, { ok: true, results })
}

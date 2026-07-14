import type { IncomingMessage, ServerResponse } from 'node:http'
import { supabaseInsert } from '../_lib/supabaseAdmin.js'
import { fetchGa4Report } from '../_lib/ga4.js'
import { fetchImwebOrderSummary } from '../_lib/imweb.js'
import { fetchRecentVideoStats } from '../_lib/youtube.js'
import { analyzeYoutubeContent } from '../../src/agents/runYoutubeAnalysis.js'
import { BRANDS, BRAND_CONTEXT, type Brand } from '../../src/types/brand.js'
import { requireCronAuth, sendJson } from '../_lib/cronHandler.js'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function yesterdayIsoDate(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
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

// 매일 07:50 KST에 돌아서(모닝 크론 10분 전, vercel.json 참고), 어제 하루치
// GA4 방문자 데이터 + 아임웹 주문/매출 데이터를 브랜드별로 Supabase radar_snapshots에
// 저장한다. 모닝 크론이 이 값을 읽어서 브리핑에 반영하고, 대시보드도 이 테이블을 읽는다.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return

  const results: string[] = []
  const apiKey = process.env.ANTHROPIC_API_KEY
  const ga4KeyJson = process.env.GA4_SERVICE_ACCOUNT_KEY
  const nowIso = new Date().toISOString()
  const yesterday = yesterdayIsoDate()

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
          dateFrom: yesterday,
          dateTo: yesterday,
        })
        await supabaseInsert('radar_snapshots', {
          id: makeId(),
          brand,
          source: 'imweb',
          period_label: '어제',
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
        const stats = await fetchRecentVideoStats({ channelId: youtubeChannelId, apiKey: youtubeApiKey })
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

        // 통계만 쌓아두지 않고, 매일 AI가 어떤 영상이 잘 됐는지 분석해서
        // 팀채팅(전략 카드)·결재함에 자동으로 올려준다 — 채널 탭 "내 콘텐츠
        // 분석"은 숫자만 보여주고, 실제 해석·다음 기획 방향은 여기서 나온다.
        if (apiKey && stats.length > 0) {
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
        }
      } catch (err) {
        results.push(`${brand} 유튜브: 실패 (${err instanceof Error ? err.message : String(err)})`)
      }
    } else {
      results.push(`${brand} 유튜브: 건너뜀 (미설정)`)
    }
  }

  sendJson(res, 200, { ok: true, results })
}

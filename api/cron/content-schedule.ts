// 매일 06:00 KST(대행 크론보다 먼저)에 돌아서, 대표님이 정한 주간 고정
// 업로드 루틴(유튜브 월·수·금 / 블로그 화·목·토·일, 업메리+마잘남)에 맞춰
// 오늘 해당하는 콘텐츠를 자동으로 기획(초안 생성)해서 캘린더에 올린다.
// 사람이 라이터/리믹서 화면에서 "생성" 버튼을 누른 것과 같은 결과물이며,
// 채점(라이터는 3인 위원회, 리믹서는 채점 없음)까지 동일하게 거친다.
//
// 체크리스트 5단계(기획/컨펌/피드백/데이터 파악/레퍼런스) 중 "기획"만 여기서
// 자동으로 체크해둔다 — 나머지는 대표님이 캘린더 화면에서 직접 체크하는
// 수동 항목이다(게시물 단위 성과 추적 인프라가 없어 자동 감지가 불가능하므로
// 억지로 자동화하지 않음).
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateBlogDraft, runBlogReviewsResilient } from '../../src/agents/runBlogReview.js'
import { generateRemixPlan } from '../../src/agents/runRemix.js'
import { PASS_THRESHOLD } from '../../src/types/domain.js'
import { BRAND_CONTEXT } from '../../src/types/brand.js'
import type { Brand } from '../../src/types/brand.js'
import type { BlogRole, BlogDraft, BlogReview } from '../../src/types/blog.js'
import type { VisionImageInput } from '../../src/lib/claude.js'
import { getScheduledSlots, kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'
import { makeDefaultChecklist } from '../../src/types/calendar.js'
import { supabaseSelect, supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, sendJson, sendText } from '../_lib/cronHandler.js'

const BLOG_ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']

interface BrainReportRow {
  topic: string
  summary: string
  recommendations: string[]
  findings: { source: string; insight: string }[]
}

// 브레인이 조사해둔 최신 리서치를 라이터·리믹서가 참고할 프롬프트 텍스트로
// 만든다 — 이제 이들은 직접 검색하지 않고 이 자료를 공유받는다(비용 절감).
function formatBrainFindings(report: BrainReportRow | undefined): string | undefined {
  if (!report) return undefined
  const findingsText = (report.findings ?? [])
    .map((f) => `- [${f.source}] ${f.insight}`)
    .join('\n')
  return `주제: ${report.topic}\n요약: ${report.summary}\n${findingsText}`
}

interface CalendarTitleRow {
  title: string
}

interface ContentPhotoRow {
  image_base64: string
  media_type: 'image/png' | 'image/jpeg' | 'image/webp'
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildBlogHtml(draft: BlogDraft, reviews: BlogReview[]): string {
  const reviewHtml = reviews
    .map((r) => `${r.role}: ${r.totalScore}점 — ${r.summary}`)
    .join('<br/>')
  return `<b>${draft.title}</b><br/>${draft.body.replace(/\n/g, '<br/>')}<br/><br/>${reviewHtml}`
}

// 최근 14일간 같은 브랜드·채널에 이미 쓴 제목과 안 겹치는 추천 주제를 브레인
// 리포트에서 하나 골라온다 — 브레인 리포트가 없으면 브랜드 톤 기반 기본 주제로.
async function pickTopic(
  brand: Brand,
  channel: 'blog' | 'youtube',
): Promise<{ topic: string; brainFindings?: string }> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const [reports, recentEntries] = await Promise.all([
    supabaseSelect<BrainReportRow>(
      'brain_reports',
      `brand=eq.${encodeURIComponent(brand)}&order=created_at.desc&limit=1&select=topic,summary,recommendations,findings`,
    ),
    supabaseSelect<CalendarTitleRow>(
      'calendar_entries',
      `brand=eq.${encodeURIComponent(brand)}&channel=eq.${channel}&created_at=gte.${encodeURIComponent(since)}&select=title`,
    ),
  ])
  const brainFindings = formatBrainFindings(reports[0])
  const usedTitles = new Set(recentEntries.map((e) => e.title))
  const recommendations = reports[0]?.recommendations ?? []
  const fresh = recommendations.find((r) => !usedTitles.has(r))
  if (fresh) return { topic: fresh, brainFindings }
  if (recommendations.length > 0) return { topic: recommendations[0], brainFindings }
  // 브레인 리포트가 아직 없을 때의 기본 주제 — 짧고 자연스러운 주제 하나만
  // 준다(톤/맥락은 brandContext로 별도 전달).
  const topic =
    channel === 'blog'
      ? `${brand} 고객들이 요즘 궁금해할 만한 블로그 주제 하나`
      : `${brand} 관련 요즘 반응 좋은 숏폼 유튜브 주제 하나`
  return { topic, brainFindings }
}

async function fetchTodayPhotos(date: string, brand: Brand): Promise<VisionImageInput[]> {
  const rows = await supabaseSelect<ContentPhotoRow>(
    'content_photos',
    `date=eq.${date}&brand=eq.${encodeURIComponent(brand)}&channel=eq.blog&select=image_base64,media_type`,
  )
  return rows.map((r) => ({ imageBase64: r.image_base64, imageMediaType: r.media_type }))
}

interface ContentFeedbackRow {
  context: string
  summary: string
  next_steps: string[]
  created_at: string
}

// 코치·레이더가 분석해둔 지난 성과 피드백(최근 2건)을 프롬프트 텍스트로 만든다 —
// 다음 글/기획을 실제 성과에 맞춰 디벨롭하게 한다(블로그=코치 캡처 분석,
// 유튜브=레이더 자동 분석). 없으면 undefined(그냥 없이 진행).
// content_feedback 테이블이 아직 없어도(404) 자동 기획 전체를 막지 않는다.
async function fetchRecentFeedback(
  brand: Brand,
  channel: 'blog' | 'youtube',
): Promise<string | undefined> {
  try {
    const rows = await supabaseSelect<ContentFeedbackRow>(
      'content_feedback',
      `brand=eq.${encodeURIComponent(brand)}&channel=eq.${channel}&order=created_at.desc&limit=2` +
        `&select=context,summary,next_steps,created_at`,
    )
    if (rows.length === 0) return undefined
    return rows
      .map((r) => {
        const steps = (r.next_steps ?? []).length > 0 ? `\n다음 액션: ${r.next_steps.join(' / ')}` : ''
        return `- (${(r.created_at ?? '').slice(0, 10)}${r.context ? ` · ${r.context}` : ''}) ${r.summary}${steps}`
      })
      .join('\n')
  } catch {
    return undefined
  }
}

async function generateBlogForBrand(apiKey: string, brand: Brand, date: string): Promise<string> {
  const { topic, brainFindings } = await pickTopic(brand, 'blog')
  const [photoImages, pastFeedback] = await Promise.all([
    fetchTodayPhotos(date, brand),
    fetchRecentFeedback(brand, 'blog'),
  ])
  const draft = await generateBlogDraft({
    apiKey,
    topic,
    keyPoints: '',
    photoDescriptions: photoImages.length > 0 ? '' : '(사진 없음 — 지식 베이스와 브레인 리서치 기반으로 상위노출 구조를 참고)',
    brandContext: BRAND_CONTEXT[brand],
    marketFindings: brainFindings,
    pastFeedback,
    photoImages: photoImages.length > 0 ? photoImages : undefined,
  })

  // 3명 심사위원을 병렬로 돌리되, 1명이 실패해도 나머지 채점으로 계속
  // 진행한다 — 예전엔 Promise.all이라 1명만 실패해도 이미 만들어진 초안까지
  // 통째로 버려지고 "오류"만 남았다(라이터 반복 오류의 원인 중 하나).
  // 전원 실패하면 채점 없이 저장하고 "채점 실패"로 표시한다.
  const reviews = await runBlogReviewsResilient({ apiKey, roles: BLOG_ROLES, draft })
  const reviewed = reviews.length > 0
  const avg = reviewed ? reviews.reduce((s, r) => s + r.totalScore, 0) / reviews.length : 0
  const passed = reviewed && avg >= PASS_THRESHOLD
  const scoreNote = reviewed ? `${avg.toFixed(1)}점 ${passed ? '통과' : '미달'}` : '채점 실패 — 내용은 저장됨'
  const nowIso = new Date().toISOString()
  const logId = makeId()

  await supabaseInsert('work_log', {
    id: logId,
    agent: 'writer',
    brand,
    kind: '주간 스케줄 자동 기획',
    status: 'done',
    status_label: '완료',
    started_at: nowIso,
    ended_at: nowIso,
    note: `${scoreNote} · 사진 ${photoImages.length}장 반영`,
    detail_html: buildBlogHtml(draft, reviews),
  })
  await supabaseInsert('approval_queue', {
    id: makeId(),
    agent: 'writer',
    brand,
    title: draft.title,
    content_html: buildBlogHtml(draft, reviews),
    passed,
    score_label: reviewed ? `${avg.toFixed(1)}/100` : '채점 실패',
    created_at: nowIso,
    status: 'pending',
    source_work_log_id: logId,
  })
  await supabaseInsert('calendar_entries', {
    id: makeId(),
    date,
    brand,
    channel: 'blog',
    title: draft.title,
    status: passed ? 'planned' : 'open',
    note: `${scoreNote} (주간 스케줄 자동 기획) · 사진 ${photoImages.length}장`,
    content_html: buildBlogHtml(draft, reviews),
    checklist: makeDefaultChecklist(true),
    created_at: nowIso,
    source_work_log_id: logId,
  })
  return `${brand} 블로그: ${scoreNote}`
}

async function generateYoutubeForBrand(apiKey: string, brand: Brand, date: string): Promise<string> {
  const { topic, brainFindings } = await pickTopic(brand, 'youtube')
  const pastFeedback = await fetchRecentFeedback(brand, 'youtube')
  const plan = await generateRemixPlan({
    apiKey,
    topic,
    referenceText: '',
    brandContext: BRAND_CONTEXT[brand],
    marketFindings: brainFindings,
    pastFeedback,
  })
  const nowIso = new Date().toISOString()
  const logId = makeId()
  // 제목을 기획안 맨 위에 명시하고, 카드 제목도 추천 제목으로 쓴다(대표님 요청:
  // "유튜브 기획엔 제목 꼭 넣어서"). 모델이 title을 비우면 topic으로 폴백.
  const videoTitle = plan.title || topic
  const titleLine = plan.title ? `<b>🎬 제목</b><br/>${plan.title}<br/><br/>` : ''
  const contentHtml = `${titleLine}<b>훅 후보</b><br/>${plan.hooks.map((h) => `- ${h}`).join('<br/>')}<br/><br/><b>대본 구성안</b><br/>${plan.outline.replace(/\n/g, '<br/>')}`

  await supabaseInsert('work_log', {
    id: logId,
    agent: 'remix',
    brand,
    kind: '주간 스케줄 자동 기획',
    status: 'done',
    status_label: '완료',
    started_at: nowIso,
    ended_at: nowIso,
    note: `제목: ${videoTitle}`,
    detail_html: contentHtml,
  })
  await supabaseInsert('approval_queue', {
    id: makeId(),
    agent: 'remix',
    brand,
    title: videoTitle,
    content_html: contentHtml,
    passed: true,
    score_label: '채점 없음',
    created_at: nowIso,
    status: 'pending',
    source_work_log_id: logId,
  })
  await supabaseInsert('calendar_entries', {
    id: makeId(),
    date,
    brand,
    channel: 'youtube',
    title: videoTitle,
    status: 'planned',
    note: `훅 후보 ${plan.hooks.length}개 (주간 스케줄 자동 기획)`,
    content_html: contentHtml,
    checklist: makeDefaultChecklist(true),
    created_at: nowIso,
    source_work_log_id: logId,
  })
  return `${brand} 유튜브: ${videoTitle}`
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  const today = kstNow()
  const date = kstDateKey(today)
  const slots = getScheduledSlots(today)

  // 브랜드별로 병렬 처리한다 — 예전엔 순서대로(for-loop) 하나씩 처리해서,
  // 앞 브랜드가 시간을 오래 쓰면 뒷 브랜드는 크론 함수 전체 제한(300초)에
  // 걸려 아예 시도도 못 해보고 잘리는 문제가 실제로 있었다(2026-07-14
  // 실제로 겪음 — 업메리는 타임아웃 에러라도 남았는데 마잘남은 아무 기록도
  // 안 남았음). Promise.all로 동시에 돌리면 전체 소요 시간이 "가장 느린
  // 브랜드 1개" 기준이 돼서 이 문제가 없어진다(브레인 크론에서도 같은
  // 패턴으로 이미 해결한 적 있음).
  const results = await Promise.all(
    slots.map(async (slot) => {
      try {
        // 하루에 슬롯당 딱 1번만 생성한다. 예전엔 calendar_entries(=성공분)만
        // 확인해서, 실패한 시도는 흔적이 없어 크론을 여러 번 돌리면(수동 Run 등)
        // 유튜브가 8개씩 쌓이는 문제가 있었다 — 이제 성공/실패 무관하게 오늘
        // 이미 "주간 스케줄 자동 기획" work_log가 있으면 건너뛴다(멱등).
        const agent = slot.channel === 'blog' ? 'writer' : 'remix'
        const attempted = await supabaseSelect<{ id: string }>(
          'work_log',
          `agent=eq.${agent}&brand=eq.${encodeURIComponent(slot.brand)}` +
            `&kind=eq.${encodeURIComponent('주간 스케줄 자동 기획')}` +
            `&started_at=gte.${date}T00:00:00%2B09:00&select=id&limit=1`,
        )
        if (attempted.length > 0) {
          return `${slot.brand} ${slot.channel}: 오늘 이미 시도함 — 건너뜀`
        }
        if (slot.channel === 'blog') {
          return await generateBlogForBrand(apiKey, slot.brand, date)
        } else if (slot.channel === 'youtube') {
          return await generateYoutubeForBrand(apiKey, slot.brand, date)
        }
        return `${slot.brand} ${slot.channel}: 처리 대상 아님`
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // 실패 시에도 work_log에 남겨서, Vercel 로그 화면 없이 Supabase SQL
        // 조회만으로 원인을 바로 확인할 수 있게 한다(실제로 이게 필요했던
        // 문제 — 실패하면 아무 흔적도 안 남아서 원인 파악이 어려웠음).
        try {
          await supabaseInsert('work_log', {
            id: makeId(),
            agent: slot.channel === 'blog' ? 'writer' : 'remix',
            brand: slot.brand,
            kind: '주간 스케줄 자동 기획',
            status: 'error',
            status_label: '오류',
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            note: '자동 생성 실패',
            detail_html: message,
          })
        } catch {
          // 에러 로그 저장 자체가 실패해도(예: Supabase 접속 문제) 크론
          // 전체를 막지는 않는다 — results 응답만으로도 최소한의 기록은 남음
        }
        return `${slot.brand} ${slot.channel}: 실패 (${message})`
      }
    }),
  )

  sendJson(res, 200, { ok: true, date, results })
}

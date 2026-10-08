// 매일 06:00 KST(대행 크론보다 먼저)에 돌아서, 대표님이 정한 주간 고정
// 업로드 루틴(weeklySchedule.ts — 현재 마잘남 블로그 매일 / 마잘남 유튜브 월·수·금)에
// 맞춰 오늘 해당하는 콘텐츠를 자동으로 기획(초안 생성)해서 캘린더에 올린다.
// 마잘남 블로그는 재설계 파이프라인(키워드 생성 → 새 라이터 → 채점, _lib/majalnamBlogPipeline).
// 사람이 라이터/리믹서 화면에서 "생성" 버튼을 누른 것과 같은 결과물이며,
// 채점(라이터는 3인 위원회, 리믹서는 채점 없음)까지 동일하게 거친다.
//
// 체크리스트 5단계(기획/컨펌/피드백/데이터 파악/레퍼런스) 중 "기획"만 여기서
// 자동으로 체크해둔다 — 나머지는 대표님이 캘린더 화면에서 직접 체크하는
// 수동 항목이다(게시물 단위 성과 추적 인프라가 없어 자동 감지가 불가능하므로
// 억지로 자동화하지 않음).
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateBlogDraft, runBlogReviewsResilient } from '../../src/agents/runBlogReview.js'
import { blogVoiceFor } from '../../src/agents/blogPrompts.js'
import { generateScoredRemixPlan } from '../../src/agents/runRemix.js'
import { PASS_THRESHOLD } from '../../src/types/domain.js'
import { BRAND_CONTEXT } from '../../src/types/brand.js'
import type { Brand } from '../../src/types/brand.js'
import type { BlogRole, BlogDraft, BlogReview } from '../../src/types/blog.js'
import type { VisionImageInput } from '../../src/lib/claude.js'
import { getScheduledSlots, kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'
import { makeDefaultChecklist } from '../../src/types/calendar.js'
import { supabaseSelect, supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, haltIfPaused, sendJson, sendText } from '../_lib/cronHandler.js'
// 브레인 리포트 조회·포맷은 공용 헬퍼로(extras 컬럼 유무 방어 + 유튜브 작업물 소재 포함).
import { fetchLatestBrainReport, formatBrainFindings, type BrainReportRow } from '../_lib/blogStore.js'
import { runMajalnamBlogPipeline, buildMajalnamBlogHtml } from '../_lib/majalnamBlogPipeline.js'

const BLOG_ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']

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

// 마잘남 블로그 "문의 전환용" 7주제 — 대표님 지정. 매일 하나씩 돌아가며 쓴다
// (7일에 한 바퀴). 브레인 리서치는 topic이 아니라 내용 디벨롭(brainFindings)으로 함께 반영.
const MAJALNAM_BLOG_TOPICS = [
  '내가 스레드를 고집하는 이유 (대표 진정성)',
  '마잘남이라는 이름이 만들어진 이야기 (브랜드 가치)',
  '계정 비포/애프터 실제 운영 사례 (포트폴리오)',
  '상담 때 매번 똑같이 답하는 질문 5개 (고객 니즈)',
  '사장님들이 가장 많이 속는 스레드 상식 (신뢰 구축)',
  '팔로워는 늘려도 매출이 안 붙는 계정의 공통점 (문제 정의)',
  '저희와 결이 안 맞는 사장님 유형 (필터링)',
]

// 업메리 블로그 "상담 신청 전환용" 6주제 — 대표님 지정. 매일 하나씩 돌아가며 쓴다.
const UPMERY_BLOG_TOPICS = [
  '제가 타로 교육을 시작한 이유 (대표 진정성)',
  '업메리가 만들어진 이야기 — 왜 지식이 아니라 수익까지 책임지나 (브랜드 가치)',
  '수강생이 플랫폼 입점하고 첫 수익 낸 과정 (포트폴리오)',
  '상담 때 매번 똑같이 받는 질문 5개 (고객 니즈)',
  '타로 배우려는 분들이 가장 많이 속는 말 (신뢰 구축)',
  '타로는 잘 보는데 돈은 못 버는 사람들의 공통점 (문제 정의)',
]

// 마잘남 유튜브(월·수·금) 유형 로테이션 — 재설계 지시서 8번 비율(작업 과정 공개 60 /
// 비포·애프터 20 / 반박형 20)을 정확히 맞추려고 5편 주기로 돈다(5편 중 작업 3·비포애프터 1·반박 1).
// 주제는 content-brain이 매주 모은 소재(작업 각도·반박 소재)에서 그 유형에 맞는 걸 꺼내 쓴다.
const MAJALNAM_YT_CYCLE = ['작업 과정 공개', '작업 과정 공개', '비포·애프터', '작업 과정 공개', '반박형'] as const

function pickMajalnamYoutubeTopic(report: BrainReportRow | undefined): string {
  const now = kstNow()
  // 월=0·수=1·금=2(수동 실행 등 그 외 요일은 0). 1970-01-01은 목요일 → +3으로 월요일 기준 주차.
  const weekIdx = Math.floor((Math.floor(now.getTime() / 86_400_000) + 3) / 7)
  const slotInWeek = ({ 1: 0, 3: 1, 5: 2 } as Record<number, number>)[now.getUTCDay()] ?? 0
  const slot = weekIdx * 3 + slotInWeek
  const type = MAJALNAM_YT_CYCLE[slot % MAJALNAM_YT_CYCLE.length]
  const ex = report?.extras ?? {}
  if (type === '작업 과정 공개' && ex.workAngles?.length) {
    const w = ex.workAngles[slot % ex.workAngles.length]
    return `[이번 영상 유형: ${type}] ${w.problem} — 영상에서 보여줄 수정 포인트: ${w.showInVideo}`
  }
  if (type === '반박형' && ex.rebuttals?.length) {
    const r = ex.rebuttals[slot % ex.rebuttals.length]
    return `[이번 영상 유형: ${type}] "${r.myth}" — 반박 방향: ${r.counterDirection}`
  }
  if (type === '비포·애프터') {
    return `[이번 영상 유형: ${type}] 대행 전후 계정·글 비교 — 팔로워가 아니라 문의 수·매출 변화로 보여주기`
  }
  // 브레인 소재가 아직 없을 때 — 유형만 정해주고 주제는 기획자가 고르게 한다.
  return `[이번 영상 유형: ${type}] 사장님들이 스레드에서 요즘 가장 많이 막히는 문제 하나`
}

// 최근 14일간 같은 브랜드·채널에 이미 쓴 제목과 안 겹치는 추천 주제를 브레인
// 리포트에서 하나 골라온다 — 브레인 리포트가 없으면 브랜드 톤 기반 기본 주제로.
async function pickTopic(
  brand: Brand,
  channel: 'blog' | 'youtube',
): Promise<{ topic: string; brainFindings?: string }> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const [latestReport, recentEntries] = await Promise.all([
    fetchLatestBrainReport(brand),
    supabaseSelect<CalendarTitleRow>(
      'calendar_entries',
      `brand=eq.${encodeURIComponent(brand)}&channel=eq.${channel}&created_at=gte.${encodeURIComponent(since)}&select=title`,
    ),
  ])
  const reports = latestReport ? [latestReport] : []
  const brainFindings = formatBrainFindings(latestReport)
  // 블로그는 대표님이 지정한 "전환용 주제군"을 매일 하나씩 돌려 쓴다(브레인
  // 리서치는 주제가 아니라 내용 디벨롭용으로 함께 넘긴다 — 보이스가 조합해 씀).
  const dayIdx = Math.floor(Date.now() / 86_400_000)
  if (channel === 'blog' && brand === '마잘남') {
    return { topic: MAJALNAM_BLOG_TOPICS[dayIdx % MAJALNAM_BLOG_TOPICS.length], brainFindings }
  }
  if (channel === 'blog' && brand === '업메리') {
    return { topic: UPMERY_BLOG_TOPICS[dayIdx % UPMERY_BLOG_TOPICS.length], brainFindings }
  }
  if (channel === 'youtube' && brand === '마잘남') {
    return { topic: pickMajalnamYoutubeTopic(latestReport), brainFindings }
  }
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

// 마잘남 블로그(재설계 지시서, 2026-10): 키워드 생성(2번) → 새 라이터(1번) → 채점.
// 기존 브레인 marketFindings 주입은 제거됐고(지시서 5번), 매주 blog-brain이 만든
// researchBlock이 대신 들어간다. 주제는 기존 "전환용 7주제" 로테이션 그대로.
async function generateMajalnamBlog(apiKey: string, date: string): Promise<string> {
  const brand: Brand = '마잘남'
  const { topic } = await pickTopic(brand, 'blog')
  const photoImages = await fetchTodayPhotos(date, brand)
  const result = await runMajalnamBlogPipeline({
    apiKey,
    topic,
    date,
    // 새 라이터는 사진을 "한 줄 설명"으로 받는다 — 대표님이 올린 사진은 설명이 없으니
    // 장수만 알려주고 배치 위치만 표시하게 한다.
    photos:
      photoImages.length > 0
        ? `대표님이 오늘 올린 사진 ${photoImages.length}장(설명 없음) — 사진 추천 지점 중 어울리는 곳에 "[📸 첨부 사진: 대표님 사진 N번]"으로 배치`
        : undefined,
  })
  const { draft, reviews, keyword } = result
  const reviewed = reviews.length > 0
  const avg = reviewed ? reviews.reduce((s, r) => s + r.totalScore, 0) / reviews.length : 0
  const passed = reviewed && avg >= PASS_THRESHOLD
  const scoreNote = reviewed ? `${avg.toFixed(1)}점 ${passed ? '통과' : '미달'}` : '채점 실패 — 내용은 저장됨'
  const html = buildMajalnamBlogHtml(result)
  const kwNote = `키워드 "${keyword.mainKeyword}" ${keyword.readerStage}`
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
    note: `${scoreNote} · ${kwNote} · 사진 ${photoImages.length}장`,
    detail_html: html,
  })
  await supabaseInsert('approval_queue', {
    id: makeId(),
    agent: 'writer',
    brand,
    title: draft.title,
    content_html: html,
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
    note: `${scoreNote} (주간 스케줄 자동 기획) · ${kwNote} · 발행 전 [경험 삽입] 채우기`,
    content_html: html,
    checklist: makeDefaultChecklist(true),
    created_at: nowIso,
    source_work_log_id: logId,
  })
  return `${brand} 블로그: ${scoreNote} · ${kwNote}`
}

async function generateBlogForBrand(apiKey: string, brand: Brand, date: string): Promise<string> {
  if (brand === '마잘남') return generateMajalnamBlog(apiKey, date)
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
    blogVoice: blogVoiceFor(brand),
  })

  // 3명 심사위원을 병렬로 돌리되, 1명이 실패해도 나머지 채점으로 계속
  // 진행한다 — 예전엔 Promise.all이라 1명만 실패해도 이미 만들어진 초안까지
  // 통째로 버려지고 "오류"만 남았다(라이터 반복 오류의 원인 중 하나).
  // 전원 실패하면 채점 없이 저장하고 "채점 실패"로 표시한다.
  // 채점만 하고, 미달이어도 "재작성"은 하지 않는다(대표님 결정: 비용 절감).
  // 예전엔 미달 시 한 번 더 통째로 다시 써서(생성 1회 + 채점 1회 추가) 매일
  // 블로그 비용이 최대 2배로 나왔다. 미달 글도 그대로 결재함에 올라가므로,
  // 대표님이 결재함에서 보고 팀채팅 "재수정"으로 직접 고치면 된다(그때만 비용 발생).
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
  // 채점 + 미달 시 1회 재작성(대표님 결정) — 재작성해도 미달이면 그대로 결재함에.
  const { plan, review } = await generateScoredRemixPlan({
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
  const passed = review.totalScore >= PASS_THRESHOLD
  const scoreNote = `${review.totalScore}점 ${passed ? '통과' : '미달'}`
  const titleLine = plan.title ? `<b>🎬 제목</b><br/>${plan.title}<br/><br/>` : ''
  const contentHtml = `${titleLine}<b>훅 후보</b><br/>${plan.hooks.map((h) => `- ${h}`).join('<br/>')}<br/><br/><b>대본 구성안</b><br/>${plan.outline.replace(/\n/g, '<br/>')}<br/><br/><b>채점</b> ${scoreNote} — ${review.summary}`

  await supabaseInsert('work_log', {
    id: logId,
    agent: 'remix',
    brand,
    kind: '주간 스케줄 자동 기획',
    status: passed ? 'done' : 'attention',
    status_label: passed ? '완료' : '보류',
    started_at: nowIso,
    ended_at: nowIso,
    note: `${scoreNote} · ${videoTitle}`,
    detail_html: contentHtml,
  })
  await supabaseInsert('approval_queue', {
    id: makeId(),
    agent: 'remix',
    brand,
    title: videoTitle,
    content_html: contentHtml,
    passed,
    score_label: `${review.totalScore}/100`,
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
    status: passed ? 'planned' : 'open',
    note: `${scoreNote} (주간 스케줄 자동 기획)`,
    content_html: contentHtml,
    checklist: makeDefaultChecklist(true),
    created_at: nowIso,
    source_work_log_id: logId,
  })
  return `${brand} 유튜브: ${scoreNote}`
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  if (haltIfPaused(res)) return
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

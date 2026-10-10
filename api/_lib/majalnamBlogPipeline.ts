// 마잘남 블로그 한 편을 만드는 전체 흐름(지시서 4·5번) — 06:00 크론과 팀채팅이 공유.
//   키워드 생성(2번) → 블로그 라이터(1번, blog-brain researchBlock 주입) → 발행 전 채점
// 업메리 블로그는 이 경로를 타지 않는다(기존 라이터 그대로).
import { runBlogReviewsResilient } from '../../src/agents/runBlogReview.js'
import { fixBlogTitle, generateBlogKeywords, generateMajalnamBlogDraft, type DraftAttempt } from '../../src/agents/runMajalnamBlog.js'
import {
  buildMajalnamWriterSystem,
  buildMajalnamWriterUser,
  buildMajalnamReviewSystem,
  CTA_LINK_PLACEHOLDER,
  MAJALNAM_CORE_KEYWORDS,
  MAJALNAM_REVIEW_RUBRICS,
} from '../../src/agents/majalnamBlogPrompts.js'
import { fetchKeywordVolumes } from './naverBlogData.js'
import { getLatestBlogBrain, getRecentMainKeywords, getWeekStageCounts, saveBlogKeyword } from './blogStore.js'
import { autoFixDraft, buildBlogCheckHtml, checkBlogRules, titleLengthOk } from '../../src/agents/blogRuleCheck.js'
import { NAVER_POST_ATTR, NAVER_TITLE_ATTR, renderNaverBody } from '../../src/agents/naverFormat.js'
import type { BlogDraft, BlogReview, BlogRole } from '../../src/types/blog.js'
import type { BlogKeywordResult } from '../../src/types/blogBrain.js'
import { PASS_THRESHOLD } from '../../src/types/domain.js'

const BLOG_ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']
// 고쳐 쓰기 뒤 재채점 몫(Haiku 채점 1회 + 여유).
const REVIEW_RESERVE_MS = 35_000
const BRAND = '마잘남' as const

export interface MajalnamBlogResult {
  draft: BlogDraft
  reviews: BlogReview[]
  keyword: BlogKeywordResult
  keywordFallback: boolean
  researchWeek?: string
  // 발행 전 자동 수정 내역(제목 단정 표현 삭제·제목 길이 교정·연락처 가림) — 결재함 상자에 표시.
  autoFixes: string[]
  // 글쓰기가 몇 번째 시도(생각 깊이)에서 성공했는지 — high가 아니면 품질 저하 가능.
  writerEffort?: string
}

export async function runMajalnamBlogPipeline(params: {
  apiKey: string
  topic: string
  date: string
  keyContent?: string
  photos?: string
  // 팀채팅 재수정 — 직전 글 + 대표님 요청.
  previousDraft?: { title: string; body: string }
  feedback?: string
}): Promise<MajalnamBlogResult> {
  const { apiKey, topic, date, keyContent, photos, previousDraft, feedback } = params
  const isRevision = !!(previousDraft && feedback)
  // 함수 한도 300초 — 글쓰기는 시작 후 240초까지만 쓰고, 나머지는 채점·저장 몫으로 남긴다.
  // 전체(고쳐 쓰기·재채점 포함)는 시작 후 280초 안에 끝낸다(저장 몫 20초).
  const startedAt = Date.now()
  const writerDeadline = startedAt + 240_000
  const pipelineDeadline = startedAt + 280_000

  const [recentKeywords, stageCounts, keywordVolumes, brain] = await Promise.all([
    // 재수정은 "같은 글"을 고치는 거라 최근 키워드 제외 규칙을 적용하지 않는다
    // (자기 자신의 키워드가 제외돼 엉뚱한 키워드로 바뀌는 것 방지).
    isRevision ? Promise.resolve([]) : getRecentMainKeywords(BRAND),
    getWeekStageCounts(BRAND),
    fetchKeywordVolumes(MAJALNAM_CORE_KEYWORDS),
    getLatestBlogBrain(BRAND),
  ])

  // 2번 키워드 생성 — 재수정이면 직전 글 제목을 주제로 삼아 그 글의 키워드를 다시 잡는다.
  const { keyword, fallback } = await generateBlogKeywords({
    apiKey,
    topic: previousDraft && feedback ? previousDraft.title : topic,
    keywordVolumes,
    recentKeywords,
    stageCounts,
  })
  // 새 글일 때만 이력에 남긴다(재수정까지 세면 주간 단계 비율이 왜곡됨).
  if (!isRevision) await saveBlogKeyword({ date, brand: BRAND, keyword })

  // 1번 글쓰기 — researchBlock은 blog-brain 최신 리포트(수집 실패 주엔 지난주 것이 그대로 최신).
  const researchBlock = brain?.research_block ?? ''
  const writerSystem = buildMajalnamWriterSystem({ researchBlock, ctaLink: process.env.BLOG_CTA_LINK })
  const reviewSystem = buildMajalnamReviewSystem(researchBlock)
  const writerUser = (prev?: { title: string; body: string }, fb?: string) =>
    buildMajalnamWriterUser({
      topic,
      mainKeyword: keyword.mainKeyword,
      subKeywords: keyword.subKeywords,
      readerStage: keyword.readerStage,
      keyContent,
      photos,
      previousDraft: prev,
      feedback: fb,
    })
  const rawDraft = await generateMajalnamBlogDraft({
    apiKey,
    system: writerSystem,
    user: writerUser(previousDraft, feedback),
    deadline: writerDeadline,
  })

  // 발행 전 자동 수정 — 대표님이 매번 확인·수정하지 않게. ① 코드로(제목 단정 수식어 삭제,
  // 연락처 가림) ② 제목 길이(25~35자)가 어긋나면 싼 모델로 제목만 다시 쓴다(검증 후 반영).
  async function polish(d: BlogDraft, titleDeadline: number): Promise<{ draft: BlogDraft; fixes: string[] }> {
    const { draft: fixedDraft, fixes } = autoFixDraft(d)
    let out = fixedDraft
    if (!titleLengthOk(out.title)) {
      const before = out.title
      const fixedTitle = await fixBlogTitle({
        apiKey,
        title: before,
        mainKeyword: keyword.mainKeyword,
        subKeywords: keyword.subKeywords,
        // 길이 + 금지 표현(제목 쪽)까지 코드로 다시 확인한 것만 반영.
        isValid: (t) => titleLengthOk(t) && checkBlogRules({ title: t, body: '' }).issues.length === 0,
        deadline: titleDeadline,
      })
      if (fixedTitle) {
        out = { ...out, title: fixedTitle }
        fixes.push(`제목 길이 교정(${before.trim().length}자 → ${fixedTitle.length}자): "${before}" → "${fixedTitle}"`)
      }
    }
    return { draft: out, fixes }
  }

  const { effort: writerEffort, ...writtenDraft } = rawDraft
  const first = await polish(writtenDraft, writerDeadline + 15_000)
  let draft = first.draft
  const autoFixes = first.fixes

  // 발행 전 채점(대표님 결정 B: 유지) — 1번의 15항목과 같은 채점표.
  let reviews = await runBlogReviewsResilient({
    apiKey,
    roles: BLOG_ROLES,
    draft,
    system: reviewSystem,
    deadline: Math.min(writerDeadline + 45_000, pipelineDeadline),
  })

  // 미달(85점 미만)이면 채점 지적을 넘겨 딱 1번 고쳐 쓰고 다시 채점한다(2026-10 대표님 결정 —
  // "알아서 고쳐서 올라오게"). 점수가 오른 쪽을 쓴다. 함수 한도(300초) 안에서 고쳐 쓰기+재채점
  // 시간이 남을 때만 — 남은 시간에 맞춰 생각 깊이를 고른다(모자라면 건너뛰고 원본 그대로).
  const avgOf = (rs: BlogReview[]) => (rs.length > 0 ? rs.reduce((t, r) => t + r.totalScore, 0) / rs.length : 0)
  const firstAvg = avgOf(reviews)
  if (reviews.length > 0 && firstAvg < PASS_THRESHOLD) {
    const rewriteDeadline = pipelineDeadline - REVIEW_RESERVE_MS
    const left = rewriteDeadline - Date.now()
    const attempt: DraftAttempt | undefined =
      left >= 150_000
        ? { effort: 'high', maxTokens: 16_000, strict: true }
        : left >= 90_000
          ? { effort: 'medium', maxTokens: 12_000, strict: true }
          : undefined
    if (!attempt) {
      autoFixes.push(`미달(${firstAvg.toFixed(1)}점)이지만 시간이 부족해 자동 고쳐 쓰기를 건너뜀 — 원본 그대로`)
    } else {
      try {
        const rewritten = await generateMajalnamBlogDraft({
          apiKey,
          system: writerSystem,
          user: writerUser(draft, buildRewriteFeedback(reviews, draft)),
          deadline: rewriteDeadline,
          attempts: [attempt],
        })
        const { effort: _e, ...rewrittenDraft } = rewritten
        void _e
        const second = await polish(rewrittenDraft, rewriteDeadline + 10_000)
        const secondReviews = await runBlogReviewsResilient({
          apiKey,
          roles: BLOG_ROLES,
          draft: second.draft,
          system: reviewSystem,
          deadline: pipelineDeadline,
        })
        const secondAvg = avgOf(secondReviews)
        if (secondReviews.length > 0 && secondAvg >= firstAvg) {
          draft = second.draft
          reviews = secondReviews
          autoFixes.length = 0
          autoFixes.push(...second.fixes)
          autoFixes.push(`미달(${firstAvg.toFixed(1)}점) → 채점 지적대로 자동 고쳐 쓰기 1회 → ${secondAvg.toFixed(1)}점`)
        } else {
          autoFixes.push(
            secondReviews.length > 0
              ? `자동 고쳐 쓰기 1회 했지만 점수가 오르지 않아(${secondAvg.toFixed(1)}점) 원본(${firstAvg.toFixed(1)}점) 유지`
              : '자동 고쳐 쓰기본 채점이 실패해 원본 유지',
          )
        }
      } catch (err) {
        console.warn('[majalnam-blog] 자동 고쳐 쓰기 실패:', err instanceof Error ? err.message : String(err))
        autoFixes.push('자동 고쳐 쓰기 시도가 실패해 원본 유지')
      }
    }
  }

  return { draft, reviews, keyword, keywordFallback: fallback, researchWeek: brain?.week, autoFixes, writerEffort }
}

// 채점 지적 → 고쳐 쓰기 지시. 16점 미만 항목의 근거 + 확인 필요 플래그 + 코드 점검 결과를 모은다.
function buildRewriteFeedback(reviews: BlogReview[], draft: BlogDraft): string {
  const labelOf = new Map(
    (Object.keys(MAJALNAM_REVIEW_RUBRICS) as BlogRole[]).flatMap((role) =>
      MAJALNAM_REVIEW_RUBRICS[role].map((c) => [c.id, c.label] as const),
    ),
  )
  const lines: string[] = []
  for (const r of reviews) {
    for (const c of r.criteriaScores) {
      if (c.score < 16 && c.comment) lines.push(`- [${labelOf.get(c.criterionId) ?? c.criterionId} ${c.score}/20] ${c.comment}`)
    }
    for (const f of r.flags) {
      if (f.severity !== 'info' && f.reason) lines.push(`- "${f.quote}" → ${f.reason}`)
    }
  }
  for (const i of checkBlogRules(draft).issues) lines.push(`- (자동 점검) ${i.where}: "${i.quote}" — ${i.reason}`)
  if (lines.length === 0) for (const r of reviews) if (r.summary) lines.push(`- ${r.summary}`)
  return `발행 전 채점에서 통과선(85점)에 못 미쳤다. 아래 지적된 부분만 고치고, 잘 된 부분(주제·흐름·키워드)은 유지해 다시 써라.
특히 [검증된 사실]에 없는 경험·기간·수치·사례 서술은 지우거나 "[경험 삽입: …]" 자리표시자로 바꾼다(전체 1~3개).
소제목 수·본문 글자 수·문단 길이는 [작성 규칙]의 수치를 정확히 지킨다.
${lines.slice(0, 20).join('\n')}`
}

// 결재함·캘린더용 HTML — 키워드 정보를 맨 위에, 대표님이 발행 전 채울 자리표시자
// ([경험 삽입 …], 진단 폼 링크)는 노란 형광펜으로 표시해 놓치지 않게 한다.
export function buildMajalnamBlogHtml(result: MajalnamBlogResult): string {
  const { draft, reviews, keyword, keywordFallback, researchWeek, autoFixes, writerEffort } = result
  // 진단 폼 링크 자리표시자는 노란 형광펜(대표님이 발행 전 채울 자리). [경험 삽입]은 renderNaverBody가 처리.
  const markCta = (html: string) =>
    html.split(CTA_LINK_PLACEHOLDER).join(`<span style="background:#fff3a3">${CTA_LINK_PLACEHOLDER}</span>`)
  const kwLine =
    `<b>🔑 메인 키워드</b> ${keyword.mainKeyword}` +
    (keyword.subKeywords.length ? ` · 서브 ${keyword.subKeywords.join(', ')}` : '') +
    ` · 독자 단계 ${keyword.readerStage}` +
    ` · 검색량 ${keyword.searchVolume === null ? '미확인' : keyword.searchVolume.toLocaleString('ko-KR')}` +
    (keywordFallback ? ' (⚠️키워드 단계 실패 — 기본값)' : '') +
    `<br/><small>선정 이유: ${keyword.reason || '-'} · 리서치: ${researchWeek ? `${researchWeek} blog-brain 반영` : '아직 없음'}` +
    ` · 작성 깊이: ${writerEffort === 'high' ? '깊게(정상)' : writerEffort === 'medium' ? '보통(1차 실패 후 재시도)' : writerEffort === 'low' ? '가볍게(2회 실패 후 재시도 — 품질 확인 필요)' : '-'}</small>`
  const photoHtml = draft.photoPlacements.length
    ? `<br/><br/><b>사진 배치 제안</b><br/>${draft.photoPlacements.map((p) => `- ${p}`).join('<br/>')}`
    : ''
  const reviewHtml = reviews.map((r) => `${r.role}: ${r.totalScore}점 — ${r.summary}`).join('<br/>')
  // 맨 위: 채점 실패 안내 + 규칙 자동 점검(효과 단정·연락처·제목 길이) — 코드로, 비용 0.
  const checkHtml = buildBlogCheckHtml({ reviewed: reviews.length > 0, draft, autoFixes })
  // 제목·본문은 "네이버용 복사" 버튼이 찾을 수 있게 표시(data-*)로 감싼다 — 본문은 적당한 꾸밈이
  // 들어간 붙여넣기용 HTML(naverFormat). 키워드 줄·점검 상자·채점은 복사 대상이 아니다.
  const titleEsc = draft.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const postHtml =
    `<div ${NAVER_TITLE_ATTR} style="font-size:17px;font-weight:700;margin:6px 0 10px">${titleEsc}</div>` +
    `<div ${NAVER_POST_ATTR} style="border:1px solid #e5e5e5;border-radius:10px;padding:18px 12px;background:#fff">${renderNaverBody(draft.body, markCta)}</div>`
  return `${checkHtml}${kwLine}<br/><br/>${postHtml}${photoHtml}<br/><br/>${reviewHtml}`
}

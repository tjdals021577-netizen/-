// 마잘남 블로그 한 편을 만드는 전체 흐름(지시서 4·5번) — 06:00 크론과 팀채팅이 공유.
//   키워드 생성(2번) → 블로그 라이터(1번, blog-brain researchBlock 주입) → 발행 전 채점
// 업메리 블로그는 이 경로를 타지 않는다(기존 라이터 그대로).
import { runBlogReviewsResilient } from '../../src/agents/runBlogReview.js'
import { fixBlogTitle, generateBlogKeywords, generateMajalnamBlogDraft } from '../../src/agents/runMajalnamBlog.js'
import {
  buildMajalnamWriterSystem,
  buildMajalnamWriterUser,
  buildMajalnamReviewSystem,
  CTA_LINK_PLACEHOLDER,
  MAJALNAM_CORE_KEYWORDS,
} from '../../src/agents/majalnamBlogPrompts.js'
import { fetchKeywordVolumes } from './naverBlogData.js'
import { getLatestBlogBrain, getRecentMainKeywords, getWeekStageCounts, saveBlogKeyword } from './blogStore.js'
import { autoFixDraft, buildBlogCheckHtml, checkBlogRules, titleLengthOk } from '../../src/agents/blogRuleCheck.js'
import type { BlogDraft, BlogReview, BlogRole } from '../../src/types/blog.js'
import type { BlogKeywordResult } from '../../src/types/blogBrain.js'

const BLOG_ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']
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
  const writerDeadline = Date.now() + 240_000

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
  const rawDraft = await generateMajalnamBlogDraft({
    apiKey,
    system: buildMajalnamWriterSystem({ researchBlock, ctaLink: process.env.BLOG_CTA_LINK }),
    user: buildMajalnamWriterUser({
      topic,
      mainKeyword: keyword.mainKeyword,
      subKeywords: keyword.subKeywords,
      readerStage: keyword.readerStage,
      keyContent,
      photos,
      previousDraft,
      feedback,
    }),
    deadline: writerDeadline,
  })

  // 발행 전 자동 수정 — 대표님이 매번 확인·수정하지 않게. ① 코드로(제목 단정 수식어 삭제,
  // 연락처 가림) ② 제목 길이(25~35자)가 어긋나면 싼 모델로 제목만 다시 쓴다(검증 후 반영).
  const { effort: writerEffort, ...writtenDraft } = rawDraft
  const { draft: fixedDraft, fixes: autoFixes } = autoFixDraft(writtenDraft)
  let draft = fixedDraft
  if (!titleLengthOk(draft.title)) {
    const before = draft.title
    const fixedTitle = await fixBlogTitle({
      apiKey,
      title: before,
      mainKeyword: keyword.mainKeyword,
      subKeywords: keyword.subKeywords,
      // 길이 + 금지 표현(제목 쪽)까지 코드로 다시 확인한 것만 반영.
      isValid: (t) => titleLengthOk(t) && checkBlogRules({ title: t, body: '' }).issues.length === 0,
      // 채점(최소 25초)·저장 몫을 남기고 그 안에서만.
      deadline: writerDeadline + 15_000,
    })
    if (fixedTitle) {
      draft = { ...draft, title: fixedTitle }
      autoFixes.push(`제목 길이 교정(${before.trim().length}자 → ${fixedTitle.length}자): "${before}" → "${fixedTitle}"`)
    }
  }

  // 발행 전 채점(대표님 결정 B: 유지) — 1번의 15항목과 같은 채점표.
  const reviews = await runBlogReviewsResilient({
    apiKey,
    roles: BLOG_ROLES,
    draft,
    system: buildMajalnamReviewSystem(researchBlock),
    // 함수 한도 300초 안에서 저장까지 끝나도록(시작 후 285초까지).
    deadline: writerDeadline + 45_000,
  })

  return { draft, reviews, keyword, keywordFallback: fallback, researchWeek: brain?.week, autoFixes, writerEffort }
}

// 결재함·캘린더용 HTML — 키워드 정보를 맨 위에, 대표님이 발행 전 채울 자리표시자
// ([경험 삽입 …], 진단 폼 링크)는 노란 형광펜으로 표시해 놓치지 않게 한다.
export function buildMajalnamBlogHtml(result: MajalnamBlogResult): string {
  const { draft, reviews, keyword, keywordFallback, researchWeek, autoFixes, writerEffort } = result
  const highlight = (text: string) =>
    text
      .replace(/\[경험 삽입:[^\]]*\]/g, (m) => `<mark>${m}</mark>`)
      .split(CTA_LINK_PLACEHOLDER)
      .join(`<mark>${CTA_LINK_PLACEHOLDER}</mark>`)
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
  return `${checkHtml}${kwLine}<br/><br/><b>${draft.title}</b><br/>${highlight(draft.body).replace(/\n/g, '<br/>')}${photoHtml}<br/><br/>${reviewHtml}`
}

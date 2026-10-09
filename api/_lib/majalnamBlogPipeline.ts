// 마잘남 블로그 한 편을 만드는 전체 흐름(지시서 4·5번) — 06:00 크론과 팀채팅이 공유.
//   키워드 생성(2번) → 블로그 라이터(1번, blog-brain researchBlock 주입) → 발행 전 채점
// 업메리 블로그는 이 경로를 타지 않는다(기존 라이터 그대로).
import { runBlogReviewsResilient } from '../../src/agents/runBlogReview.js'
import { generateBlogKeywords, generateMajalnamBlogDraft } from '../../src/agents/runMajalnamBlog.js'
import {
  buildMajalnamWriterSystem,
  buildMajalnamWriterUser,
  buildMajalnamReviewSystem,
  CTA_LINK_PLACEHOLDER,
  MAJALNAM_CORE_KEYWORDS,
} from '../../src/agents/majalnamBlogPrompts.js'
import { fetchKeywordVolumes } from './naverBlogData.js'
import { getLatestBlogBrain, getRecentMainKeywords, getWeekStageCounts, saveBlogKeyword } from './blogStore.js'
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
  const draft = await generateMajalnamBlogDraft({
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

  // 발행 전 채점(대표님 결정 B: 유지) — 1번의 15항목과 같은 채점표.
  const reviews = await runBlogReviewsResilient({
    apiKey,
    roles: BLOG_ROLES,
    draft,
    system: buildMajalnamReviewSystem(researchBlock),
  })

  return { draft, reviews, keyword, keywordFallback: fallback, researchWeek: brain?.week }
}

// 결재함·캘린더용 HTML — 키워드 정보를 맨 위에, 대표님이 발행 전 채울 자리표시자
// ([경험 삽입 …], 진단 폼 링크)는 노란 형광펜으로 표시해 놓치지 않게 한다.
export function buildMajalnamBlogHtml(result: MajalnamBlogResult): string {
  const { draft, reviews, keyword, keywordFallback, researchWeek } = result
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
    `<br/><small>선정 이유: ${keyword.reason || '-'} · 리서치: ${researchWeek ? `${researchWeek} blog-brain 반영` : '아직 없음'}</small>`
  const photoHtml = draft.photoPlacements.length
    ? `<br/><br/><b>사진 배치 제안</b><br/>${draft.photoPlacements.map((p) => `- ${p}`).join('<br/>')}`
    : ''
  const reviewHtml = reviews.map((r) => `${r.role}: ${r.totalScore}점 — ${r.summary}`).join('<br/>')
  return `${kwLine}<br/><br/><b>${draft.title}</b><br/>${highlight(draft.body).replace(/\n/g, '<br/>')}${photoHtml}<br/><br/>${reviewHtml}`
}

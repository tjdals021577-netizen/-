import {
  callClaudeJson,
  callClaudeVisionJson,
  type VisionImageInput,
} from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import {
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
} from './blogPrompts.js'
import { BLOG_RUBRICS } from './blogRubric.js'
import type { BlogDraft, BlogReview, BlogRole } from '../types/blog.js'
import type {
  CriterionScore,
  FlagSeverity,
  RevisionFlag,
} from '../types/domain.js'

const FLAG_SEVERITIES: FlagSeverity[] = ['info', 'check', 'risk']

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseDraft(raw: unknown): BlogDraft {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('블로그 초안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return {
    title: typeof rec.title === 'string' ? rec.title : '',
    body: typeof rec.body === 'string' ? rec.body : '',
    photoPlacements: Array.isArray(rec.photoPlacements)
      ? rec.photoPlacements.filter((p): p is string => typeof p === 'string')
      : [],
  }
}

function parseCriteriaScores(role: BlogRole, raw: unknown): CriterionScore[] {
  const validIds = new Set(BLOG_RUBRICS[role].map((c) => c.id))
  if (!Array.isArray(raw)) return []
  const out: CriterionScore[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const criterionId = String(rec.criterionId ?? '')
    if (!validIds.has(criterionId)) continue
    const score = Math.max(0, Math.min(20, toNumber(rec.score)))
    const comment = typeof rec.comment === 'string' ? rec.comment : ''
    out.push({ criterionId, score, comment })
  }
  return out
}

function parseFlags(raw: unknown): RevisionFlag[] {
  if (!Array.isArray(raw)) return []
  const out: RevisionFlag[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const severity = FLAG_SEVERITIES.includes(rec.severity as FlagSeverity)
      ? (rec.severity as FlagSeverity)
      : 'info'
    out.push({
      quote: typeof rec.quote === 'string' ? rec.quote : '',
      reason: typeof rec.reason === 'string' ? rec.reason : '',
      severity,
    })
  }
  return out
}

function parseBlogReview(role: BlogRole, raw: unknown): BlogReview {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('블로그 채점 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const criteriaScores = parseCriteriaScores(role, rec.criteriaScores)
  const scoredSum = criteriaScores.reduce((s, c) => s + c.score, 0)
  const declaredTotal = toNumber(rec.totalScore, scoredSum)
  const totalScore =
    criteriaScores.length === BLOG_RUBRICS[role].length &&
    Math.abs(declaredTotal - scoredSum) > 5
      ? scoredSum
      : Math.max(0, Math.min(100, declaredTotal))

  return {
    role,
    totalScore,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    criteriaScores,
    flags: parseFlags(rec.flags),
  }
}

export async function generateBlogDraft(params: {
  apiKey: string
  topic: string
  keyPoints: string
  photoDescriptions: string
  brandContext?: string
  previousDraft?: BlogDraft
  feedback?: string
  marketFindings?: string
  pastFeedback?: string
  photoImages?: VisionImageInput[]
}): Promise<BlogDraft> {
  const {
    apiKey,
    topic,
    keyPoints,
    photoDescriptions,
    brandContext,
    previousDraft,
    feedback,
    marketFindings,
    pastFeedback,
    photoImages,
  } = params
  const user = buildDraftUserPrompt({
    topic,
    keyPoints,
    photoDescriptions,
    previousDraft,
    feedback,
  })
  // 실제 사진이 첨부되면 AI가 사진을 직접 보고 배치를 제안하도록 비전 호출로
  // 전환한다(이 경우 웹서치 도구는 같이 못 쓴다 — 사진 근거가 더 중요하다고
  // 판단해 비전을 우선). 사진이 없으면 실제 상위노출 글 구조를 검색해서 참고한다.
  if (photoImages && photoImages.length > 0) {
    const raw = await callClaudeVisionJson({
      apiKey,
      system: buildDraftSystemPrompt(brandContext, marketFindings, true, pastFeedback),
      user,
      images: photoImages,
      maxTokens: 4096,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseDraft(raw)
  }
  // 라이터는 이제 직접 웹 검색을 하지 않는다(대표님 결정: 검색은 브레인
  // 한 명만, 나머지는 그 결과를 공유). 브레인이 조사해둔 최신 리서치는
  // marketFindings로 이미 프롬프트에 들어간다 — 매번 같은 걸 새로 크롤링해서
  // 토큰을 반복 과금하던 게 비용의 최대 요인이었어서, 이걸 없애는 게 검색
  // 비용 절감의 핵심이다. 검색이 빠지니 타임아웃/토큰도 여유 있게 줄인다.
  const raw = await callClaudeJson({
    apiKey,
    system: buildDraftSystemPrompt(brandContext, marketFindings, false, pastFeedback),
    user,
    maxTokens: 4096,
    timeoutMs: 120_000,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseDraft(raw)
}

export async function runBlogAgentReview(params: {
  apiKey: string
  role: BlogRole
  draft: BlogDraft
}): Promise<BlogReview> {
  const { apiKey, role, draft } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildReviewSystemPrompt(role),
    user: buildReviewUserPrompt(draft),
    // 채점은 검색 없는 단순 호출이라 보통 1분 안에 끝난다 — 기본값(260초)을
    // 그대로 두면 채점 하나가 걸렸을 때 260초를 통째로 기다리다가 크론
    // 함수 제한(300초)까지 같이 넘겨버리는 문제가 실제로 있었다("260초 안에
    // 응답이 없어 중단" 에러가 주간 자동 기획에서 확인됨). 120초면 충분.
    timeoutMs: 120_000,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseBlogReview(role, raw)
}

// 3인 위원회를 Promise.all로 돌리면 1명만 실패해도 전부 reject돼서, 이미
// 비싸게 만들어둔 초안까지 통째로 버려지고 "오류"만 남는 문제가 실제로
// 있었다(라이터가 반복 오류났던 원인 중 하나). 실패한 심사위원은 빼고
// 성공한 채점만 모아서 돌려준다 — 전원 실패하면 빈 배열(호출부에서 "채점
// 실패, 내용은 저장됨"으로 처리).
export async function runBlogReviewsResilient(params: {
  apiKey: string
  roles: BlogRole[]
  draft: BlogDraft
}): Promise<BlogReview[]> {
  const { apiKey, roles, draft } = params
  const settled = await Promise.allSettled(
    roles.map((role) => runBlogAgentReview({ apiKey, role, draft })),
  )
  return settled
    .filter((r): r is PromiseFulfilledResult<BlogReview> => r.status === 'fulfilled')
    .map((r) => r.value)
}

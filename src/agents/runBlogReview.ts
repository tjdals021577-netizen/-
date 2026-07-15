import {
  callClaudeJson,
  callClaudeJsonWithWebSearch,
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
      system: buildDraftSystemPrompt(brandContext, marketFindings, true),
      user,
      images: photoImages,
      maxTokens: 4096,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseDraft(raw)
  }
  // maxTokens는 최종 글 본문뿐 아니라 웹서치 도구 호출(tool_use/tool_result)
  // 블록까지 같은 토큰 예산을 나눠 쓴다 — 4096으로는 검색을 여러 번 돌면
  // 본문을 쓰기 전에 예산이 바닥나서 "모델 응답에 텍스트가 없습니다" 에러가
  // 실제로 발생했다(content-schedule 크론에서 발견). 8192로 넉넉하게 늘림.
  //
  // 타임아웃은 일부러 기본값(260초)보다 짧은 170초로 잡는다 — 이 호출이
  // 실패해도 아래 검색 없는 재시도가 있으니, 여기서 너무 오래 버티다가
  // 크론 함수 전체 제한(300초)에 재시도할 시간도 없이 잘리는 것보다,
  // 적당히 빨리 포기하고 재시도로 넘어가는 게 전체적으로 더 안전하다.
  try {
    const raw = await callClaudeJsonWithWebSearch({
      apiKey,
      system: buildDraftSystemPrompt(brandContext, marketFindings, false),
      user,
      maxTokens: 8192,
      maxSearches: 5,
      timeoutMs: 170_000,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseDraft(raw)
  } catch {
    // 웹서치 경로가 타임아웃/응답 이상 등으로 실패하면(주제에 따라 검색이
    // 오래 걸리거나 꼬이는 경우가 실제로 있었다), 검색 없이 지식 기반으로만
    // 한 번 더 시도한다 — "최신 트렌드 반영은 놓치더라도 아예 실패하는 것보단
    // 낫다"는 판단. 크론처럼 사람이 재시도를 못 누르는 경로에서 특히 중요함.
    const raw = await callClaudeJson({
      apiKey,
      system: buildDraftSystemPrompt(brandContext, marketFindings, false),
      user: `${user}\n\n(실시간 검색 없이, 알고 있는 지식만으로 작성해주세요.)`,
      maxTokens: 4096,
      timeoutMs: 60_000,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseDraft(raw)
  }
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

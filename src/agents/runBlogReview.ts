import {
  callClaudeJson,
  callClaudeJsonWithWebSearch,
  callClaudeVisionJson,
  type VisionImageInput,
} from '../lib/claude'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard'
import {
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
} from './blogPrompts'
import { BLOG_RUBRICS } from './blogRubric'
import type { BlogDraft, BlogReview, BlogRole } from '../types/blog'
import type {
  CriterionScore,
  FlagSeverity,
  RevisionFlag,
} from '../types/domain'

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
  const raw = await callClaudeJsonWithWebSearch({
    apiKey,
    system: buildDraftSystemPrompt(brandContext, marketFindings, false),
    user,
    maxTokens: 4096,
    maxSearches: 5,
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
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseBlogReview(role, raw)
}

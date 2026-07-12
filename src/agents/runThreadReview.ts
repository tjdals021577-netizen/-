import { callClaudeJson, callClaudeVisionJson, type VisionImageInput } from '../lib/claude'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard'
import {
  buildThreadDraftSystemPrompt,
  buildThreadDraftUserPrompt,
  buildThreadReferenceSystemPrompt,
  buildThreadReferenceUserPrompt,
  buildThreadReviewSystemPrompt,
  buildThreadReviewUserPrompt,
} from './threadPrompts'
import { THREAD_RUBRIC } from './threadRubric'
import type { ThreadDraft, ThreadReview } from '../types/thread'
import type { CriterionScore, FlagSeverity, RevisionFlag } from '../types/domain'

const FLAG_SEVERITIES: FlagSeverity[] = ['info', 'check', 'risk']

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseDraft(raw: unknown): ThreadDraft {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 초안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return { text: typeof rec.text === 'string' ? rec.text : '' }
}

function parseCriteriaScores(raw: unknown): CriterionScore[] {
  const validIds = new Set(THREAD_RUBRIC.map((c) => c.id))
  if (!Array.isArray(raw)) return []
  const out: CriterionScore[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const criterionId = String(rec.criterionId ?? '')
    if (!validIds.has(criterionId)) continue
    const score = Math.max(0, Math.min(25, toNumber(rec.score)))
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

function parseThreadReview(raw: unknown): ThreadReview {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 채점 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const criteriaScores = parseCriteriaScores(rec.criteriaScores)
  const scoredSum = criteriaScores.reduce((s, c) => s + c.score, 0)
  const declaredTotal = toNumber(rec.totalScore, scoredSum)
  const totalScore =
    criteriaScores.length === THREAD_RUBRIC.length &&
    Math.abs(declaredTotal - scoredSum) > 5
      ? scoredSum
      : Math.max(0, Math.min(100, declaredTotal))

  return {
    totalScore,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    criteriaScores,
    flags: parseFlags(rec.flags),
  }
}

export async function generateThreadDraft(params: {
  apiKey: string
  topic: string
  brandVoice?: string
  recentPosts?: string[]
  previousDraft?: ThreadDraft
  feedback?: string
  referenceImages?: VisionImageInput[]
  marketFindings?: string
}): Promise<ThreadDraft> {
  const { apiKey, topic, brandVoice, recentPosts, previousDraft, feedback, referenceImages, marketFindings } =
    params
  // 클라이언트에 레퍼런스 이미지가 등록돼 있으면 비전 호출로 스타일을
  // 참고시킨다 — 없으면 기존과 동일한 텍스트 전용 호출.
  if (referenceImages && referenceImages.length > 0) {
    const raw = await callClaudeVisionJson({
      apiKey,
      system: buildThreadDraftSystemPrompt({ brandVoice, recentPosts, marketFindings }),
      user: buildThreadDraftUserPrompt({ topic, previousDraft, feedback }),
      images: referenceImages,
      maxTokens: 1536,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseDraft(raw)
  }
  const raw = await callClaudeJson({
    apiKey,
    system: buildThreadDraftSystemPrompt({ brandVoice, recentPosts, marketFindings }),
    user: buildThreadDraftUserPrompt({ topic, previousDraft, feedback }),
    maxTokens: 1536,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseDraft(raw)
}

// 클라이언트가 초안이 마음에 안 들 때, 새 레퍼런스 이미지를 넣고 "3개
// 시안"을 한 번에 받아보는 용도. 점수 매기기/자동 재생성 루프 없이 후보만
// 여러 개 제시해서 API를 반복 호출하지 않고 사람이 직접 고르게 한다.
export async function generateThreadVariantsWithReferences(params: {
  apiKey: string
  topic: string
  brandVoice?: string
  referenceImages: VisionImageInput[]
  variantCount?: number
}): Promise<ThreadDraft[]> {
  const { apiKey, topic, brandVoice, referenceImages, variantCount = 3 } = params
  const raw = await callClaudeVisionJson({
    apiKey,
    system: buildThreadReferenceSystemPrompt({ brandVoice, variantCount }),
    user: buildThreadReferenceUserPrompt({ topic, variantCount }),
    images: referenceImages,
    maxTokens: 2048,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  if (!Array.isArray(rec.drafts)) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  return rec.drafts.map((d) => parseDraft(d))
}

export async function runThreadReview(params: {
  apiKey: string
  draft: ThreadDraft
}): Promise<ThreadReview> {
  const { apiKey, draft } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildThreadReviewSystemPrompt(),
    user: buildThreadReviewUserPrompt(draft),
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseThreadReview(raw)
}

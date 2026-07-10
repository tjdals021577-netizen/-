import { callClaudeJson } from '../lib/claude'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard'
import {
  buildThreadDraftSystemPrompt,
  buildThreadDraftUserPrompt,
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
}): Promise<ThreadDraft> {
  const { apiKey, topic, brandVoice, recentPosts, previousDraft, feedback } =
    params
  const raw = await callClaudeJson({
    apiKey,
    system: buildThreadDraftSystemPrompt({ brandVoice, recentPosts }),
    user: buildThreadDraftUserPrompt({ topic, previousDraft, feedback }),
    maxTokens: 1536,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseDraft(raw)
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

import { callClaudeJson } from '../lib/claude'
import { buildSystemPrompt, buildUserPrompt } from './prompts'
import { RUBRICS } from './rubric'
import {
  PASS_THRESHOLD,
  type AgentReview,
  type AgentRole,
  type CriterionScore,
  type CutAction,
  type CutSuggestion,
  type EmphasisSuggestion,
  type EmphasisType,
  type ReviewResult,
} from '../types/domain'

const CUT_ACTIONS: CutAction[] = ['cut', 'keep_tight', 'keep']
const EMPHASIS_TYPES: EmphasisType[] = [
  'caption',
  'zoom_punch_in',
  'sfx',
  'freeze_frame',
  'b_roll',
  'thumbnail_moment',
]

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseCriteriaScores(
  role: AgentRole,
  raw: unknown,
): CriterionScore[] {
  const validIds = new Set(RUBRICS[role].map((c) => c.id))
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

function parseCutSuggestions(raw: unknown): CutSuggestion[] {
  if (!Array.isArray(raw)) return []
  const out: CutSuggestion[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const action = CUT_ACTIONS.includes(rec.action as CutAction)
      ? (rec.action as CutAction)
      : 'cut'
    out.push({
      startSec: Math.max(0, toNumber(rec.startSec)),
      endSec: Math.max(0, toNumber(rec.endSec)),
      action,
      reason: typeof rec.reason === 'string' ? rec.reason : '',
    })
  }
  return out
}

function parseEmphasisSuggestions(raw: unknown): EmphasisSuggestion[] {
  if (!Array.isArray(raw)) return []
  const out: EmphasisSuggestion[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const type = EMPHASIS_TYPES.includes(rec.type as EmphasisType)
      ? (rec.type as EmphasisType)
      : 'caption'
    out.push({
      timeSec: Math.max(0, toNumber(rec.timeSec)),
      type,
      label: typeof rec.label === 'string' ? rec.label : '',
      reason: typeof rec.reason === 'string' ? rec.reason : '',
    })
  }
  return out
}

function parseAgentReview(role: AgentRole, raw: unknown): AgentReview {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('에이전트 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const criteriaScores = parseCriteriaScores(role, rec.criteriaScores)
  const scoredSum = criteriaScores.reduce((s, c) => s + c.score, 0)
  const declaredTotal = toNumber(rec.totalScore, scoredSum)
  // 선언된 총점과 항목 합이 크게 어긋나면(모델 실수) 항목 합을 신뢰한다.
  const totalScore =
    criteriaScores.length === RUBRICS[role].length &&
    Math.abs(declaredTotal - scoredSum) > 5
      ? scoredSum
      : Math.max(0, Math.min(100, declaredTotal))

  return {
    role,
    totalScore,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    criteriaScores,
    cutSuggestions: parseCutSuggestions(rec.cutSuggestions),
    emphasisSuggestions: parseEmphasisSuggestions(rec.emphasisSuggestions),
    risks: Array.isArray(rec.risks)
      ? rec.risks.filter((r): r is string => typeof r === 'string')
      : [],
  }
}

export async function runAgentReview(params: {
  apiKey: string
  role: AgentRole
  planSummary: string
  transcriptText: string
}): Promise<AgentReview> {
  const { apiKey, role, planSummary, transcriptText } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildSystemPrompt(role),
    user: buildUserPrompt({ planSummary, transcriptText }),
  })
  return parseAgentReview(role, raw)
}

export async function runCommittee(params: {
  apiKey: string
  planSummary: string
  transcriptText: string
  onRoleSettled?: (role: AgentRole, review: AgentReview | Error) => void
}): Promise<ReviewResult> {
  const { apiKey, planSummary, transcriptText, onRoleSettled } = params
  const roles: AgentRole[] = ['planning', 'editing', 'strategy']

  const settled = await Promise.allSettled(
    roles.map(async (role) => {
      try {
        const review = await runAgentReview({
          apiKey,
          role,
          planSummary,
          transcriptText,
        })
        onRoleSettled?.(role, review)
        return review
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        onRoleSettled?.(role, error)
        throw error
      }
    }),
  )

  const reviews: AgentReview[] = []
  const errors: string[] = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      reviews.push(result.value)
    } else {
      errors.push(`${roles[i]}: ${result.reason?.message ?? result.reason}`)
    }
  })

  if (reviews.length === 0) {
    throw new Error(`모든 에이전트 심사가 실패했습니다.\n${errors.join('\n')}`)
  }

  const averageScore =
    reviews.reduce((s, r) => s + r.totalScore, 0) / reviews.length

  return {
    reviews,
    averageScore,
    passed: reviews.length === roles.length && averageScore >= PASS_THRESHOLD,
    generatedAt: new Date().toISOString(),
  }
}

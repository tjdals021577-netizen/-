import { callClaudeJson } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import { buildRemixSystemPrompt, buildRemixUserPrompt } from './remixPrompts.js'
import { buildRemixReviewSystemPrompt, buildRemixReviewUserPrompt } from './remixReviewPrompts.js'
import { PASS_THRESHOLD } from '../types/domain.js'
import type { RemixPlan, RemixReview } from '../types/remix.js'
import type { CriterionScore, RevisionFlag, FlagSeverity } from '../types/domain.js'

function parseRemixPlan(raw: unknown): RemixPlan {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('유튜브 기획안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return {
    title: typeof rec.title === 'string' ? rec.title : '',
    hooks: Array.isArray(rec.hooks)
      ? rec.hooks.filter((h): h is string => typeof h === 'string')
      : [],
    outline: typeof rec.outline === 'string' ? rec.outline : '',
    benchmarkNotes: Array.isArray(rec.benchmarkNotes)
      ? rec.benchmarkNotes.filter((n): n is string => typeof n === 'string')
      : [],
  }
}

function parseRemixReview(raw: unknown): RemixReview {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('유튜브 채점 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const criteriaScores: CriterionScore[] = Array.isArray(rec.criteriaScores)
    ? rec.criteriaScores.flatMap((c) => {
        if (typeof c !== 'object' || c === null) return []
        const cr = c as Record<string, unknown>
        return [
          {
            criterionId: String(cr.criterionId ?? ''),
            score: typeof cr.score === 'number' ? cr.score : 0,
            comment: String(cr.comment ?? ''),
          },
        ]
      })
    : []
  const flags: RevisionFlag[] = Array.isArray(rec.flags)
    ? rec.flags.flatMap((f) => {
        if (typeof f !== 'object' || f === null) return []
        const fr = f as Record<string, unknown>
        const severity = ['info', 'check', 'risk'].includes(String(fr.severity))
          ? (fr.severity as FlagSeverity)
          : 'check'
        return [{ quote: String(fr.quote ?? ''), reason: String(fr.reason ?? ''), severity }]
      })
    : []
  // totalScore가 없거나 criteriaScores 합과 안 맞으면 합계로 보정한다.
  const sum = criteriaScores.reduce((s, c) => s + c.score, 0)
  const totalScore = typeof rec.totalScore === 'number' ? rec.totalScore : sum
  return {
    totalScore: criteriaScores.length > 0 ? sum : totalScore,
    summary: String(rec.summary ?? ''),
    criteriaScores,
    flags,
  }
}

export async function reviewRemixPlan(params: {
  apiKey: string
  plan: RemixPlan
}): Promise<RemixReview> {
  const { apiKey, plan } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildRemixReviewSystemPrompt(),
    user: buildRemixReviewUserPrompt(plan),
    maxTokens: 2048,
    timeoutMs: 120_000,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseRemixReview(raw)
}

function feedbackFromReview(review: RemixReview): string {
  const weak = review.criteriaScores
    .filter((c) => c.comment)
    .map((c) => `- ${c.criterionId}: ${c.comment}`)
    .join('\n')
  const flags = review.flags.map((f) => `- ${f.reason}`).join('\n')
  return [review.summary, weak, flags].filter(Boolean).join('\n')
}

// 기획 → 채점 → 미달(90 미만)이면 피드백 반영해 딱 한 번 재작성 → 더 높은
// 점수의 기획안을 돌려준다. 재작성해도 미달이면 그대로(미달 상태로) 돌려주고,
// 호출부가 결재함에 올린다(대표님 결정: 미달이어도 일단 결재함에).
export async function generateScoredRemixPlan(params: {
  apiKey: string
  topic: string
  referenceText: string
  brandContext?: string
  marketFindings?: string
  pastFeedback?: string
}): Promise<{ plan: RemixPlan; review: RemixReview }> {
  const { apiKey, topic, referenceText, brandContext, marketFindings, pastFeedback } = params
  const system = buildRemixSystemPrompt(brandContext, marketFindings, pastFeedback)

  async function generate(revision?: { previousPlan: RemixPlan; feedback: string }): Promise<RemixPlan> {
    const user = buildRemixUserPrompt({
      topic,
      referenceText,
      previousPlan: revision
        ? { title: revision.previousPlan.title, outline: revision.previousPlan.outline }
        : undefined,
      feedback: revision?.feedback,
    })
    const raw = await callClaudeJson({
      apiKey,
      system,
      user,
      maxTokens: 8192,
      timeoutMs: 120_000,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseRemixPlan(raw)
  }

  let plan = await generate()
  let review = await reviewRemixPlan({ apiKey, plan })

  if (review.totalScore < PASS_THRESHOLD) {
    try {
      const revised = await generate({ previousPlan: plan, feedback: feedbackFromReview(review) })
      const revisedReview = await reviewRemixPlan({ apiKey, plan: revised })
      // 재작성이 더 높으면 교체, 아니면 첫 기획안 유지(재작성이 오히려 나쁠 수도).
      if (revisedReview.totalScore > review.totalScore) {
        plan = revised
        review = revisedReview
      }
    } catch {
      // 재작성 실패 시 첫 기획안 그대로 진행 — 재작성은 보너스지 필수가 아님.
    }
  }

  return { plan, review }
}

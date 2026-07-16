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
    // 6개 항목 코멘트 + flags + summary가 한국어로 길어져 2048에서 JSON이
    // 잘려 파싱 실패하던 문제 → 넉넉히 늘린다.
    maxTokens: 4096,
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
      // 6단계 대본이 길어 8192에서도 가끔 JSON이 잘려 파싱 실패(대표님 리포트)
      // → 넉넉히 늘린다. 프롬프트에서도 각 단계를 간결히 쓰도록 제한한다.
      maxTokens: 12_000,
      timeoutMs: 150_000,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseRemixPlan(raw)
  }

  // 채점이 실패(응답 잘림·파싱 오류)해도 기획안 자체는 살려서 결재함에 올린다
  // — 블로그(runBlogReviewsResilient)와 같은 원칙. 채점 실패 시 '채점 실패'로
  // 표시하고 통과 취급하지 않는다(사람이 결재함에서 검토).
  async function reviewOrFallback(p: RemixPlan): Promise<RemixReview> {
    try {
      return await reviewRemixPlan({ apiKey, plan: p })
    } catch {
      return { totalScore: 0, summary: '채점 실패 — 내용은 저장됨', criteriaScores: [], flags: [] }
    }
  }

  let plan = await generate()
  let review = await reviewOrFallback(plan)

  // 채점이 정상적으로 됐고(항목 점수 존재) 미달일 때만 1회 재작성한다.
  // 채점 자체가 실패한 경우는 재작성해도 판단 근거가 없으니 그대로 둔다.
  if (review.criteriaScores.length > 0 && review.totalScore < PASS_THRESHOLD) {
    try {
      const revised = await generate({ previousPlan: plan, feedback: feedbackFromReview(review) })
      const revisedReview = await reviewOrFallback(revised)
      // 재작성이 더 높으면 교체, 아니면 첫 기획안 유지(재작성이 오히려 나쁠 수도).
      if (revisedReview.criteriaScores.length > 0 && revisedReview.totalScore > review.totalScore) {
        plan = revised
        review = revisedReview
      }
    } catch {
      // 재작성 실패 시 첫 기획안 그대로 진행 — 재작성은 보너스지 필수가 아님.
    }
  }

  return { plan, review }
}

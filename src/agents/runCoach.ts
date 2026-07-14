import { callClaudeVisionJson } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import {
  buildCoachVisionSystemPrompt,
  buildCoachVisionUserPrompt,
} from './coachPrompts.js'
import type { CoachAnalysis } from '../types/coach.js'

function parseAnalysis(raw: unknown): CoachAnalysis {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('분석 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const extractedStats = Array.isArray(rec.extractedStats)
    ? rec.extractedStats
        .filter(
          (s): s is Record<string, unknown> =>
            typeof s === 'object' && s !== null,
        )
        .map((s) => ({
          label: typeof s.label === 'string' ? s.label : '',
          value: typeof s.value === 'string' ? s.value : '',
        }))
    : []
  return {
    extractedStats,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    nextSteps: Array.isArray(rec.nextSteps)
      ? rec.nextSteps.filter((n): n is string => typeof n === 'string')
      : [],
  }
}

export async function analyzeScreenshot(params: {
  apiKey: string
  context: string
  imageBase64: string
  imageMediaType: 'image/png' | 'image/jpeg' | 'image/webp'
}): Promise<CoachAnalysis> {
  const { apiKey, context, imageBase64, imageMediaType } = params
  const raw = await callClaudeVisionJson({
    apiKey,
    system: buildCoachVisionSystemPrompt(),
    user: buildCoachVisionUserPrompt(context),
    images: [{ imageBase64, imageMediaType }],
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseAnalysis(raw)
}

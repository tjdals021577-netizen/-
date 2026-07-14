import { callClaudeJsonWithWebSearch } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import { buildBrainSystemPrompt, buildBrainUserPrompt } from './brainPrompts.js'
import type { BrainReport } from '../types/brain.js'

function parseBrainReport(raw: unknown): BrainReport {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('리서치 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const findings = Array.isArray(rec.findings)
    ? rec.findings
        .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
        .map((f) => ({
          source: typeof f.source === 'string' ? f.source : '',
          insight: typeof f.insight === 'string' ? f.insight : '',
        }))
    : []
  return {
    findings,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    recommendations: Array.isArray(rec.recommendations)
      ? rec.recommendations.filter((r): r is string => typeof r === 'string')
      : [],
  }
}

export async function researchMarket(params: {
  apiKey: string
  topic: string
  context: string
}): Promise<BrainReport> {
  const { apiKey, topic, context } = params
  const raw = await callClaudeJsonWithWebSearch({
    apiKey,
    system: buildBrainSystemPrompt(),
    user: buildBrainUserPrompt({ topic, context }),
    maxTokens: 4096,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseBrainReport(raw)
}

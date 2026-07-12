import { callClaudeJsonWithWebSearch } from '../lib/claude'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard'
import { buildRemixSystemPrompt, buildRemixUserPrompt } from './remixPrompts'
import type { RemixPlan } from '../types/remix'

function parseRemixPlan(raw: unknown): RemixPlan {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('유튜브 기획안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return {
    hooks: Array.isArray(rec.hooks)
      ? rec.hooks.filter((h): h is string => typeof h === 'string')
      : [],
    outline: typeof rec.outline === 'string' ? rec.outline : '',
    benchmarkNotes: Array.isArray(rec.benchmarkNotes)
      ? rec.benchmarkNotes.filter((n): n is string => typeof n === 'string')
      : [],
  }
}

export async function generateRemixPlan(params: {
  apiKey: string
  topic: string
  referenceText: string
  brandContext?: string
  marketFindings?: string
}): Promise<RemixPlan> {
  const { apiKey, topic, referenceText, brandContext, marketFindings } = params
  // 실제 유튜브 최신 흐름을 검색해서 기획에 반영해야 하므로(단순 지식베이스
  // 기반 추측이 아니라) 웹서치 도구가 붙은 호출을 쓴다.
  const raw = await callClaudeJsonWithWebSearch({
    apiKey,
    system: buildRemixSystemPrompt(brandContext, marketFindings),
    user: buildRemixUserPrompt({ topic, referenceText }),
    maxTokens: 2048,
    maxSearches: 5,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseRemixPlan(raw)
}

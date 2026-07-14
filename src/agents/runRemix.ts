import { callClaudeJsonWithWebSearch } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import { buildRemixSystemPrompt, buildRemixUserPrompt } from './remixPrompts.js'
import type { RemixPlan } from '../types/remix.js'

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
  // 기반 추측이 아니라) 웹서치 도구가 붙은 호출을 쓴다. maxTokens는 검색
  // 도구 호출 블록과 최종 답변이 같은 예산을 나눠 쓰기 때문에(블로그 쪽에서
  // 실제로 예산 부족으로 "응답에 텍스트 없음" 에러가 났었음) 여유 있게 잡음.
  const raw = await callClaudeJsonWithWebSearch({
    apiKey,
    system: buildRemixSystemPrompt(brandContext, marketFindings),
    user: buildRemixUserPrompt({ topic, referenceText }),
    maxTokens: 4096,
    maxSearches: 5,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseRemixPlan(raw)
}

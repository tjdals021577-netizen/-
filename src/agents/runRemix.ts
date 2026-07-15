import { callClaudeJson, callClaudeJsonWithWebSearch } from '../lib/claude.js'
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
  const user = buildRemixUserPrompt({ topic, referenceText })
  const system = buildRemixSystemPrompt(brandContext, marketFindings)
  // 타임아웃을 기본값보다 짧게 잡는 이유는 블로그 쪽과 동일 — 실패해도
  // 검색 없는 재시도가 있으니 적당히 빨리 넘어가는 게 전체적으로 안전하다.
  try {
    const raw = await callClaudeJsonWithWebSearch({
      apiKey,
      system,
      user,
      // 4096으로는 검색 블록이 예산을 다 먹고 최종 JSON이 잘려서 "모델
      // 응답에서 JSON을 찾지 못했습니다" 에러가 실제로 났다(2026-07-15
      // 크론·수동 지시 양쪽에서 확인) — 블로그와 동일하게 8192로 상향.
      maxTokens: 8192,
      maxSearches: 3,
      timeoutMs: 150_000,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseRemixPlan(raw)
  } catch {
    // 웹서치 경로가 타임아웃 등으로 실패하면(주제에 따라 검색이 오래 걸리는
    // 경우가 실제로 있었다 — 블로그 쪽에서 먼저 발견) 검색 없이 지식 기반으로
    // 한 번 더 시도한다. 최신성은 놓치더라도 아예 실패하는 것보단 낫다.
    const raw = await callClaudeJson({
      apiKey,
      system,
      user: `${user}\n\n(실시간 검색 없이, 알고 있는 지식만으로 작성해주세요.)`,
      maxTokens: 4096,
      timeoutMs: 60_000,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseRemixPlan(raw)
  }
}

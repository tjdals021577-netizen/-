import { callClaudeJson } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import { buildRemixSystemPrompt, buildRemixUserPrompt } from './remixPrompts.js'
import type { RemixPlan } from '../types/remix.js'

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

export async function generateRemixPlan(params: {
  apiKey: string
  topic: string
  referenceText: string
  brandContext?: string
  marketFindings?: string
}): Promise<RemixPlan> {
  const { apiKey, topic, referenceText, brandContext, marketFindings } = params
  // 리믹서도 이제 직접 웹 검색을 하지 않는다(대표님 결정: 검색은 브레인
  // 한 명만, 나머지는 그 결과를 공유). 브레인이 조사한 유튜브 트렌드·벤치마킹
  // 자료는 marketFindings로 프롬프트에 들어가고, 유튜브 방법론은 이미
  // 프롬프트 지식 베이스에 있다 — 매번 새로 크롤링하며 토큰을 반복 과금하던
  // 걸 없애는 게 검색 비용 절감의 핵심.
  const user = buildRemixUserPrompt({ topic, referenceText })
  const system = buildRemixSystemPrompt(brandContext, marketFindings)
  const raw = await callClaudeJson({
    apiKey,
    system,
    user,
    // 6단계 아웃라인이 길어서 4096으로는 출력이 잘리고 JSON이 끝나기 전에 끊겨
    // "모델 응답에서 JSON을 찾지 못했습니다"가 반복됐다(실사용 확인) → 8192로 늘림.
    maxTokens: 8192,
    timeoutMs: 120_000,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseRemixPlan(raw)
}

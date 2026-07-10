import { callClaudeJson } from '../lib/claude'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard'
import type { AgencyOnboardingResult } from '../types/agency'

function buildSystemPrompt(): string {
  return `당신은 마잘남 대행 온보딩 담당자입니다. 대표님이 붙여넣은 구글폼 응답(업종·톤·타겟 등 7문항)과 스레드 링크 텍스트를 읽고,
버즈가 페르소나로 사용할 수 있게 정리하세요.

규칙:
1. name: 대표님 호칭(예: "OO뷰티 대표님") — 원문에 상호명이 있으면 그걸로, 없으면 "신규 대표님"으로.
2. business: 업종을 짧게(예: "뷰티 · 피부관리샵").
3. persona: 7문항 응답을 종합해 버즈가 글 쓸 때 참고할 페르소나 문단으로 정리(톤, 타겟, 강조점, 하지 말아야 할 것 포함).
4. threadUrl: 텍스트에서 threads.net 링크를 찾아서. 없으면 빈 문자열.
5. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명이나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{ "name": string, "business": string, "persona": string, "threadUrl": string }`
}

function parseResult(raw: unknown): AgencyOnboardingResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('온보딩 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return {
    name: typeof rec.name === 'string' ? rec.name : '신규 대표님',
    business: typeof rec.business === 'string' ? rec.business : '',
    persona: typeof rec.persona === 'string' ? rec.persona : '',
    threadUrl: typeof rec.threadUrl === 'string' ? rec.threadUrl : '',
  }
}

export async function parseAgencyOnboarding(params: {
  apiKey: string
  pastedText: string
}): Promise<AgencyOnboardingResult> {
  const { apiKey, pastedText } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildSystemPrompt(),
    user: `[붙여넣은 내용]\n${pastedText}\n\n위 내용을 정리하고 JSON으로만 답하세요.`,
    maxTokens: 1024,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseResult(raw)
}

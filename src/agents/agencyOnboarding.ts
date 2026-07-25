import { callClaudeJson, callClaudeVisionJson, type VisionImageInput, type VisionDocInput } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import type { AgencyOnboardingResult } from '../types/agency.js'

function buildSystemPrompt(): string {
  return `당신은 마잘남 대행 온보딩 담당자입니다. 대표님이 준 자료(붙여넣은 구글폼 응답 텍스트, 또는 첨부한
PDF/이미지 — 업종·톤·타겟 등)와 스레드 링크를 읽고, 버즈가 페르소나로 사용할 수 있게 정리하세요.

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
  images?: VisionImageInput[]
  documents?: VisionDocInput[]
}): Promise<AgencyOnboardingResult> {
  const { apiKey, pastedText, images = [], documents = [] } = params
  const hasFiles = images.length > 0 || documents.length > 0
  const textBlock = pastedText.trim()
    ? `[붙여넣은 내용]\n${pastedText}\n\n`
    : '[붙여넣은 텍스트 없음 — 첨부한 PDF/이미지에서 정보를 읽으세요]\n\n'

  // 텍스트만 있으면 저렴한 텍스트 호출, PDF/이미지가 있으면 비전(문서) 호출.
  // 첨부가 많을 때(수십 장) 모델이 설명을 덧붙여 JSON을 못 내놓는 경우가 있어,
  // JSON 파싱 실패 시 "순수 JSON만" 강하게 다시 지시하며 1회 재시도한다.
  async function attempt(strict: boolean): Promise<unknown> {
    const user = `${textBlock}위 자료(텍스트/첨부파일)를 종합해 정리하고 JSON으로만 답하세요.${
      strict ? '\n\n반드시 아래 JSON 스키마와 정확히 일치하는 순수 JSON "한 개"만 출력하세요. 설명·머리말·코드블록 금지.' : ''
    }`
    return hasFiles
      ? callClaudeVisionJson({
          apiKey,
          system: buildSystemPrompt(),
          user,
          images,
          documents,
          maxTokens: 1536,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })
      : callClaudeJson({
          apiKey,
          system: buildSystemPrompt(),
          user,
          maxTokens: 1536,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })
  }

  try {
    return parseResult(await attempt(false))
  } catch {
    return parseResult(await attempt(true))
  }
}

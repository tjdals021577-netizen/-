import { cachedSystem, type SystemBlock } from '../lib/claude.js'
import { CONFIDENTIALITY_RULE } from './sharedRules.js'
import { REMIX_RUBRIC } from './remixRubric.js'
import type { RemixPlan } from '../types/remix.js'

// 유튜브 기획안 채점관 시스템 프롬프트. 루브릭(대표님 유튜브 자료 기반)은
// 호출마다 동일하므로 캐시되는 정적부에 넣는다.
export function buildRemixReviewSystemPrompt(): SystemBlock[] {
  const rubricText = REMIX_RUBRIC.map(
    (c) => `- ${c.id} (${c.label}, ${c.weight}점): ${c.description}`,
  ).join('\n')

  const staticText = `당신은 유튜브 대본 기획을 평가하는 냉정한 채점관입니다.
아래 채점 기준(각 항목 배점 합계 100점)으로 주어진 유튜브 기획안을 평가하세요.

[채점 기준]
${rubricText}

${CONFIDENTIALITY_RULE}

규칙:
1. 각 항목을 배점(weight) 안에서 0점부터 만점까지 정확히 채점한다. 후하게 주지 말고, 기준을 실제로 충족했을 때만 점수를 준다.
2. totalScore는 모든 항목 점수의 합(0~100)이다. criteriaScores의 score 합과 반드시 일치시킨다.
3. flags: 반드시 고쳐야 할 약점을 구체적으로 지적한다(quote=문제 지점, reason=이유, severity=info|check|risk). 최대 4개, 없으면 빈 배열.
4. summary: 이 기획안의 강점과 미달 원인을 2~3문장으로 종합.
5. 분량 제한(응답이 잘리지 않게): comment는 각 1문장, flags의 reason도 1문장으로 짧게 쓴다.
6. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명이나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{
  "totalScore": number,
  "summary": string,
  "criteriaScores": [ { "criterionId": string, "score": number, "comment": string } ],
  "flags": [ { "quote": string, "reason": string, "severity": "info" | "check" | "risk" } ]
}`

  return cachedSystem(staticText, '')
}

export function buildRemixReviewUserPrompt(plan: RemixPlan): string {
  const hooks = plan.hooks.map((h, i) => `${i + 1}. ${h}`).join('\n')
  const notes = plan.benchmarkNotes.map((n) => `- ${n}`).join('\n')
  return `[평가할 유튜브 기획안]

제목: ${plan.title || '(비어 있음)'}

훅 후보:
${hooks || '(없음)'}

대본 구성안:
${plan.outline || '(없음)'}

벤치마킹 근거:
${notes || '(없음)'}

위 기획안을 채점 기준으로 평가하고 JSON으로만 답하세요.`
}

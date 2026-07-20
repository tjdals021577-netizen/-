import { callClaudeJson, callClaudeJsonWithWebSearch, type UsageCallback } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import { buildBrainSystemPrompt, buildBrainUserPrompt } from './brainPrompts.js'
import type { BrainReport } from '../types/brain.js'

const EMPTY_REPORT: BrainReport = { findings: [], summary: '', recommendations: [] }

function parseBrainReport(raw: unknown): BrainReport {
  // 던지지 않는다 — 형식이 어긋나면 빈 리포트로 안전하게 되돌린다(브레인
  // 무중단 원칙). 웹서치 응답이 이상해도 앱이 죽지 않게 하는 방어선.
  if (typeof raw !== 'object' || raw === null) {
    return { ...EMPTY_REPORT }
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

export interface ResilientResearch {
  report: BrainReport
  ok: boolean
  note: string
  // 이번 결과가 "실제 웹서치"로 나왔는지(true), 검색이 실패해 "지식 기반 폴백"
  // 으로 나왔는지(false) 구분하는 값 — 대표님이 웹서치가 진짜 도는지 화면·로그
  // 에서 바로 확인할 수 있게 한다(200만 봐서는 구분이 안 됐던 문제 해결).
  usedWebSearch: boolean
}

// 브레인은 절대 하드 에러로 죽지 않게 한다(대표님 지시: "실패할 수 없게").
// 실패할 수 있는 지점은 3가지 — 웹서치 타임아웃 / 응답 JSON 파싱 실패(잘림·형식
// 오류) / 일시적 API 오류. 이 함수는 그 어떤 경우에도 예외를 밖으로 던지지 않고,
// 아래 순서로 우아하게 낮춰가며 항상 유효한 BrainReport를 돌려준다:
//   1차) 웹서치로 정상 리서치
//   2차) (1차가 던지면) 검색 없이 지식 기반으로 한 번 더 — 타임아웃/검색 오류 우회
//   3차) (2차도 던지면) 빈 리포트 반환(findings 없음) + ok:false — 호출부가 이걸
//        보고 "이번엔 저장 안 함(직전 좋은 리포트 유지)"으로 처리한다.
export async function researchMarketResilient(params: {
  apiKey: string
  topic: string
  context: string
  focus?: string
  onUsage?: UsageCallback
}): Promise<ResilientResearch> {
  const { apiKey, topic, context, focus, onUsage } = params
  const system = buildBrainSystemPrompt()
  const user = buildBrainUserPrompt({ topic, context, focus })
  const track: UsageCallback = (usage) => {
    onUsage?.(usage)
    recordSpendUsd(estimateCostUsd(usage))
  }

  // 1차 — 웹서치(서버에서는 스트리밍으로 호출 — claude.ts 참고).
  // ⚠️ 시간 예산: 크론(brain.ts)에 maxDuration=800(Fluid)을 줬고, 스트리밍이라
  //   장시간 호출도 연결이 안 끊긴다. 두 브랜드 병렬이라 벽시계 = 브랜드 1개
  //   시간이므로, 웹서치에 560초까지 넉넉히 준다.
  // ⚠️ maxSearches: 프롬프트가 "중요 주제 3~4개, 총 5회 이내"로 검색을 스스로
  //   제한하게 했고(효율), 그 위에 하드 상한 6을 둔다 — 모델은 ~5회에서 멈추므로
  //   "호출 횟수 제한(Server tool use limit exceeded)" 에러에 닿지 않는다(헤드룸 1).
  //   maxTokens는 3000 — 프롬프트가 findings 5개·각 2문장으로 압축을 지시하므로
  //   잘림 없이 충분하고, 가장 비싼 출력 토큰을 아낀다.
  try {
    const raw = await callClaudeJsonWithWebSearch({
      apiKey,
      system,
      user,
      maxSearches: 6,
      maxTokens: 3000,
      timeoutMs: 560_000,
      onUsage: track,
    })
    return { report: parseBrainReport(raw), ok: true, note: '완료(웹검색)', usedWebSearch: true }
  } catch (err1) {
    // 웹서치 실패 원인을 로그에 남긴다 — 도구 버전/권한/타임아웃 등을 구분하려고.
    console.error('[brain] 웹서치 실패, 지식 기반으로 폴백:', err1 instanceof Error ? err1.message : String(err1))
    // 2차 — 검색 없이 지식 기반(작고 빠른 호출). 검색 타임아웃/JSON 잘림을 우회.
    try {
      const raw = await callClaudeJson({
        apiKey,
        system,
        user: `${user}\n\n(웹 검색이 일시적으로 불가하니, 검색 없이 아는 범위에서만 신중히 정리하세요. 확실하지 않은 수치·사실은 지어내지 말고 방향성만 제시.)`,
        maxTokens: 3000,
        timeoutMs: 60_000,
        onUsage: track,
      })
      return {
        report: parseBrainReport(raw),
        ok: true,
        note: '완료(검색 실패 → 지식 기반 대체)',
        usedWebSearch: false,
      }
    } catch (err2) {
      // 3차 — 그래도 실패: 예외를 던지지 않고 빈 리포트로 안전 종료.
      return {
        report: EMPTY_REPORT,
        ok: false,
        note: `리서치 일시 실패(다음 주기 자동 재시도): ${err2 instanceof Error ? err2.message : String(err2)}`,
        usedWebSearch: false,
      }
    }
  }
}

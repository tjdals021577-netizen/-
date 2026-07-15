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

  // 1차 — 웹서치
  try {
    const raw = await callClaudeJsonWithWebSearch({
      apiKey,
      system,
      user,
      maxSearches: 3,
      maxTokens: 4096,
      onUsage: track,
    })
    return { report: parseBrainReport(raw), ok: true, note: '완료' }
  } catch {
    // 2차 — 검색 없이 지식 기반(작고 빠른 호출). 검색 타임아웃/JSON 잘림을 우회.
    try {
      const raw = await callClaudeJson({
        apiKey,
        system,
        user: `${user}\n\n(웹 검색이 일시적으로 불가하니, 검색 없이 아는 범위에서만 신중히 정리하세요. 확실하지 않은 수치·사실은 지어내지 말고 방향성만 제시.)`,
        maxTokens: 4096,
        timeoutMs: 120_000,
        onUsage: track,
      })
      return {
        report: parseBrainReport(raw),
        ok: true,
        note: '완료(일시적 검색 오류로 지식 기반 대체)',
      }
    } catch (err2) {
      // 3차 — 그래도 실패: 예외를 던지지 않고 빈 리포트로 안전 종료.
      return {
        report: EMPTY_REPORT,
        ok: false,
        note: `리서치 일시 실패(다음 주기 자동 재시도): ${err2 instanceof Error ? err2.message : String(err2)}`,
      }
    }
  }
}

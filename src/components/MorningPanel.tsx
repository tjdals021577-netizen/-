import { useState } from 'react'
import { ApiKeyBar } from './ApiKeyBar'
import { getStoredApiKey, setStoredApiKey } from '../lib/apiKey'
import { generateMorningBriefing } from '../agents/runMorning'
import type { MorningBriefing } from '../types/morning'
import { getTodaySpendUsd, isOverDailyBudget, DAILY_BUDGET_USD } from '../lib/budgetGuard'
import { getWorkLog, startWorkLog, finishWorkLog } from '../lib/workLog'

function todayEntries() {
  const today = new Date().toISOString().slice(0, 10)
  return getWorkLog().filter((e) => e.startedAt.slice(0, 10) === today)
}

function buildDetailHtml(briefing: MorningBriefing): string {
  const summaries = briefing.agentSummaries
    .map((s) => `- [${s.agent}] ${s.summary}`)
    .join('<br/>')
  return `<b>${briefing.headline}</b><br/>${summaries}`
}

export function MorningPanel() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null)
  const [running, setRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    setStoredApiKey(key)
  }

  const overBudget = isOverDailyBudget()
  const canRun = !!apiKey && !running && !overBudget

  async function handleGenerate() {
    setRunning(true)
    setErrorMessage(null)
    setBriefing(null)

    const entries = todayEntries()
    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'morning',
      kind: '데일리 브리핑',
      note: `오늘 실행 기록 ${entries.length}건 종합`,
    })

    try {
      const result = await generateMorningBriefing({
        apiKey,
        entries,
        todaySpendUsd: spendBefore,
      })
      setBriefing(result)
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: result.headline,
        detailHtml: buildDetailHtml(result),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setErrorMessage(message)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '브리핑 생성 실패',
        detailHtml: message,
      })
    } finally {
      setRunning(false)
      setTodaySpend(getTodaySpendUsd())
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div>
        <h2 className="text-base font-bold text-[var(--text)]">
          모닝 — 오늘의 브리핑
        </h2>
        <p className="mt-1 text-xs text-[var(--text-dim)]">
          오늘 다른 에이전트들이 실제로 실행한 근무 기록과 API 사용액을 모아
          한눈에 볼 수 있게 정리합니다. 자동 08:00 발송은 스케줄러(Phase 4)
          연동 후 지원 — 지금은 아래 버튼으로 직접 만들 수 있습니다.
        </p>
      </div>

      <ApiKeyBar apiKey={apiKey} onChange={handleApiKeyChange} />

      <button
        type="button"
        disabled={!canRun}
        onClick={() => void handleGenerate()}
        className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? '브리핑 만드는 중…' : '지금 브리핑 만들기'}
      </button>
      {!apiKey && (
        <p className="text-center text-[11px] text-[var(--planned)]">
          먼저 위에서 Anthropic API 키를 저장하세요.
        </p>
      )}
      {overBudget && (
        <p className="text-center text-[11px] text-[var(--open)]">
          오늘 예산 한도(${DAILY_BUDGET_USD})를 초과해서 중단했습니다.
        </p>
      )}
      <p className="text-center text-[11px] text-[var(--text-faint)]">
        오늘 사용액 ${todaySpend.toFixed(3)} / ${DAILY_BUDGET_USD}
      </p>

      {errorMessage && (
        <div className="rounded-xl border border-[var(--open)] bg-[var(--open-soft)] p-3 text-sm text-[var(--open)]">
          {errorMessage}
        </div>
      )}

      {briefing && (
        <div className="space-y-3 border-t border-[var(--border)] pt-3">
          <p className="text-sm font-bold text-[var(--text)]">{briefing.headline}</p>

          {briefing.agentSummaries.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--text-faint)]">
                에이전트별 요약
              </p>
              <ul className="space-y-1 text-xs text-[var(--text-dim)]">
                {briefing.agentSummaries.map((s, i) => (
                  <li key={i}>
                    <span className="mr-1.5 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--text-dim)]">
                      {s.agent}
                    </span>
                    {s.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {briefing.risks.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--open)]">
                주의할 점
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-[var(--open)]">
                {briefing.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {briefing.nextActions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--text-faint)]">
                오늘 확인할 것
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-[var(--text-dim)]">
                {briefing.nextActions.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

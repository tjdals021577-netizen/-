import { useState } from 'react'
import { ApiKeyBar } from './ApiKeyBar'
import { getStoredApiKey, setStoredApiKey } from '../lib/apiKey'
import { generateRemixPlan } from '../agents/runRemix'
import type { RemixPlan } from '../types/remix'
import {
  DAILY_BUDGET_USD,
  getTodaySpendUsd,
  isOverDailyBudget,
} from '../lib/budgetGuard'
import { startWorkLog, finishWorkLog } from '../lib/workLog'

function buildDetailHtml(plan: RemixPlan): string {
  const hooksList = plan.hooks.map((h) => `- ${h}`).join('<br/>')
  return `<b>훅 후보 ${plan.hooks.length}개</b><br/>${hooksList}`
}

export function RemixComposer() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())
  const [topic, setTopic] = useState('')
  const [referenceText, setReferenceText] = useState('')

  const [plan, setPlan] = useState<RemixPlan | null>(null)
  const [running, setRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    setStoredApiKey(key)
  }

  const overBudget = isOverDailyBudget()
  const canStart =
    !!apiKey && topic.trim().length > 0 && !running && !overBudget

  async function handleGenerate() {
    if (isOverDailyBudget()) {
      setErrorMessage(
        `오늘 예산 한도($${DAILY_BUDGET_USD})를 초과해서 중단했습니다. 내일 다시 시도해주세요.`,
      )
      return
    }
    setRunning(true)
    setErrorMessage(null)
    setPlan(null)

    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({ agent: 'remix', kind: '수동 지시', note: topic })

    try {
      const newPlan = await generateRemixPlan({ apiKey, topic, referenceText })
      setPlan(newPlan)
      const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: cycleCost,
        note: `훅 후보 ${newPlan.hooks.length}개`,
        detailHtml: buildDetailHtml(newPlan),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setErrorMessage(message)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '기획안 생성 실패',
        detailHtml: message,
      })
    } finally {
      setRunning(false)
      setTodaySpend(getTodaySpendUsd())
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-[var(--text)]">유튜브 대본 기획</h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          주제와 참고 자료를 넣으면 훅 후보와 대본 구성안을 만듭니다. 촬영·편집은
          별도 진행 — 기획안까지만 산출합니다.
        </p>
      </header>

      <ApiKeyBar apiKey={apiKey} onChange={handleApiKeyChange} />

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
            주제
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="예) 제주 여름 숙소 브이로그"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
            참고 자료 (텍스트로 붙여넣기)
          </label>
          <textarea
            value={referenceText}
            onChange={(e) => setReferenceText(e.target.value)}
            placeholder="갖고 계신 자료 내용을 텍스트로 붙여넣어주세요 (PDF 직접 업로드는 다음 단계에서 지원 예정)"
            rows={4}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        <button
          type="button"
          disabled={!canStart}
          onClick={() => void handleGenerate()}
          className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? '기획안 작성 중…' : '기획안 생성'}
        </button>
        {!apiKey && (
          <p className="text-center text-[11px] text-[var(--planned)]">
            먼저 위에서 Anthropic API 키를 저장하세요.
          </p>
        )}
        {overBudget && (
          <p className="text-center text-[11px] text-[var(--open)]">
            오늘 예산 한도(${DAILY_BUDGET_USD})를 초과해서 중단했습니다. 내일
            다시 시도해주세요.
          </p>
        )}
        <p className="text-center text-[11px] text-[var(--text-faint)]">
          오늘 사용액 ${todaySpend.toFixed(3)} / ${DAILY_BUDGET_USD}
        </p>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-[var(--open)] bg-[var(--open-soft)] p-3 text-sm text-[var(--open)]">
          {errorMessage}
        </div>
      )}

      {plan && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-2 text-xs font-semibold text-[var(--text-faint)]">
              훅 후보
            </p>
            <ul className="list-inside list-disc space-y-1 text-sm text-[var(--text)]">
              {plan.hooks.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-2 text-xs font-semibold text-[var(--text-faint)]">
              대본 구성안
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-dim)]">
              {plan.outline}
            </p>
          </div>
          {plan.benchmarkNotes.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="mb-2 text-xs font-semibold text-[var(--text-faint)]">
                벤치마킹 근거
              </p>
              <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-dim)]">
                {plan.benchmarkNotes.map((n, i) => (
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

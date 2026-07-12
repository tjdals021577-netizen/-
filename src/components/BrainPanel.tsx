import { useState } from 'react'
import { ApiKeyBar } from './ApiKeyBar'
import { getStoredApiKey, setStoredApiKey } from '../lib/apiKey'
import { researchMarket } from '../agents/runBrain'
import type { BrainReport } from '../types/brain'
import {
  DAILY_BUDGET_USD,
  getTodaySpendUsd,
  isOverDailyBudget,
} from '../lib/budgetGuard'
import { startWorkLog, finishWorkLog } from '../lib/workLog'
import { BRAND_CONTEXT, BRAND_CHANNELS, type Brand } from '../types/brand'
import { saveBrainReport } from '../lib/brainStore'

function buildDetailHtml(report: BrainReport): string {
  const findingsList = report.findings
    .map((f) => `- [${f.source}] ${f.insight}`)
    .join('<br/>')
  return `<b>발견 사항</b><br/>${findingsList}<br/><br/><b>요약</b><br/>${report.summary}`
}

export function BrainPanel({ brand }: { brand: Brand }) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())
  const [topic, setTopic] = useState('')
  const [context, setContext] = useState('')

  const [report, setReport] = useState<BrainReport | null>(null)
  const [running, setRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    setStoredApiKey(key)
  }

  const overBudget = isOverDailyBudget()
  const canStart = !!apiKey && topic.trim().length > 0 && !running && !overBudget

  async function handleResearch() {
    if (isOverDailyBudget()) {
      setErrorMessage(
        `오늘 예산 한도($${DAILY_BUDGET_USD})를 초과해서 중단했습니다. 내일 다시 시도해주세요.`,
      )
      return
    }
    setRunning(true)
    setErrorMessage(null)
    setReport(null)

    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({ agent: 'brain', brand, kind: '수동 리서치', note: topic })

    try {
      const newReport = await researchMarket({
        apiKey,
        topic,
        context: `[브랜드]\n${BRAND_CONTEXT[brand]}\n운영 채널: ${BRAND_CHANNELS[brand].join(', ')}\n\n${context}`,
      })
      setReport(newReport)
      saveBrainReport({
        brand,
        topic,
        findings: newReport.findings,
        summary: newReport.summary,
        recommendations: newReport.recommendations,
      })
      const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: cycleCost,
        note: `발견 ${newReport.findings.length}건`,
        detailHtml: buildDetailHtml(newReport),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setErrorMessage(message)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '리서치 실패',
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
        <h2 className="text-lg font-bold text-[var(--text)]">브레인 — 시장 벤치마킹</h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          주제를 입력하면 웹 검색으로 실제 최신 정보를 찾아 업메리·마잘남 콘텐츠
          전략에 반영할 리포트를 만듭니다. 이 결과는 자동 저장되어, 이후 라이터·버즈·리믹서가
          같은 브랜드로 글을 쓸 때 최신 리서치로 함께 참고합니다.
        </p>
      </header>

      <ApiKeyBar apiKey={apiKey} onChange={handleApiKeyChange} />

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
            리서치 주제
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="예) 스레드 마케팅 대행 서비스 요즘 트렌드"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
            배경 정보 (선택)
          </label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="왜 이 리서치가 필요한지, 어떤 관점에서 봐야 하는지 적어주세요"
            rows={3}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        <button
          type="button"
          disabled={!canStart}
          onClick={() => void handleResearch()}
          className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? '리서치 중… (웹 검색 포함, 시간이 걸릴 수 있음)' : '리서치 시작'}
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

      {report && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-2 text-xs font-semibold text-[var(--text-faint)]">
              발견 사항
            </p>
            <ul className="space-y-2 text-sm text-[var(--text)]">
              {report.findings.map((f, i) => (
                <li key={i}>
                  <span className="mr-1.5 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--text-dim)]">
                    {f.source}
                  </span>
                  {f.insight}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-2 text-xs font-semibold text-[var(--text-faint)]">
              요약
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-dim)]">
              {report.summary}
            </p>
          </div>
          {report.recommendations.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="mb-2 text-xs font-semibold text-[var(--text-faint)]">
                반영 제안
              </p>
              <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-dim)]">
                {report.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

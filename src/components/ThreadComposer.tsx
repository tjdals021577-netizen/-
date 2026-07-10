import { useState } from 'react'
import { ApiKeyBar } from './ApiKeyBar'
import { getStoredApiKey, setStoredApiKey } from '../lib/apiKey'
import { generateThreadDraft, runThreadReview } from '../agents/runThreadReview'
import { THREAD_RUBRIC } from '../agents/threadRubric'
import type { ThreadDraft, ThreadReview } from '../types/thread'
import { PASS_THRESHOLD } from '../types/domain'
import {
  DAILY_BUDGET_USD,
  getTodaySpendUsd,
  isOverDailyBudget,
} from '../lib/budgetGuard'
import { startWorkLog, finishWorkLog } from '../lib/workLog'
import { submitForApproval } from '../lib/approvalStore'

const SEVERITY_LABEL: Record<string, string> = {
  risk: '반드시 확인',
  check: '확인 필요',
  info: '참고',
}

function severityClass(severity: string): string {
  if (severity === 'risk') return 'bg-[var(--open-soft)] text-[var(--open)]'
  if (severity === 'check')
    return 'bg-[var(--planned-soft)] text-[var(--planned)]'
  return 'bg-[var(--surface-2)] text-[var(--text-faint)]'
}

function buildDetailHtml(draft: ThreadDraft, review: ThreadReview): string {
  const topFlag = review.flags.find((f) => f.severity !== 'info')
  const flagLine = topFlag
    ? `<br/><b>${topFlag.severity === 'risk' ? '반드시 확인' : '확인 필요'}:</b> ${topFlag.reason}`
    : ''
  return `<b>${draft.text.slice(0, 40)}${draft.text.length > 40 ? '…' : ''}</b><br/>${review.totalScore}/100${flagLine}`
}

function buildApprovalHtml(draft: ThreadDraft, review: ThreadReview): string {
  const body = draft.text.replace(/\n/g, '<br/>')
  const flags = review.flags
    .map((f) => `- (${f.severity}) ${f.quote ? `"${f.quote}" — ` : ''}${f.reason}`)
    .join('<br/>')
  const flagsBlock = flags ? `<br/><br/><b>수정 포인트</b><br/>${flags}` : ''
  return `<span style="opacity:.7">${review.summary}</span><br/><br/>${body}${flagsBlock}`
}

export function ThreadComposer() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())
  const [topic, setTopic] = useState('')

  const [draft, setDraft] = useState<ThreadDraft | null>(null)
  const [review, setReview] = useState<ThreadReview | null>(null)
  const [running, setRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    setStoredApiKey(key)
  }

  const passed = review !== null && review.totalScore >= PASS_THRESHOLD
  const overBudget = isOverDailyBudget()
  const canStart =
    !!apiKey && topic.trim().length > 0 && !running && !overBudget

  async function runCycle(feedback?: string, previousDraft?: ThreadDraft) {
    if (isOverDailyBudget()) {
      setErrorMessage(
        `오늘 예산 한도($${DAILY_BUDGET_USD})를 초과해서 중단했습니다. 내일 다시 시도해주세요.`,
      )
      return
    }
    setRunning(true)
    setErrorMessage(null)
    setReview(null)

    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'buzz',
      kind: feedback ? '재생성' : '수동 지시',
      note: topic,
    })

    try {
      const newDraft = await generateThreadDraft({
        apiKey,
        topic,
        previousDraft,
        feedback,
      })
      setDraft(newDraft)

      const newReview = await runThreadReview({ apiKey, draft: newDraft })
      setReview(newReview)

      const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
      const isPassed = newReview.totalScore >= PASS_THRESHOLD
      finishWorkLog(logId, {
        status: isPassed ? 'done' : 'attention',
        statusLabel: isPassed ? '완료' : '보류',
        costUsd: cycleCost,
        note: `${newReview.totalScore}점 ${isPassed ? '통과' : '미달'}`,
        detailHtml: buildDetailHtml(newDraft, newReview),
      })
      submitForApproval({
        agent: 'buzz',
        title: newDraft.text.slice(0, 40) + (newDraft.text.length > 40 ? '…' : ''),
        contentHtml: buildApprovalHtml(newDraft, newReview),
        passed: isPassed,
        scoreLabel: `${newReview.totalScore}/100`,
        sourceWorkLogId: logId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setErrorMessage(message)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '생성/채점 실패',
        detailHtml: message,
      })
    } finally {
      setRunning(false)
      setTodaySpend(getTodaySpendUsd())
    }
  }

  function handleRegenerate() {
    if (!draft || !review) return
    const flagText = review.flags
      .map((f) => `- (${f.severity}) ${f.quote ? `"${f.quote}" — ` : ''}${f.reason}`)
      .join('\n')
    const feedback = `${review.summary}${flagText ? `\n${flagText}` : ''}`
    void runCycle(feedback, draft)
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-[var(--text)]">스레드 위원회</h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          주제를 넣으면 스레드 초안을 쓰고 직관성·명확성·단순함·간결성 4개
          기준으로 채점합니다. {PASS_THRESHOLD}점 이상이면 통과, 아니면
          피드백을 반영해 다시 씁니다.
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
            placeholder="예) 스레드 마케팅 꿀팁 시리즈"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        <button
          type="button"
          disabled={!canStart}
          onClick={() => void runCycle()}
          className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? '작성 + 채점 진행 중…' : '초안 작성 + 심사 시작'}
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

      {draft && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
            {draft.text}
          </p>
        </div>
      )}

      {review && (
        <div className="space-y-3">
          <div
            className={`flex items-center justify-between rounded-xl border p-4 ${
              passed
                ? 'border-[var(--done)] bg-[var(--done-soft)]'
                : 'border-[var(--border)] bg-[var(--surface)]'
            }`}
          >
            <div>
              <p className="text-xs text-[var(--text-faint)]">품질 게이트 점수</p>
              <p
                className={`text-2xl font-bold ${passed ? 'text-[var(--done)]' : 'text-[var(--text)]'}`}
              >
                {review.totalScore}
                <span className="text-sm text-[var(--text-faint)]"> / 100</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  passed
                    ? 'bg-[var(--done)] text-white'
                    : 'bg-[var(--surface-2)] text-[var(--text-dim)]'
                }`}
              >
                {passed
                  ? `통과 (기준 ${PASS_THRESHOLD}점 이상)`
                  : `보류 (기준 ${PASS_THRESHOLD}점 미달)`}
              </span>
              {!passed && (
                <button
                  type="button"
                  disabled={running}
                  onClick={handleRegenerate}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  피드백 반영해 재생성
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-3 text-xs leading-relaxed text-[var(--text-dim)]">
              {review.summary}
            </p>
            <div className="space-y-1.5">
              {THREAD_RUBRIC.map((c) => {
                const cs = review.criteriaScores.find(
                  (s) => s.criterionId === c.id,
                )
                const score = cs?.score ?? 0
                return (
                  <div key={c.id}>
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-dim)]">
                      <span>{c.label}</span>
                      <span>{score}/25</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${(score / 25) * 100}%` }}
                      />
                    </div>
                    {cs?.comment && (
                      <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                        근거: {cs.comment}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {review.flags.length > 0 && (
              <details className="mt-3 text-[11px] text-[var(--text-dim)]" open>
                <summary className="cursor-pointer font-medium text-[var(--text)]">
                  수정 포인트 {review.flags.length}건
                </summary>
                <ul className="mt-1.5 space-y-1.5">
                  {review.flags.map((f, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-[var(--border)] p-2"
                    >
                      <span
                        className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${severityClass(f.severity)}`}
                      >
                        {SEVERITY_LABEL[f.severity] ?? f.severity}
                      </span>
                      {f.quote && (
                        <span className="text-[var(--text-faint)]">
                          "{f.quote}"
                        </span>
                      )}
                      <p className="mt-0.5 text-[var(--text-dim)]">{f.reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

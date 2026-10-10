import { useState } from 'react'
import { generateScoredRemixPlan } from '../agents/runRemix'
import type { RemixPlan, RemixReview } from '../types/remix'
import { PASS_THRESHOLD } from '../types/domain'
import {
  DAILY_BUDGET_USD,
  getTodaySpendUsd,
  isOverDailyBudget,
} from '../lib/budgetGuard'
import { startWorkLog, finishWorkLog } from '../lib/workLog'
import { submitForApproval } from '../lib/approvalStore'
import { createEntry } from '../lib/calendarStore'
import { BRAND_CONTEXT, type Brand } from '../types/brand'
import { getLatestBrainReport, formatBrainFindingsForPrompt } from '../lib/brainStore'
import { formatRecentFeedbackForPrompt } from '../lib/contentFeedbackStore'

function scoreLine(review: RemixReview): string {
  const passed = review.totalScore >= PASS_THRESHOLD
  return `<b>채점</b> ${review.totalScore}점 ${passed ? '통과' : '미달'} — ${review.summary}`
}

function buildDetailHtml(plan: RemixPlan, review: RemixReview): string {
  const hooksList = plan.hooks.map((h) => `- ${h}`).join('<br/>')
  const titleLine = plan.title ? `<b>🎬 제목</b><br/>${plan.title}<br/><br/>` : ''
  return `${titleLine}${scoreLine(review)}<br/><br/><b>훅 후보 ${plan.hooks.length}개</b><br/>${hooksList}`
}

function buildApprovalHtml(plan: RemixPlan, review: RemixReview): string {
  const hooksList = plan.hooks.map((h) => `- ${h}`).join('<br/>')
  const outline = plan.outline.replace(/\n/g, '<br/>')
  const notes = plan.benchmarkNotes.length > 0
    ? `<br/><br/><b>벤치마킹 근거</b><br/>${plan.benchmarkNotes.map((n) => `- ${n}`).join('<br/>')}`
    : ''
  const titleLine = plan.title ? `<b>🎬 제목</b><br/>${plan.title}<br/><br/>` : ''
  return `${titleLine}<b>훅 후보</b><br/>${hooksList}<br/><br/><b>대본 구성안</b><br/>${outline}${notes}<br/><br/>${scoreLine(review)}`
}

const apiKey = 'server-managed'

export function RemixComposer({ brand }: { brand: Brand }) {
  const [topic, setTopic] = useState('')
  const [referenceText, setReferenceText] = useState('')

  const [plan, setPlan] = useState<RemixPlan | null>(null)
  const [review, setReview] = useState<RemixReview | null>(null)
  const [running, setRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())
  const brainReport = getLatestBrainReport(brand)

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
    setReview(null)

    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({ agent: 'remix', brand, kind: '수동 지시', note: topic })

    try {
      const { plan: newPlan, review: newReview } = await generateScoredRemixPlan({
        apiKey,
        topic,
        referenceText,
        brandContext: BRAND_CONTEXT[brand],
        marketFindings: formatBrainFindingsForPrompt(brainReport),
        pastFeedback: formatRecentFeedbackForPrompt(brand, 'youtube'),
      })
      setPlan(newPlan)
      setReview(newReview)
      const passed = newReview.totalScore >= PASS_THRESHOLD
      const scoreNote = `${newReview.totalScore}점 ${passed ? '통과' : '미달'}`
      const videoTitle = newPlan.title || topic
      const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
      finishWorkLog(logId, {
        status: passed ? 'done' : 'attention',
        statusLabel: passed ? '완료' : '보류',
        costUsd: cycleCost,
        note: `${scoreNote} · ${videoTitle}`,
        detailHtml: buildDetailHtml(newPlan, newReview),
      })
      // 미달이어도 일단 결재함에 올린다(대표님 결정) — passed 플래그로만 구분.
      submitForApproval({
        agent: 'remix',
        brand,
        title: videoTitle,
        contentHtml: buildApprovalHtml(newPlan, newReview),
        passed,
        scoreLabel: `${newReview.totalScore}/100`,
        sourceWorkLogId: logId,
      })
      createEntry({
        date: new Date().toISOString().slice(0, 10),
        brand,
        channel: 'youtube',
        title: videoTitle,
        status: passed ? 'planned' : 'open',
        note: scoreNote,
        contentHtml: buildApprovalHtml(newPlan, newReview),
        sourceWorkLogId: logId,
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
          주제와 참고 자료를 넣으면, 실제 유튜브를 검색해서 요즘 비슷한 채널·영상이 어떻게
          반응이 오는지 확인한 뒤 훅 후보와 대본 구성안을 만듭니다. 촬영·편집은
          별도 진행 — 기획안까지만 산출합니다.
        </p>
      </header>

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

        {brainReport && (
          <p className="text-[11px] text-[var(--text-faint)]">
            🧠 브레인 최신 리서치 반영됨 ({new Date(brainReport.createdAt).toLocaleDateString('ko-KR')} · {brainReport.topic})
          </p>
        )}

        <button
          type="button"
          disabled={!canStart}
          onClick={() => void handleGenerate()}
          className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? '기획안 작성 중… (유튜브 검색 포함, 시간이 조금 더 걸릴 수 있어요)' : '기획안 생성'}
        </button>
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
          {plan.title && (
            <div className="rounded-xl border-[1.5px] border-[var(--accent)] bg-[var(--accent-soft)] p-4">
              <p className="mb-1 text-xs font-semibold text-[var(--text-faint)]">🎬 추천 제목</p>
              <p className="text-[15px] font-bold text-[var(--text)]">{plan.title}</p>
            </div>
          )}
          {review && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-[var(--text-faint)]">AI 채점</p>
                <p
                  className="text-[15px] font-extrabold tabular-nums"
                  style={{ color: review.totalScore >= PASS_THRESHOLD ? 'var(--up)' : 'var(--down)' }}
                >
                  {review.totalScore}점 {review.totalScore >= PASS_THRESHOLD ? '통과' : '미달'}
                  <span className="text-[11px] font-normal text-[var(--text-faint)]"> / 100 (통과 {PASS_THRESHOLD})</span>
                </p>
              </div>
              <p className="text-[12.5px] text-[var(--text-dim)]">{review.summary}</p>
              {review.totalScore < PASS_THRESHOLD && (
                <p className="mt-1 text-[11px] text-[var(--text-faint)]">
                  ※ 한 번 재작성 후에도 미달이라 그대로 결재함에 올렸습니다. 검토 후 승인/반려하세요.
                </p>
              )}
            </div>
          )}
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

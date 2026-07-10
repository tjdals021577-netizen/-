import { useState } from 'react'
import { ApiKeyBar } from './ApiKeyBar'
import { BlogAgentCard, type BlogAgentStatus } from './BlogAgentCard'
import { getStoredApiKey, setStoredApiKey } from '../lib/apiKey'
import { generateBlogDraft, runBlogAgentReview } from '../agents/runBlogReview'
import type { BlogDraft, BlogReview, BlogRole } from '../types/blog'
import { PASS_THRESHOLD } from '../types/domain'
import {
  DAILY_BUDGET_USD,
  getTodaySpendUsd,
  isOverDailyBudget,
} from '../lib/budgetGuard'
import { startWorkLog, finishWorkLog } from '../lib/workLog'

const ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']

interface RoleState {
  status: BlogAgentStatus
  review?: BlogReview
  errorMessage?: string
}

function initialRoleStates(): Record<BlogRole, RoleState> {
  return {
    seo: { status: 'idle' },
    copywriting: { status: 'idle' },
    experience: { status: 'idle' },
  }
}

const ROLE_LABEL_KO: Record<BlogRole, string> = {
  seo: 'SEO',
  copywriting: '카피/후킹',
  experience: '고객경험',
}

function buildDetailHtml(draft: BlogDraft, reviews: BlogReview[]): string {
  const scores = reviews
    .map((r) => `${ROLE_LABEL_KO[r.role]} <b>${r.totalScore}</b>/100`)
    .join(' &nbsp;·&nbsp; ')
  const topFlag = reviews.flatMap((r) => r.flags).find((f) => f.severity !== 'info')
  const flagLine = topFlag
    ? `<br/><b>${topFlag.severity === 'risk' ? '반드시 확인' : '확인 필요'}:</b> ${topFlag.reason}`
    : ''
  return `<b>${draft.title}</b><br/>${scores}${flagLine}`
}

export function BlogComposer() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())

  const [topic, setTopic] = useState('')
  const [keyPoints, setKeyPoints] = useState('')
  const [photoDescriptions, setPhotoDescriptions] = useState('')

  const [draft, setDraft] = useState<BlogDraft | null>(null)
  const [roleStates, setRoleStates] =
    useState<Record<BlogRole, RoleState>>(initialRoleStates)
  const [running, setRunning] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    setStoredApiKey(key)
  }

  const doneReviews = ROLES.map((r) => roleStates[r].review).filter(
    (r): r is NonNullable<typeof r> => !!r,
  )
  const allDone = ROLES.every((r) => roleStates[r].status === 'done')
  const averageScore = allDone
    ? doneReviews.reduce((s, r) => s + r.totalScore, 0) / doneReviews.length
    : null
  const passed = allDone && (averageScore ?? 0) >= PASS_THRESHOLD

  const overBudget = isOverDailyBudget()
  const canStart =
    !!apiKey && topic.trim().length > 0 && !running && !overBudget

  async function runCycle(feedback?: string, previousDraft?: BlogDraft) {
    if (isOverDailyBudget()) {
      setDraftError(
        `오늘 예산 한도($${DAILY_BUDGET_USD})를 초과해서 중단했습니다. 내일 다시 시도해주세요.`,
      )
      return
    }
    setRunning(true)
    setDraftError(null)
    setRoleStates({
      seo: { status: 'loading' },
      copywriting: { status: 'loading' },
      experience: { status: 'loading' },
    })

    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'writer',
      kind: feedback ? '재생성' : '수동 지시',
      note: topic,
    })

    let newDraft: BlogDraft
    try {
      newDraft = await generateBlogDraft({
        apiKey,
        topic,
        keyPoints,
        photoDescriptions,
        previousDraft,
        feedback,
      })
      setDraft(newDraft)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDraftError(message)
      setRoleStates(initialRoleStates())
      setRunning(false)
      setTodaySpend(getTodaySpendUsd())
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '초안 생성 실패',
        detailHtml: message,
      })
      return
    }

    const finishedReviews: BlogReview[] = []
    await Promise.allSettled(
      ROLES.map(async (role) => {
        try {
          const review = await runBlogAgentReview({
            apiKey,
            role,
            draft: newDraft,
          })
          finishedReviews.push(review)
          setRoleStates((prev) => ({
            ...prev,
            [role]: { status: 'done', review },
          }))
        } catch (err) {
          setRoleStates((prev) => ({
            ...prev,
            [role]: {
              status: 'error',
              errorMessage: err instanceof Error ? err.message : String(err),
            },
          }))
        }
      }),
    )
    setRunning(false)
    setTodaySpend(getTodaySpendUsd())

    const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
    if (finishedReviews.length < ROLES.length) {
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        costUsd: cycleCost,
        note: '일부 채점 실패',
        detailHtml: buildDetailHtml(newDraft, finishedReviews),
      })
    } else {
      const avg =
        finishedReviews.reduce((s, r) => s + r.totalScore, 0) /
        finishedReviews.length
      const isPassed = avg >= PASS_THRESHOLD
      finishWorkLog(logId, {
        status: isPassed ? 'done' : 'attention',
        statusLabel: isPassed ? '완료' : '보류',
        costUsd: cycleCost,
        note: `${avg.toFixed(1)}점 ${isPassed ? '통과' : '미달'}`,
        detailHtml: buildDetailHtml(newDraft, finishedReviews),
      })
    }
  }

  function handleRegenerate() {
    if (!draft) return
    const feedback = doneReviews
      .map((r) => {
        const flagText = r.flags
          .map((f) => `- (${f.severity}) ${f.quote ? `"${f.quote}" — ` : ''}${f.reason}`)
          .join('\n')
        return `[${r.role}] ${r.summary}${flagText ? `\n${flagText}` : ''}`
      })
      .join('\n\n')
    void runCycle(feedback, draft)
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-[var(--text)]">
          블로그 SEO 위원회
        </h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          주제·핵심 내용을 넣으면 SEO·카피/후킹·고객경험 3인 AI가 초안을 쓰고
          채점합니다. 평균 {PASS_THRESHOLD}점 이상이면 통과, 아니면 피드백을
          반영해 다시 씁니다.
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
            placeholder="예) 타로 신년운세 후기"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
            핵심 내용
          </label>
          <textarea
            value={keyPoints}
            onChange={(e) => setKeyPoints(e.target.value)}
            placeholder="이 글에 꼭 들어가야 할 내용, 강조하고 싶은 포인트를 적어주세요"
            rows={4}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
            사용 가능한 사진 (설명, 한 줄에 하나씩)
          </label>
          <textarea
            value={photoDescriptions}
            onChange={(e) => setPhotoDescriptions(e.target.value)}
            placeholder="예) 상담 공간 전경 사진&#10;타로 카드 클로즈업"
            rows={3}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        <button
          type="button"
          disabled={!canStart}
          onClick={() => void runCycle()}
          className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? '작성 + 3인 AI 심사 진행 중…' : '초안 작성 + 심사 시작'}
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

      {draftError && (
        <div className="rounded-xl border border-[var(--open)] bg-[var(--open-soft)] p-3 text-sm text-[var(--open)]">
          {draftError}
        </div>
      )}

      {draft && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-base font-bold text-[var(--text)]">
              {draft.title}
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-dim)]">
              {draft.body}
            </p>
            {draft.photoPlacements.length > 0 && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <p className="mb-1 text-xs font-medium text-[var(--text-faint)]">
                  사진 배치 제안
                </p>
                <ul className="list-inside list-disc text-xs text-[var(--text-dim)]">
                  {draft.photoPlacements.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {averageScore !== null && (
            <div
              className={`flex items-center justify-between rounded-xl border p-4 ${
                passed
                  ? 'border-[var(--done)] bg-[var(--done-soft)]'
                  : 'border-[var(--border)] bg-[var(--surface)]'
              }`}
            >
              <div>
                <p className="text-xs text-[var(--text-faint)]">3인 평균 점수</p>
                <p
                  className={`text-2xl font-bold ${passed ? 'text-[var(--done)]' : 'text-[var(--text)]'}`}
                >
                  {averageScore.toFixed(1)}
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
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {ROLES.map((role) => (
              <BlogAgentCard
                key={role}
                role={role}
                status={roleStates[role].status}
                review={roleStates[role].review}
                errorMessage={roleStates[role].errorMessage}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { ApiKeyBar } from '../ApiKeyBar'
import { getStoredApiKey, setStoredApiKey } from '../../lib/apiKey'
import { parseAgencyOnboarding } from '../../agents/agencyOnboarding'
import { generateThreadDraft, runThreadReview } from '../../agents/runThreadReview'
import {
  listClients,
  createClient,
  extendClient,
  pauseClient,
  resumeClient,
  saveMemo,
  saveTodayDrafts,
  deleteClient,
  daysRemaining,
  daysElapsed,
  pausedDaysSoFar,
} from '../../lib/agencyStore'
import { startWorkLog, finishWorkLog } from '../../lib/workLog'
import { getTodaySpendUsd, isOverDailyBudget, DAILY_BUDGET_USD } from '../../lib/budgetGuard'
import { PASS_THRESHOLD } from '../../types/domain'
import type { AgencyClient, DraftAttempt } from '../../types/agency'

const DRAFT_COUNT = 5

function statusLabel(client: AgencyClient): { text: string; tone: 'done' | 'planned' | 'muted' } {
  if (client.status === 'paused') return { text: '일시중단', tone: 'muted' }
  const remain = daysRemaining(client)
  if (remain <= 7) return { text: `D-${Math.max(0, remain)}`, tone: 'planned' }
  return { text: '활성', tone: 'done' }
}

function chipClass(tone: 'done' | 'planned' | 'muted'): string {
  if (tone === 'done') return 'bg-[var(--done-soft)] text-[var(--done)]'
  if (tone === 'planned') return 'bg-[var(--planned-soft)] text-[var(--planned)]'
  return 'bg-[var(--surface-3)] text-[var(--text-faint)]'
}

export function AgencyScreen() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())
  const [clients, setClients] = useState<AgencyClient[]>(() => listClients())
  const [onboardingText, setOnboardingText] = useState('')
  const [onboarding, setOnboarding] = useState(false)
  const [onboardError, setOnboardError] = useState<string | null>(null)
  const [busyClientId, setBusyClientId] = useState<string | null>(null)
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({})
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  useEffect(() => {
    const drafts: Record<string, string> = {}
    for (const c of clients) drafts[c.id] = c.memo
    setMemoDrafts((prev) => ({ ...drafts, ...prev }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refresh() {
    setClients(listClients())
  }

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    setStoredApiKey(key)
  }

  async function handleOnboard() {
    if (!apiKey || onboardingText.trim().length === 0) return
    setOnboarding(true)
    setOnboardError(null)
    try {
      const result = await parseAgencyOnboarding({ apiKey, pastedText: onboardingText })
      createClient({
        name: result.name,
        business: result.business,
        persona: result.persona,
        threadUrl: result.threadUrl,
      })
      setOnboardingText('')
      refresh()
    } catch (err) {
      setOnboardError(err instanceof Error ? err.message : String(err))
    } finally {
      setOnboarding(false)
    }
  }

  function handleExtend(id: string) {
    extendClient(id)
    refresh()
  }

  function handlePauseToggle(client: AgencyClient) {
    if (client.status === 'paused') resumeClient(client.id)
    else pauseClient(client.id)
    refresh()
  }

  function handleMemoSave(id: string) {
    saveMemo(id, memoDrafts[id] ?? '')
    refresh()
  }

  function handleDelete(id: string) {
    deleteClient(id)
    refresh()
  }

  async function handleGenerateDrafts(client: AgencyClient) {
    if (!apiKey || isOverDailyBudget()) return
    setBusyClientId(client.id)
    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'buzz',
      brand: '마잘남', // 대행 서비스는 마잘남 사업의 일부라 항상 마잘남으로 기록
      kind: `대행 — ${client.name}`,
      note: '오늘 초안 5건 생성',
    })
    try {
      const attempts: DraftAttempt[] = []
      for (let i = 0; i < DRAFT_COUNT; i++) {
        const draft = await generateThreadDraft({
          apiKey,
          topic: `${client.business} 관련 스레드 게시물`,
          brandVoice: client.persona,
          recentPosts: [
            ...client.recentDraftTexts,
            ...attempts.map((a) => a.draft.text),
          ],
        })
        const review = await runThreadReview({ apiKey, draft })
        attempts.push({ draft, review })
      }
      saveTodayDrafts(client.id, attempts)
      const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
      const passCount = attempts.filter((a) => a.review.totalScore >= PASS_THRESHOLD).length
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: cycleCost,
        note: `${passCount}/${DRAFT_COUNT}건 통과`,
        detailHtml: `<b>${client.name} 오늘 초안 5건</b><br/>${attempts
          .map((a, i) => `${i + 1}. ${a.review.totalScore}점`)
          .join(' · ')}`,
      })
      refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '초안 생성 실패',
        detailHtml: message,
      })
    } finally {
      setBusyClientId(null)
      setTodaySpend(getTodaySpendUsd())
    }
  }

  return (
    <div>
      <PreviewBanner message="구글폼 응답 + 스레드 링크를 붙여넣으면 페르소나를 자동으로 정리해서 카드가 생성됩니다. 계약 날짜·연장·일시중단·초안 생성까지 실제로 동작합니다." />

      <ApiKeyBar apiKey={apiKey} onChange={handleApiKeyChange} />

      <div className="mt-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold text-[var(--text)]">새 대행 클라이언트 온보딩</p>
        <textarea
          value={onboardingText}
          onChange={(e) => setOnboardingText(e.target.value)}
          placeholder="구글폼 응답 전체 + 스레드 링크를 그대로 붙여넣어주세요"
          rows={4}
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          type="button"
          disabled={!apiKey || onboardingText.trim().length === 0 || onboarding}
          onClick={() => void handleOnboard()}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {onboarding ? '페르소나 정리 중…' : '클라이언트 등록'}
        </button>
        {onboardError && (
          <p className="text-xs text-[var(--open)]">{onboardError}</p>
        )}
        <p className="text-[11px] text-[var(--text-faint)]">
          오늘 사용액 ${todaySpend.toFixed(3)} / ${DAILY_BUDGET_USD}
        </p>
      </div>

      {clients.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="text-sm font-medium text-[var(--text)]">등록된 대행 클라이언트가 없습니다</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => {
            const sl = statusLabel(client)
            const elapsed = daysElapsed(client)
            const total = 30
            const pct = Math.min(100, Math.round((elapsed / total) * 100))
            return (
              <div
                key={client.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <a
                    href={client.threadUrl || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)] outline-offset-2 hover:outline hover:outline-2 hover:outline-[var(--accent)]"
                  >
                    {client.name.slice(0, 1)}
                  </a>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[var(--text)]">{client.name}</p>
                    <p className="truncate text-xs text-[var(--text-faint)]">{client.business}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${chipClass(sl.tone)}`}>
                    {sl.text}
                  </span>
                </div>

                <div className="mb-1 flex justify-between font-mono text-[11px] text-[var(--text-faint)]">
                  <span>{client.startDate} ~ {client.endDate}</span>
                  <span>{elapsed}/{total}일</span>
                </div>
                {client.status === 'paused' ? (
                  <p className="mb-2 rounded-lg bg-[var(--planned-soft)] p-2 text-[10.5px] leading-relaxed text-[var(--planned)]">
                    {client.pausedAt}부터 일시중단 · {pausedDaysSoFar(client)}일째 정지
                  </p>
                ) : (
                  <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                  </div>
                )}

                <textarea
                  value={memoDrafts[client.id] ?? ''}
                  onChange={(e) =>
                    setMemoDrafts((prev) => ({ ...prev, [client.id]: e.target.value }))
                  }
                  onBlur={() => handleMemoSave(client.id)}
                  placeholder="메모 (통화 내용, 특이사항)"
                  rows={2}
                  className="mb-2 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                />

                {client.todayDrafts.length > 0 && client.todayDraftsDate && (
                  <details className="mb-2 text-xs">
                    <summary className="cursor-pointer font-medium text-[var(--text)]">
                      {client.todayDraftsDate} 초안 {client.todayDrafts.length}건
                    </summary>
                    <ul className="mt-1 space-y-1.5">
                      {client.todayDrafts.map((a, i) => (
                        <li key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                          <span className="font-mono text-[10px] text-[var(--text-faint)]">{a.review.totalScore}점</span>
                          <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-[var(--text-dim)]">{a.draft.text}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleExtend(client.id)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
                  >
                    1개월 연장
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePauseToggle(client)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
                  >
                    {client.status === 'paused' ? '다시 시작' : '일시중단'}
                  </button>
                  <button
                    type="button"
                    disabled={!apiKey || busyClientId === client.id || isOverDailyBudget()}
                    onClick={() => void handleGenerateDrafts(client)}
                    className="flex-1 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyClientId === client.id ? '생성 중…' : '오늘 초안 5개 생성'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(client.id)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--open)] hover:bg-[var(--open-soft)]"
                  >
                    삭제
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { ApiKeyBar } from './ApiKeyBar'
import { getStoredApiKey, setStoredApiKey } from '../lib/apiKey'
import {
  generateThreadDraft,
  runThreadReview,
  generateThreadVariantsWithReferences,
} from '../agents/runThreadReview'
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
import { createEntry } from '../lib/calendarStore'
import { BRAND_CONTEXT, type Brand } from '../types/brand'
import { listReferences, getReferencesByIds } from '../lib/referenceStore'
import { fileToBase64, mediaTypeOf } from '../lib/imageFile'
import { getLatestBrainReport, formatBrainFindingsForPrompt } from '../lib/brainStore'

const VARIANT_COUNT = 3

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

function buildVariantsHtml(drafts: ThreadDraft[]): string {
  return drafts
    .map((d, i) => `<b>시안 ${i + 1}</b><br/>${d.text.replace(/\n/g, '<br/>')}`)
    .join('<br/><br/>')
}

export function ThreadComposer({ brand }: { brand: Brand }) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())
  const [topic, setTopic] = useState('')

  const [draft, setDraft] = useState<ThreadDraft | null>(null)
  const [review, setReview] = useState<ThreadReview | null>(null)
  const [running, setRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  // 레퍼런스 이미지를 넣으면 채점/재생성 루프 대신 시안 여러 개를 한 번에
  // 받아서 사람이 직접 고르는 모드로 전환된다.
  const [references] = useState(() => listReferences())
  const [refIds, setRefIds] = useState<string[]>([])
  // 라이브러리에 저장 안 하고 이번 한 번만 참고시킬 이미지
  const [adhocFiles, setAdhocFiles] = useState<File[]>([])
  const [variantNote, setVariantNote] = useState('')
  const [variants, setVariants] = useState<ThreadDraft[] | null>(null)
  const [variantRunning, setVariantRunning] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const brainReport = getLatestBrainReport(brand)

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
      brand,
      kind: feedback ? '재생성' : '수동 지시',
      note: topic,
    })

    try {
      const newDraft = await generateThreadDraft({
        apiKey,
        topic,
        brandVoice: BRAND_CONTEXT[brand],
        previousDraft,
        feedback,
        marketFindings: formatBrainFindingsForPrompt(brainReport),
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
      const title = newDraft.text.slice(0, 40) + (newDraft.text.length > 40 ? '…' : '')
      submitForApproval({
        agent: 'buzz',
        brand,
        title,
        contentHtml: buildApprovalHtml(newDraft, newReview),
        passed: isPassed,
        scoreLabel: `${newReview.totalScore}/100`,
        sourceWorkLogId: logId,
      })
      createEntry({
        date: new Date().toISOString().slice(0, 10),
        brand,
        channel: 'thread',
        title,
        status: isPassed ? 'planned' : 'open',
        note: `${newReview.totalScore}점 ${isPassed ? '통과' : '미달'}`,
        contentHtml: buildApprovalHtml(newDraft, newReview),
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

  function toggleRef(id: string) {
    setRefIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  async function runVariantCycle() {
    const hasAnyReference = refIds.length > 0 || adhocFiles.length > 0
    if (!apiKey || !hasAnyReference || topic.trim().length === 0) return
    if (isOverDailyBudget()) {
      setErrorMessage(`오늘 예산 한도($${DAILY_BUDGET_USD})를 초과해서 중단했습니다. 내일 다시 시도해주세요.`)
      return
    }
    setVariantRunning(true)
    setErrorMessage(null)
    setVariants(null)
    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'buzz',
      brand,
      kind: '레퍼런스 시안',
      note: topic,
    })
    try {
      const libraryImages = getReferencesByIds(refIds).map((r) => ({
        imageBase64: r.imageBase64,
        imageMediaType: r.mediaType,
      }))
      const adhocImages = (
        await Promise.all(
          adhocFiles.map(async (f) => {
            const mediaType = mediaTypeOf(f)
            if (!mediaType) return null
            return { imageBase64: await fileToBase64(f), imageMediaType: mediaType }
          }),
        )
      ).filter((img): img is { imageBase64: string; imageMediaType: 'image/png' | 'image/jpeg' | 'image/webp' } => img !== null)
      const referenceImages = [...libraryImages, ...adhocImages]
      const drafts = await generateThreadVariantsWithReferences({
        apiKey,
        topic,
        brandVoice: BRAND_CONTEXT[brand],
        referenceImages,
        variantCount: VARIANT_COUNT,
        note: variantNote,
      })
      setVariants(drafts)
      const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: cycleCost,
        note: `레퍼런스 시안 ${drafts.length}개`,
        detailHtml: buildVariantsHtml(drafts),
      })
      const title = `레퍼런스 시안 — ${topic}`
      const contentHtml = buildVariantsHtml(drafts)
      submitForApproval({
        agent: 'buzz',
        brand,
        title,
        contentHtml,
        passed: false,
        scoreLabel: `레퍼런스 시안 ${drafts.length}개`,
        sourceWorkLogId: logId,
      })
      createEntry({
        date: new Date().toISOString().slice(0, 10),
        brand,
        channel: 'thread',
        title,
        status: 'open',
        note: '레퍼런스 시안 — 결재함에서 확인 후 선택',
        contentHtml,
        sourceWorkLogId: logId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setErrorMessage(message)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '레퍼런스 시안 생성 실패',
        detailHtml: message,
      })
    } finally {
      setVariantRunning(false)
      setTodaySpend(getTodaySpendUsd())
      setAdhocFiles([])
    }
  }

  async function handleCopyVariant(text: string, index: number) {
    await navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 2000)
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

        {brainReport && (
          <p className="text-[11px] text-[var(--text-faint)]">
            🧠 브레인 최신 리서치 반영됨 ({new Date(brainReport.createdAt).toLocaleDateString('ko-KR')} · {brainReport.topic})
          </p>
        )}

        <button
          type="button"
          disabled={!canStart}
          onClick={() => void runCycle()}
          className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? '작성 + 채점 진행 중…' : '초안 작성 + 심사 시작'}
        </button>

        <div className="border-t border-[var(--border)] pt-3">
          <p className="mb-1 text-xs font-medium text-[var(--text-dim)]">
            레퍼런스 이미지로 시안 {VARIANT_COUNT}개 받기 (선택 — 채점 없이 스타일만 참고해서 후보만 제시)
          </p>
          {references.length === 0 ? (
            <p className="text-[11px] text-[var(--text-faint)]">
              레퍼런스 라이브러리가 비어있습니다 — 설정 탭에서 먼저 이미지를 등록하세요.
            </p>
          ) : (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {references.map((r) => {
                const selected = refIds.includes(r.id)
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRef(r.id)}
                    title={r.label}
                    className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${
                      selected ? 'border-[var(--accent)]' : 'border-transparent'
                    }`}
                  >
                    <img src={`data:${r.mediaType};base64,${r.imageBase64}`} alt={r.label} className="h-full w-full object-cover" />
                    {selected && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-bold text-white">✓</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          <div className="mb-2">
            <label className="mb-1 block text-[11px] text-[var(--text-faint)]">
              또는 지금 바로 첨부 (라이브러리에 저장 안 하고 이번만 참고)
            </label>
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setAdhocFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-xs text-[var(--text-dim)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--text-dim)]"
            />
            {adhocFiles.length > 0 && (
              <p className="mt-1 text-[10.5px] text-[var(--text-faint)]">{adhocFiles.length}장 선택됨</p>
            )}
          </div>

          <div className="mb-2">
            <label className="mb-1 block text-[11px] text-[var(--text-faint)]">
              요청사항 (선택 — 예: "할인 이벤트 강조해줘", "더 짧고 임팩트 있게")
            </label>
            <textarea
              value={variantNote}
              onChange={(e) => setVariantNote(e.target.value)}
              placeholder="어떻게 다시 써줬으면 좋겠는지 적어주세요"
              rows={2}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          <button
            type="button"
            disabled={
              !apiKey ||
              (refIds.length === 0 && adhocFiles.length === 0) ||
              topic.trim().length === 0 ||
              variantRunning ||
              overBudget
            }
            onClick={() => void runVariantCycle()}
            className="w-full rounded-lg border border-[var(--accent)] py-2 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {variantRunning ? '시안 생성 중…' : `레퍼런스로 시안 ${VARIANT_COUNT}개 받기`}
          </button>
        </div>

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

      {variants && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--text-dim)]">
            레퍼런스 시안 {variants.length}개 (결재함에도 저장됨) — 마음에 드는 걸 복사해서 쓰세요.
          </p>
          {variants.map((v, i) => (
            <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--accent)]">시안 {i + 1}</span>
                <button
                  type="button"
                  onClick={() => void handleCopyVariant(v.text, i)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
                >
                  {copiedIndex === i ? '복사됨 ✓' : '복사'}
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">{v.text}</p>
            </div>
          ))}
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

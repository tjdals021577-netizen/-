import { useEffect, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { parseAgencyOnboarding } from '../../agents/agencyOnboarding'
import { runThreadReviewBatch } from '../../agents/runThreadReview'
import {
  generateAgencyDraftBatch,
  generateAgencyVariantsWithReferences,
  generateAgencyFullFormatSet,
} from '../../agents/runAgencyThread'
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
  syncClientsFromSupabase,
} from '../../lib/agencyStore'
import { listReferences, getReferencesByIds, addReference } from '../../lib/referenceStore'
import { fileToBase64, mediaTypeOf } from '../../lib/imageFile'
import { startWorkLog, finishWorkLog } from '../../lib/workLog'
import { submitForApproval } from '../../lib/approvalStore'
import { createEntry } from '../../lib/calendarStore'
import { getTodaySpendUsd, isOverDailyBudget, DAILY_BUDGET_USD } from '../../lib/budgetGuard'
import { PASS_THRESHOLD } from '../../types/domain'
import type { AgencyClient, DraftAttempt } from '../../types/agency'
import type { ThreadDraft, ThreadFormatDraft } from '../../types/thread'

const DRAFT_COUNT = 3
const REREQUEST_VARIANT_COUNT = 3

function buildDraftsHtml(attempts: DraftAttempt[]): string {
  return attempts
    .map((a, i) => `<b>${i + 1}. ${a.review.totalScore}점</b><br/>${a.draft.text.replace(/\n/g, '<br/>')}`)
    .join('<br/><br/>')
}

function buildFormatSetHtml(drafts: ThreadFormatDraft[]): string {
  return drafts
    .map((d) => `<b>[${d.format}]</b><br/>${d.text.replace(/\n/g, '<br/>')}`)
    .join('<br/><br/>')
}

function buildVariantsHtml(drafts: ThreadDraft[]): string {
  return drafts
    .map((d, i) => `<b>시안 ${i + 1}</b><br/>${d.text.replace(/\n/g, '<br/>')}`)
    .join('<br/><br/>')
}

function toVisionImages(referenceImageIds: string[]) {
  return getReferencesByIds(referenceImageIds).map((r) => ({
    imageBase64: r.imageBase64,
    imageMediaType: r.mediaType,
  }))
}

function ReferencePicker({
  references,
  selectedIds,
  onToggle,
}: {
  references: ReturnType<typeof listReferences>
  selectedIds: string[]
  onToggle: (id: string) => void
}) {
  if (references.length === 0) {
    return (
      <p className="text-[11px] text-[var(--text-faint)]">
        레퍼런스 라이브러리가 비어있습니다 — 설정 탭에서 먼저 이미지를 등록하세요.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {references.map((r) => {
        const selected = selectedIds.includes(r.id)
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onToggle(r.id)}
            title={r.label}
            className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${
              selected ? 'border-[var(--accent)]' : 'border-transparent'
            }`}
          >
            <img
              src={`data:${r.mediaType};base64,${r.imageBase64}`}
              alt={r.label}
              className="h-full w-full object-cover"
            />
            {selected && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-bold text-white">
                ✓
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

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

const apiKey = 'server-managed'

export function AgencyScreen() {
  const [clients, setClients] = useState<AgencyClient[]>(() => listClients())
  const [references, setReferences] = useState(() => listReferences())
  const [onboardingText, setOnboardingText] = useState('')
  const [onboardRefIds, setOnboardRefIds] = useState<string[]>([])
  const [onboardAdhocFiles, setOnboardAdhocFiles] = useState<File[]>([])
  const [onboarding, setOnboarding] = useState(false)
  const [onboardError, setOnboardError] = useState<string | null>(null)
  const [busyClientId, setBusyClientId] = useState<string | null>(null)
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({})
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  // "레퍼런스 넣어 재요청" — 카드별로 새 레퍼런스를 골라서 3개 시안을 받는다.
  const [reRequestClientId, setReRequestClientId] = useState<string | null>(null)
  const [reRequestRefIds, setReRequestRefIds] = useState<string[]>([])
  const [reRequestAdhocFiles, setReRequestAdhocFiles] = useState<File[]>([])
  const [reRequestNote, setReRequestNote] = useState('')
  const [reRequesting, setReRequesting] = useState(false)
  const [reRequestVariants, setReRequestVariants] = useState<Record<string, ThreadDraft[]>>({})

  // "9종 전체 시안" — 대표님의 "마잘남 – 글쓰기" 프롬프트가 정의한 9가지
  // 유형(숫자 리스트형/질문 유도형/비교형/스토리형/팁형/비하인드형/트렌드형/
  // 통합형+CTA/궁금증유발형)을 한 번에 전부 받아본다.
  const [fullFormatClientId, setFullFormatClientId] = useState<string | null>(null)
  const [fullFormatSets, setFullFormatSets] = useState<Record<string, ThreadFormatDraft[]>>({})

  useEffect(() => {
    const drafts: Record<string, string> = {}
    for (const c of clients) drafts[c.id] = c.memo
    setMemoDrafts((prev) => ({ ...drafts, ...prev }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 레이더/모닝과 같은 패턴 — 화면 진입 시 크론(api/cron/agency.ts)이 밤새
  // 만들어둔 초안을 Supabase에서 끌어와 화면에 바로 보이게 한다.
  useEffect(() => {
    syncClientsFromSupabase().then(() => refresh())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refresh() {
    setClients(listClients())
  }

  async function handleOnboard() {
    if (onboardingText.trim().length === 0) return
    setOnboarding(true)
    setOnboardError(null)
    try {
      const result = await parseAgencyOnboarding({ apiKey, pastedText: onboardingText })
      // 직접 첨부한 사진은 라이브러리에 자동 저장해서(클라이언트 이름으로 라벨링)
      // 매일 초안 생성에서도 계속 재사용할 수 있게 한다 — 사용자 입장에서는
      // "라이브러리"를 신경 쓸 필요 없이 그냥 온보딩 화면에서 사진만 올리면 됨.
      const uploadedIds: string[] = []
      for (const file of onboardAdhocFiles) {
        const mediaType = mediaTypeOf(file)
        if (!mediaType) continue
        const imageBase64 = await fileToBase64(file)
        const saved = addReference({ label: `${result.name} 레퍼런스`, imageBase64, mediaType })
        uploadedIds.push(saved.id)
      }
      createClient({
        name: result.name,
        business: result.business,
        persona: result.persona,
        threadUrl: result.threadUrl,
        referenceImageIds: [...onboardRefIds, ...uploadedIds],
      })
      setOnboardingText('')
      setOnboardRefIds([])
      setOnboardAdhocFiles([])
      setReferences(listReferences())
      refresh()
    } catch (err) {
      setOnboardError(err instanceof Error ? err.message : String(err))
    } finally {
      setOnboarding(false)
    }
  }

  function toggleOnboardRef(id: string) {
    setOnboardRefIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  function toggleReRequestRef(id: string) {
    setReRequestRefIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  function openReRequest(client: AgencyClient) {
    setReRequestClientId(client.id)
    setReRequestRefIds(client.referenceImageIds)
    setReRequestAdhocFiles([])
    setReRequestNote('')
  }

  function closeReRequest() {
    setReRequestClientId(null)
    setReRequestRefIds([])
    setReRequestAdhocFiles([])
    setReRequestNote('')
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
    if (isOverDailyBudget()) return
    setBusyClientId(client.id)
    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'buzz',
      brand: '마잘남', // 대행 서비스는 마잘남 사업의 일부라 항상 마잘남으로 기록
      kind: `대행 — ${client.name}`,
      note: `오늘 초안 ${DRAFT_COUNT}건 생성`,
    })
    try {
      const referenceImages = toVisionImages(client.referenceImageIds)
      // 초안 여러 개 생성 1번 + 채점 1번으로 묶음 — 따로따로 10번 부르면 시스템
      // 프롬프트·레퍼런스 이미지 토큰이 매번 반복 과금된다(비용 ~75% 절감).
      const drafts = await generateAgencyDraftBatch({
        apiKey,
        topic: `${client.business} 관련 스레드 게시물`,
        business: client.business,
        persona: client.persona,
        count: DRAFT_COUNT,
        recentPosts: client.recentDraftTexts,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      })
      const reviews = await runThreadReviewBatch({ apiKey, drafts })
      const attempts: DraftAttempt[] = drafts.map((draft, i) => ({ draft, review: reviews[i] }))
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
      const title = `${client.name} — 오늘 초안 ${DRAFT_COUNT}건`
      const contentHtml = buildDraftsHtml(attempts)
      submitForApproval({
        agent: 'buzz',
        brand: '마잘남',
        title,
        contentHtml,
        passed: passCount > 0,
        scoreLabel: `${passCount}/${DRAFT_COUNT}건 통과`,
        sourceWorkLogId: logId,
      })
      createEntry({
        date: new Date().toISOString().slice(0, 10),
        brand: '마잘남',
        channel: 'agency',
        title,
        status: passCount > 0 ? 'planned' : 'open',
        note: `${passCount}/${DRAFT_COUNT}건 통과`,
        contentHtml,
        sourceWorkLogId: logId,
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

  // 초안이 마음에 안 들 때 — 새 레퍼런스 이미지를 넣고 채점/재생성 루프 없이
  // 바로 3개 시안을 받아서 그중 고르게 한다(반복 API 호출로 비용 쌓는 대신).
  async function handleReRequestVariants(client: AgencyClient) {
    const hasAnyReference = reRequestRefIds.length > 0 || reRequestAdhocFiles.length > 0
    if (isOverDailyBudget() || !hasAnyReference) return
    setReRequesting(true)
    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'buzz',
      brand: '마잘남',
      kind: `대행 — ${client.name} (레퍼런스 재요청)`,
      note: `레퍼런스 ${reRequestRefIds.length + reRequestAdhocFiles.length}장으로 시안 ${REREQUEST_VARIANT_COUNT}개 요청`,
    })
    try {
      const libraryImages = toVisionImages(reRequestRefIds)
      const adhocImages = (
        await Promise.all(
          reRequestAdhocFiles.map(async (f) => {
            const mediaType = mediaTypeOf(f)
            if (!mediaType) return null
            return { imageBase64: await fileToBase64(f), imageMediaType: mediaType }
          }),
        )
      ).filter((img): img is { imageBase64: string; imageMediaType: 'image/png' | 'image/jpeg' | 'image/webp' } => img !== null)
      const referenceImages = [...libraryImages, ...adhocImages]
      const drafts = await generateAgencyVariantsWithReferences({
        apiKey,
        topic: `${client.business} 관련 스레드 게시물`,
        business: client.business,
        persona: client.persona,
        referenceImages,
        variantCount: REREQUEST_VARIANT_COUNT,
        note: reRequestNote,
      })
      setReRequestVariants((prev) => ({ ...prev, [client.id]: drafts }))
      const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: cycleCost,
        note: `레퍼런스 재요청 시안 ${drafts.length}개`,
        detailHtml: buildVariantsHtml(drafts),
      })
      const title = `${client.name} — 레퍼런스 재요청 시안 ${drafts.length}개`
      const contentHtml = buildVariantsHtml(drafts)
      submitForApproval({
        agent: 'buzz',
        brand: '마잘남',
        title,
        contentHtml,
        passed: false,
        scoreLabel: `레퍼런스 재요청 · 시안 ${drafts.length}개`,
        sourceWorkLogId: logId,
      })
      createEntry({
        date: new Date().toISOString().slice(0, 10),
        brand: '마잘남',
        channel: 'agency',
        title,
        status: 'open',
        note: '레퍼런스 재요청 시안 — 결재함에서 확인 후 선택',
        contentHtml,
        sourceWorkLogId: logId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '레퍼런스 재요청 실패',
        detailHtml: message,
      })
    } finally {
      setReRequesting(false)
      setTodaySpend(getTodaySpendUsd())
    }
  }

  // "마잘남 – 글쓰기" 프롬프트가 정의한 9가지 유형을 한 번에 전부 받아본다 —
  // 레퍼런스 재요청과 달리 채점 없이 유형별로 다양하게 훑어보는 용도.
  async function handleFullFormatSet(client: AgencyClient) {
    if (isOverDailyBudget()) return
    setFullFormatClientId(client.id)
    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'buzz',
      brand: '마잘남',
      kind: `대행 — ${client.name} (9종 전체 시안)`,
      note: '9가지 유형 전체 생성',
    })
    try {
      const referenceImages = toVisionImages(client.referenceImageIds)
      const drafts = await generateAgencyFullFormatSet({
        apiKey,
        topic: `${client.business} 관련 스레드 게시물`,
        business: client.business,
        persona: client.persona,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      })
      setFullFormatSets((prev) => ({ ...prev, [client.id]: drafts }))
      const cycleCost = Math.max(0, getTodaySpendUsd() - spendBefore)
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: cycleCost,
        note: `9종 전체 시안 ${drafts.length}개`,
        detailHtml: buildFormatSetHtml(drafts),
      })
      const title = `${client.name} — 9종 전체 시안 ${drafts.length}개`
      const contentHtml = buildFormatSetHtml(drafts)
      submitForApproval({
        agent: 'buzz',
        brand: '마잘남',
        title,
        contentHtml,
        passed: false,
        scoreLabel: `9종 전체 · 시안 ${drafts.length}개`,
        sourceWorkLogId: logId,
      })
      createEntry({
        date: new Date().toISOString().slice(0, 10),
        brand: '마잘남',
        channel: 'agency',
        title,
        status: 'open',
        note: '9종 전체 시안 — 결재함에서 확인 후 선택',
        contentHtml,
        sourceWorkLogId: logId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '9종 전체 시안 생성 실패',
        detailHtml: message,
      })
    } finally {
      setFullFormatClientId(null)
      setTodaySpend(getTodaySpendUsd())
    }
  }

  return (
    <div>
      <PreviewBanner message="구글폼 응답 + 스레드 링크를 붙여넣으면 페르소나를 자동으로 정리해서 카드가 생성됩니다. 계약 날짜·연장·일시중단·초안 생성까지 실제로 동작합니다." />

      <div className="mt-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold text-[var(--text)]">새 대행 클라이언트 온보딩</p>
        <textarea
          value={onboardingText}
          onChange={(e) => setOnboardingText(e.target.value)}
          placeholder="구글폼 응답 전체 + 스레드 링크를 그대로 붙여넣어주세요"
          rows={4}
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
        />
        <div>
          <p className="mb-1 text-[11px] font-medium text-[var(--text-dim)]">
            카피라이팅 레퍼런스 (선택 — 고르면 매일 초안 생성 시 스타일을 참고합니다)
          </p>
          {references.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[10.5px] text-[var(--text-faint)]">라이브러리에서 고르기</p>
              <ReferencePicker references={references} selectedIds={onboardRefIds} onToggle={toggleOnboardRef} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-[10.5px] text-[var(--text-faint)]">
              또는 지금 바로 사진 첨부 (자동으로 이 클라이언트 레퍼런스로 저장됨)
            </label>
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setOnboardAdhocFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-xs text-[var(--text-dim)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--text-dim)]"
            />
            {onboardAdhocFiles.length > 0 && (
              <p className="mt-1 text-[10.5px] text-[var(--text-faint)]">{onboardAdhocFiles.length}장 선택됨</p>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={onboardingText.trim().length === 0 || onboarding}
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

                {reRequestVariants[client.id] && (
                  <div className="mb-2 space-y-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-2 text-xs">
                    <p className="font-semibold text-[var(--accent)]">레퍼런스 재요청 시안 (결재함에도 저장됨)</p>
                    {reRequestVariants[client.id].map((d, i) => (
                      <p key={i} className="whitespace-pre-wrap rounded-lg bg-[var(--surface)] p-2 text-[11px] text-[var(--text-dim)]">
                        <span className="font-mono text-[10px] text-[var(--text-faint)]">시안 {i + 1}</span>
                        <br />
                        {d.text}
                      </p>
                    ))}
                  </div>
                )}

                {fullFormatSets[client.id] && (
                  <div className="mb-2 space-y-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-2 text-xs">
                    <p className="font-semibold text-[var(--accent)]">9종 전체 시안 (결재함에도 저장됨)</p>
                    {fullFormatSets[client.id].map((d, i) => (
                      <p key={i} className="whitespace-pre-wrap rounded-lg bg-[var(--surface)] p-2 text-[11px] text-[var(--text-dim)]">
                        <span className="font-mono text-[10px] text-[var(--text-faint)]">[{d.format}]</span>
                        <br />
                        {d.text}
                      </p>
                    ))}
                  </div>
                )}

                {reRequestClientId === client.id && (
                  <div className="mb-2 space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                    <p className="text-[11px] font-medium text-[var(--text-dim)]">
                      새 레퍼런스를 골라주세요 — 지금 초안이 마음에 안 들 때, 이 이미지들 스타일로 시안 {REREQUEST_VARIANT_COUNT}개를 새로 받습니다.
                    </p>
                    <ReferencePicker
                      references={references}
                      selectedIds={reRequestRefIds}
                      onToggle={toggleReRequestRef}
                    />
                    <div>
                      <label className="mb-1 block text-[10.5px] text-[var(--text-faint)]">
                        또는 지금 바로 첨부 (라이브러리에 저장 안 함)
                      </label>
                      <input
                        type="file"
                        multiple
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => setReRequestAdhocFiles(Array.from(e.target.files ?? []))}
                        className="block w-full text-xs text-[var(--text-dim)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--text-dim)]"
                      />
                      {reRequestAdhocFiles.length > 0 && (
                        <p className="mt-1 text-[10.5px] text-[var(--text-faint)]">{reRequestAdhocFiles.length}장 선택됨</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-[10.5px] text-[var(--text-faint)]">
                        요청사항 (선택 — 예: "할인 이벤트 강조해줘", "더 짧고 임팩트 있게")
                      </label>
                      <textarea
                        value={reRequestNote}
                        onChange={(e) => setReRequestNote(e.target.value)}
                        placeholder="어떻게 다시 써줬으면 좋겠는지 적어주세요"
                        rows={2}
                        className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={
                          reRequesting ||
                          (reRequestRefIds.length === 0 && reRequestAdhocFiles.length === 0) ||
                          isOverDailyBudget()
                        }
                        onClick={() => void handleReRequestVariants(client)}
                        className="flex-1 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {reRequesting ? '시안 생성 중…' : `${REREQUEST_VARIANT_COUNT}개 시안 받기`}
                      </button>
                      <button
                        type="button"
                        onClick={closeReRequest}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
                      >
                        닫기
                      </button>
                    </div>
                  </div>
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
                    disabled={busyClientId === client.id || isOverDailyBudget()}
                    onClick={() => void handleGenerateDrafts(client)}
                    className="flex-1 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyClientId === client.id ? '생성 중…' : `오늘 초안 ${DRAFT_COUNT}개 생성`}
                  </button>
                  <button
                    type="button"
                    onClick={() => (reRequestClientId === client.id ? closeReRequest() : openReRequest(client))}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
                  >
                    레퍼런스로 재요청
                  </button>
                  <button
                    type="button"
                    disabled={fullFormatClientId === client.id || isOverDailyBudget()}
                    onClick={() => void handleFullFormatSet(client)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-dim)] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {fullFormatClientId === client.id ? '생성 중…' : '9종 전체 시안'}
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

import { useEffect, useMemo, useState } from 'react'
import { listUpmeryTopics, nextFocus, recentFocusCounts, usedTopicKeysFromNotes } from '../agents/upmeryTopicBank'
import type { UpmeryFocus } from '../agents/upmeryReviews'
import { getWorkLog, syncWorkLogFromSupabase } from '../lib/workLog'
import { syncApprovalsFromSupabase } from '../lib/approvalStore'
import type { KeywordTopicReport } from '../agents/upmeryKeywordTopics'

// 업메리 블로그 "주제 목록"(2026-10-25 대표님: "주제 리스트 뽑으면 내가 요청할 때 그거대로 써지게").
// 매일 자동으로 쓰지 않고, 여기서 고른 주제로 서버가 1단계(깊게 쓰기) → 2단계(채점·고쳐 쓰기)를 돌려 결재함에 올린다.
// 이미 쓴 주제는 근무기록 메모("후기 r001"·"주제 qa:3")로 "썼음" 표시 — AI 호출 없이 코드로.
// 주제는 두 곳에서만 나온다(2026-10-25 대표님 "기존 주제 없애고 새로 뽑은 걸로"):
//   ① 검색 많은 주제 — 매주 네이버 키워드도구 실제 검색량으로 뽑은 목록(api/_lib/upmeryKeywordTopics.ts). 이번 주 목록이
//      없으면 화면을 열 때 자동으로 뽑는다(서버가 이번 주 것이 있으면 건너뜀).
//   ② 후기 사례글 — 후기 보관함(upmeryReviews). 예전에 손으로 만든 질문·정보·멘토님 이야기 목록은 화면에서 뺐다
//      (upmeryTopicBank 배열은 이미 쓴 글의 "주제 qa:3" 표시·자동 크론 대비로 남겨 둠).
// ③ 🎓 교육 과정(2026-10-28 대표님 "교육 50 : 수익 50 — 교육으로 홍보해야 믿는다") — 업메리가 수강생을 실제로 어떻게
//    가르치는지 보여 주는 주제(upmeryTopicBank UPMERY_EDU_TOPICS) + 교육 장면 후기.
// 모든 주제는 축(교육·수익)이 있고, 근무기록 "축 교육"으로 최근 10편 비율을 세서 부족한 축을 오늘 추천한다.

type Phase = { key: string; step: 'write' | 'polish' } | null

type DispatchResult = { ok?: boolean; error?: string; message?: string; approvalId?: string; hasKeys?: boolean; report?: KeywordTopicReport | null }

async function postDispatch(body: Record<string, unknown>): Promise<DispatchResult> {
  const password = import.meta.env.VITE_APP_PASSWORD
  const res = await fetch('/api/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(password ? { 'X-App-Password': password } : {}) },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as DispatchResult
  if (!res.ok && !data.error) data.error = `서버 오류 (${res.status})`
  return data
}

const fmt = (n: number) => n.toLocaleString('ko-KR')

// 최신 글 먼저(비율은 최근 10편으로 센다).
function writerNotes(): string[] {
  return getWorkLog('writer', '업메리')
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((e) => e.note)
}

type Row = { key: string; topic: string; detail?: string; hasPhoto?: boolean; writeKey?: string; focus?: UpmeryFocus }

export function UpmeryTopicList() {
  const [notes, setNotes] = useState<string[]>(() => writerNotes())
  const [phase, setPhase] = useState<Phase>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [custom, setCustom] = useState('')
  const [showUsed, setShowUsed] = useState(false)
  const [kw, setKw] = useState<{ hasKeys: boolean; report: KeywordTopicReport | null } | null>(null)
  const [kwBusy, setKwBusy] = useState(false)
  const [kwMsg, setKwMsg] = useState('')

  useEffect(() => {
    let alive = true
    postDispatch({ action: 'upmery-keyword-topics' })
      .then((d) => {
        if (!alive) return
        setKw({ hasKeys: !!d.hasKeys, report: d.report ?? null })
        // 키가 있는데 목록이 없거나 일주일이 지났으면 바로 뽑는다(대표님이 버튼을 안 눌러도 되게).
        const stale = !d.report || Date.now() - Date.parse(d.report.createdAt) > 6 * 86_400_000
        if (d.hasKeys && stale) void refreshKeywords(false)
      })
      .catch(() => undefined)
    syncWorkLogFromSupabase()
      .catch(() => undefined)
      .then(() => {
        if (alive) setNotes(writerNotes())
      })
    return () => {
      alive = false
    }
  }, [])

  const used = useMemo(() => usedTopicKeysFromNotes(notes), [notes])
  const all = useMemo(() => listUpmeryTopics(), [])
  const eduRows: Row[] = [...all.filter((t) => t.kind === 'edu'), ...all.filter((t) => t.kind === 'review' && t.focus === '교육')]
  const incomeRows: Row[] = all.filter((t) => t.kind === 'review' && t.focus === '수익')
  const remainingReviews = all.filter((t) => t.kind === 'review' && !used.has(t.key)).length
  const kwRows: Row[] = (kw?.report?.topics ?? []).map((t) => ({
    key: `kw:${t.keyword}`,
    writeKey: `kw:${t.keyword}|${t.phrase}|${t.focus ?? '수익'}|${t.topic}`,
    topic: t.topic,
    focus: t.focus ?? '수익',
    detail: `"${t.phrase}" 월 ${fmt(t.volume)}회 · 상위 글 ${t.strength}${
      t.topChars !== null ? `(평균 ${fmt(t.topChars)}자${t.topPhotos !== null ? `·사진 ${t.topPhotos}장` : ''})` : ''
    } · 독자 ${t.stage}${t.why ? ` · ${t.why}` : ''}`,
  }))
  // 최근 10편 축 비율 → 부족한 축의 주제를 오늘 추천(검색 주제 우선, 없으면 그 축의 교육 과정·후기).
  const counts = useMemo(() => recentFocusCounts(notes), [notes])
  const want = nextFocus(counts)
  const unused = (rows: Row[]) => rows.filter((t) => !used.has(t.key))
  const pool = [
    ...unused(kwRows).filter((t) => t.focus === want),
    ...unused(want === '교육' ? eduRows : incomeRows),
    ...unused(kwRows),
    ...unused(want === '교육' ? incomeRows : eduRows),
  ]
  const todayRow = pool[0]

  async function refreshKeywords(force = true) {
    setKwBusy(true)
    setKwMsg('')
    try {
      const d = await postDispatch({ action: 'upmery-keyword-topics-refresh', force })
      if (!d.ok) throw new Error(d.error ?? '검색 많은 주제를 못 뽑았어요.')
      setKw({ hasKeys: !!d.hasKeys, report: d.report ?? null })
      setKwMsg(d.message ?? '')
    } catch (err) {
      setKwMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setKwBusy(false)
    }
  }

  async function write(key: string, label: string) {
    if (phase) return
    setResult(null)
    setPhase({ key, step: 'write' })
    try {
      const w = await postDispatch({ action: 'upmery-blog-write', topicKey: key })
      if (!w.ok || !w.approvalId) throw new Error(w.error ?? '글쓰기에 실패했어요.')
      setPhase({ key, step: 'polish' })
      const p = await postDispatch({ action: 'upmery-blog-polish', approvalId: w.approvalId })
      setResult(
        p.ok
          ? { ok: true, text: `"${label}" 글이 결재함에 올라갔어요. 결재함에서 확인해 주세요.` }
          : { ok: true, text: `"${label}" 글은 결재함에 올라갔어요(다듬기는 내일 아침 7시대에 자동으로 마무리돼요 — ${p.error ?? '다듬기 실패'}).` },
      )
    } catch (err) {
      // 화면이 응답을 못 받아도 서버는 계속 쓰고 있을 수 있다 — 결재함을 먼저 보라고 안내.
      const msg = err instanceof Error ? err.message : String(err)
      setResult({ ok: false, text: `${msg} — 잠시 뒤 결재함에 글이 없으면 다시 눌러 주세요.` })
    } finally {
      await Promise.all([syncWorkLogFromSupabase(), syncApprovalsFromSupabase()]).catch(() => undefined)
      setNotes(writerNotes())
      setPhase(null)
    }
  }

  // writeKey: 서버에 넘길 키가 "썼음" 확인 키와 다를 때("kw:키워드|띄어쓴 키워드|제목" vs "kw:키워드").
  function renderRow(t: Row) {
    const done = used.has(t.key)
    const wk = t.writeKey ?? t.key
    const running = phase?.key === wk
    return (
      <li key={t.key} className="flex items-start justify-between gap-2 border-t border-[var(--border)] py-2 first:border-t-0">
        <div className="min-w-0">
          <p className={`text-[13px] ${done ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
            {t.focus && (
              <span
                className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${t.focus === '교육' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-[var(--surface-2,var(--border))] text-[var(--text-muted)]'}`}
              >
                {t.focus}
              </span>
            )}
            {t.hasPhoto && '📷 '}
            {t.topic}
            {done && <span className="ml-1.5 rounded bg-[var(--surface-2,var(--border))] px-1.5 py-0.5 text-[11px]">썼음</span>}
          </p>
          {t.detail && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{t.detail}</p>}
        </div>
        <button
          type="button"
          disabled={!!phase}
          onClick={() => void write(wk, t.topic)}
          className="shrink-0 rounded-full border border-[var(--accent)] px-3 py-1 text-[12px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? (phase?.step === 'write' ? '쓰는 중…' : '다듬는 중…') : '이 주제로 쓰기'}
        </button>
      </li>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[var(--text-muted)]">
        고르면 바로 글을 써서 결재함에 올려요(쓰기 최대 4분 → 채점·다듬기 최대 5분). 기다리는 동안 다른 탭에 가도 서버는 계속 써요.
        주제는 네이버 실제 검색량으로 매주 새로 뽑은 것, 교육 과정, 후기 보관함(남은 후기 {remainingReviews}건)에서 나와요.
        모든 주제는 <b>교육</b> 또는 <b>수익</b> 글이고, 교육 5 : 수익 5가 되게 오늘 추천을 골라요.
      </p>

      {phase && (
        <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] text-[var(--text)]">
          {phase.step === 'write' ? '1단계: 키워드 잡고 깊게 쓰는 중이에요(최대 4분)…' : '2단계: 채점하고 부족하면 고쳐 쓰는 중이에요(최대 5분)…'}
        </p>
      )}
      {result && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${result.ok ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'border border-red-300 text-red-600'}`}>
          {result.text}
        </p>
      )}

      <div className="rounded-lg border border-[var(--accent)] p-3">
        <p className="mb-1 text-[12px] font-bold text-[var(--accent)]">⭐ 오늘 추천 · {want} 글</p>
        <p className="mb-1 text-[11px] text-[var(--text-muted)]">
          최근 {counts.교육 + counts.수익}편: 교육 {counts.교육} · 수익 {counts.수익} (목표 5 : 5) → 오늘은 {want} 글 차례예요.
        </p>
        {todayRow ? (
          <ul>{renderRow(todayRow)}</ul>
        ) : (
          <p className="text-[11px] text-[var(--text-muted)]">
            {kwBusy ? '검색 많은 주제를 뽑는 중이에요…' : '추천할 주제가 아직 없어요 — 검색 많은 주제를 뽑거나 후기를 보내 주세요.'}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[12px] font-bold text-[var(--accent)]">🔎 검색 많은 주제 (네이버 실제 검색량)</p>
          {kw?.hasKeys && (
            <button
              type="button"
              disabled={kwBusy || !!phase}
              onClick={() => void refreshKeywords(true)}
              className="shrink-0 text-[11px] text-[var(--text-muted)] underline disabled:opacity-40"
            >
              {kwBusy ? '뽑는 중…(최대 4분)' : '지금 새로 뽑기'}
            </button>
          )}
        </div>
        {kw === null ? (
          <p className="text-[11px] text-[var(--text-muted)]">불러오는 중…</p>
        ) : !kw.hasKeys && !kw.report ? (
          <p className="text-[11px] text-[var(--text-muted)]">
            네이버 검색광고 API 키를 Vercel에 넣으면(NAVER_AD_API_KEY · NAVER_AD_SECRET_KEY · NAVER_AD_CUSTOMER_ID) 매주 여기에 검색량 순 주제가 떠요.
          </p>
        ) : !kw.report ? (
          <p className="text-[11px] text-[var(--text-muted)]">
            {kwBusy ? '네이버 검색량을 받아 주제를 뽑는 중이에요(1~4분)…' : '아직 이번 주 목록이 없어요 — "지금 새로 뽑기"를 눌러 주세요.'}
          </p>
        ) : (
          <>
            <p className="mb-1 text-[11px] text-[var(--text-muted)]">
              {kw.report.week} · {kw.report.note}. 점수 = 월 검색량(300~5,000이 올라가기 좋은 구간) × 상위 글 강도(상위 3개 글의 글자·사진 수).
            </p>
            <ul>{kwRows.filter((t) => showUsed || !used.has(t.key)).map((t) => renderRow(t))}</ul>
          </>
        )}
        {kwMsg && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{kwMsg}</p>}
      </div>

      <div className="flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          maxLength={120}
          placeholder="직접 주제 입력 (예: 타로 부업 첫 달 현실)"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--text)]"
        />
        <button
          type="button"
          disabled={!!phase || !custom.trim()}
          onClick={() => void write(`custom:${custom.trim()}`, custom.trim())}
          className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {phase?.key.startsWith('custom:') ? '쓰는 중…' : '쓰기'}
        </button>
      </div>

      <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
        <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} />
        이미 쓴 주제도 보기
      </label>

      {[
        { title: '🎓 교육 과정 — 업메리가 실제로 어떻게 가르치는지', rows: eduRows },
        { title: '💰 후기 사례글 — 수강생이 실제로 낸 결과', rows: incomeRows },
      ].map(({ title, rows }) => {
        const shown = rows.filter((t) => showUsed || !used.has(t.key))
        if (shown.length === 0) return null
        return (
          <details key={title} open className="rounded-lg border border-[var(--border)] px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">
              {title} ({shown.length})
            </summary>
            <ul className="mt-1">{shown.map((t) => renderRow(t))}</ul>
          </details>
        )
      })}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import {
  listUpmeryTopics,
  pickUpmeryTopic,
  UPMERY_TOPIC_KIND_LABEL,
  usedReviewIdsFromNotes,
  usedTopicKeysFromNotes,
  type UpmeryTopicOption,
} from '../agents/upmeryTopicBank'
import { getWorkLog, syncWorkLogFromSupabase } from '../lib/workLog'
import { syncApprovalsFromSupabase } from '../lib/approvalStore'
import { kstDateKey, kstNow } from '../lib/weeklySchedule'

// 업메리 블로그 "주제 목록"(2026-10-25 대표님: "주제 리스트 뽑으면 내가 요청할 때 그거대로 써지게").
// 매일 자동으로 쓰지 않고, 여기서 고른 주제로 서버가 1단계(깊게 쓰기) → 2단계(채점·고쳐 쓰기)를 돌려 결재함에 올린다.
// 이미 쓴 주제는 근무기록 메모("후기 r001"·"주제 qa:3")로 "썼음" 표시 — AI 호출 없이 코드로.

type Phase = { key: string; step: 'write' | 'polish' } | null

async function postDispatch(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; message?: string; approvalId?: string }> {
  const password = import.meta.env.VITE_APP_PASSWORD
  const res = await fetch('/api/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(password ? { 'X-App-Password': password } : {}) },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string; approvalId?: string }
  if (!res.ok && !data.error) data.error = `서버 오류 (${res.status})`
  return data
}

const GROUPS: UpmeryTopicOption['kind'][] = ['review', 'qa', 'info', 'story']

export function UpmeryTopicList() {
  const [notes, setNotes] = useState<string[]>(() => getWorkLog('writer', '업메리').map((e) => e.note))
  const [phase, setPhase] = useState<Phase>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [custom, setCustom] = useState('')
  const [showUsed, setShowUsed] = useState(false)

  useEffect(() => {
    let alive = true
    syncWorkLogFromSupabase()
      .catch(() => undefined)
      .then(() => {
        if (alive) setNotes(getWorkLog('writer', '업메리').map((e) => e.note))
      })
    return () => {
      alive = false
    }
  }, [])

  const used = useMemo(() => usedTopicKeysFromNotes(notes), [notes])
  const today = useMemo(() => pickUpmeryTopic(kstDateKey(kstNow()), usedReviewIdsFromNotes(notes)), [notes])
  const topics = useMemo(() => listUpmeryTopics(), [])
  const remainingReviews = topics.filter((t) => t.kind === 'review' && !used.has(t.key)).length

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
      setNotes(getWorkLog('writer', '업메리').map((e) => e.note))
      setPhase(null)
    }
  }

  function renderRow(t: { key: string; topic: string; detail?: string; hasPhoto?: boolean }) {
    const done = used.has(t.key)
    const running = phase?.key === t.key
    return (
      <li key={t.key} className="flex items-start justify-between gap-2 border-t border-[var(--border)] py-2 first:border-t-0">
        <div className="min-w-0">
          <p className={`text-[13px] ${done ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
            {t.hasPhoto && '📷 '}
            {t.topic}
            {done && <span className="ml-1.5 rounded bg-[var(--surface-2,var(--border))] px-1.5 py-0.5 text-[11px]">썼음</span>}
          </p>
          {t.detail && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{t.detail}</p>}
        </div>
        <button
          type="button"
          disabled={!!phase}
          onClick={() => void write(t.key, t.topic)}
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
        후기 사례글은 남은 후기 {remainingReviews}건.
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
        <p className="mb-1 text-[12px] font-bold text-[var(--accent)]">⭐ 오늘 추천 · {UPMERY_TOPIC_KIND_LABEL[today.kind]}</p>
        {today.note && <p className="mb-1 text-[11px] text-[var(--text-muted)]">{today.note}</p>}
        <ul>
          {renderRow({ key: today.key, topic: today.topic, hasPhoto: (today.review?.images.length ?? 0) > 0 })}
        </ul>
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

      {GROUPS.map((kind) => {
        const rows = topics.filter((t) => t.kind === kind && (showUsed || !used.has(t.key)))
        if (rows.length === 0) return null
        return (
          <details key={kind} open={kind === 'review'} className="rounded-lg border border-[var(--border)] px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">
              {UPMERY_TOPIC_KIND_LABEL[kind]} ({rows.length})
            </summary>
            <ul className="mt-1">
              {rows.map((t) => renderRow(t))}
            </ul>
          </details>
        )
      })}
    </div>
  )
}

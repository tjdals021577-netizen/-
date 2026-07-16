import { useEffect, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { getApprovalQueue, reviewItem, syncApprovalsFromSupabase } from '../../lib/approvalStore'
import type { ApprovalAgent, ApprovalItem, ApprovalStatus } from '../../types/approval'
import type { Brand } from '../../types/brand'

const AGENT_LABEL: Record<ApprovalAgent, string> = {
  writer: '라이터 · 블로그',
  buzz: '버즈 · 스레드',
  remix: '리믹서 · 유튜브 기획',
}

const TABS: { id: ApprovalStatus; label: string }[] = [
  { id: 'pending', label: '대기중' },
  { id: 'approved', label: '승인됨' },
  { id: 'rejected', label: '반려됨' },
]

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim()
}

function ApprovalRow({ item, onChange }: { item: ApprovalItem; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [copied, setCopied] = useState(false)

  function handleApprove() {
    reviewItem(item.id, 'approved')
    onChange()
  }

  async function handleCopy() {
    const text = `${item.title}\n\n${stripHtml(item.contentHtml)}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 클립보드 권한이 없는 브라우저 환경 — 조용히 무시
    }
  }

  function handleConfirmReject() {
    reviewItem(item.id, 'rejected', reason.trim() || undefined)
    setRejecting(false)
    setReason('')
    onChange()
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-faint)]">
              {AGENT_LABEL[item.agent]}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                item.passed
                  ? 'bg-[var(--done-soft)] text-[var(--done)]'
                  : 'bg-[var(--planned-soft)] text-[var(--planned)]'
              }`}
            >
              {item.scoreLabel}
            </span>
            <span className="text-[11px] text-[var(--text-faint)]">
              {formatTime(item.createdAt)}
            </span>
          </div>
          <p className="truncate text-[13.5px] font-semibold text-[var(--text)]">
            {item.title}
          </p>
          {item.reviewedAt && (
            <p className="mt-1 text-[11px] text-[var(--text-faint)]">
              {formatTime(item.reviewedAt)}에{' '}
              {item.status === 'approved' ? '승인됨' : '반려됨'}
              {item.reviewNote ? ` — ${item.reviewNote}` : ''}
            </p>
          )}
        </button>

        {item.status === 'pending' && !rejecting && (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={handleApprove}
              className="rounded-lg bg-[var(--done)] px-3 py-1.5 text-[12px] font-bold text-white transition hover:opacity-90"
            >
              승인
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-[12px] font-bold text-[var(--open)] transition hover:opacity-90"
            >
              반려
            </button>
          </div>
        )}
      </div>

      {rejecting && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="반려 사유 (선택)"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleConfirmReject}
              className="rounded-lg bg-[var(--open)] px-3 py-1.5 text-[12px] font-bold text-white transition hover:opacity-90"
            >
              반려 확정
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(false)
                setReason('')
              }}
              className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-[12px] font-bold text-[var(--text-dim)] transition hover:opacity-90"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="mb-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--text-dim)] transition hover:opacity-90"
          >
            {copied ? '복사됨 ✓' : '전체 내용 복사 (붙여넣기용)'}
          </button>
          <div
            className="text-[13px] leading-relaxed text-[var(--text-dim)]"
            dangerouslySetInnerHTML={{ __html: item.contentHtml }}
          />
        </div>
      )}
    </div>
  )
}

export function ApprovalScreen({ brand }: { brand: Brand }) {
  const [tab, setTab] = useState<ApprovalStatus>('pending')
  const [version, setVersion] = useState(0)

  // 서버 크론이 만든 결재분(자동 스레드·유튜브·대행 시안)은 Supabase에만 있어서
  // 화면 진입 시 한 번 당겨온다 — 안 그러면 결재함이 비어 보인다(대표님 확인 문제).
  useEffect(() => {
    void syncApprovalsFromSupabase().then(() => setVersion((v) => v + 1))
  }, [])

  const items = getApprovalQueue(tab, brand)
  const pendingCount = getApprovalQueue('pending', brand).length
  void version // 승인/반려 후 재조회 트리거용

  return (
    <div>
      <PreviewBanner message="라이터·버즈·리믹서가 산출물을 만들 때마다 자동으로 여기에 올라옵니다. 승인/반려는 지금은 기록용이며, 실제 발행(네이버·스레드·유튜브 업로드)은 아직 수동입니다." />

      <div className="mb-4 flex gap-1 rounded-lg bg-[var(--surface-2)] p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition ${
              tab === t.id
                ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm'
                : 'text-[var(--text-faint)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
            {t.id === 'pending' && pendingCount > 0 && (
              <span className="rounded-full bg-[var(--open)] px-1.5 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-faint)]">
          {tab === 'pending' ? '대기 중인 결재 항목이 없습니다.' : '해당 항목이 없습니다.'}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ApprovalRow
              key={item.id}
              item={item}
              onChange={() => setVersion((v) => v + 1)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

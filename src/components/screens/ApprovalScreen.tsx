import { useEffect, useMemo, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { getApprovalQueue, reviewItem, clearFailedPending, syncApprovalsFromSupabase } from '../../lib/approvalStore'
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

// 마잘남 블로그 결재 HTML에서 "발행할 제목·본문"만 꺼낸다(data-naver-title / data-naver-post).
// 키워드 줄·점검 상자·채점은 빼고, 본문은 적당한 꾸밈이 들어간 HTML 그대로 복사한다 —
// 스마트에디터에 붙여넣으면 굵게·소제목·요약 박스가 최대한 유지되게(서식 + 순수 텍스트 둘 다 담음).
function extractNaverParts(contentHtml: string): { title: string; html: string; text: string } | null {
  if (typeof DOMParser === 'undefined' || !contentHtml.includes('data-naver-post')) return null
  const doc = new DOMParser().parseFromString(contentHtml, 'text/html')
  const post = doc.querySelector('[data-naver-post]')
  if (!post) return null
  const html = post.innerHTML
  const text = stripHtml(html.replace(/<\/(p|div)>/gi, '\n').replace(/&nbsp;/g, '')).replace(/\n{3,}/g, '\n\n')
  return { title: doc.querySelector('[data-naver-title]')?.textContent?.trim() ?? '', html, text }
}

async function copyRich(html: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ])
  } catch {
    // 서식 복사를 지원하지 않는 브라우저 — 글자만이라도 복사.
    await navigator.clipboard.writeText(text)
  }
}

function ApprovalRow({ item, onChange }: { item: ApprovalItem; onChange: () => void }) {
  const naver = useMemo(() => extractNaverParts(item.contentHtml), [item.contentHtml])
  const [naverCopied, setNaverCopied] = useState<'title' | 'body' | null>(null)

  async function handleNaverCopy(kind: 'title' | 'body') {
    if (!naver) return
    try {
      if (kind === 'title') await navigator.clipboard.writeText(naver.title || item.title)
      else await copyRich(naver.html, naver.text)
      setNaverCopied(kind)
      setTimeout(() => setNaverCopied(null), 2000)
    } catch {
      // 클립보드 권한이 없는 환경 — 조용히 무시
    }
  }
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
          <div className="mb-2 flex flex-wrap gap-1.5">
            {naver && (
              <>
                <button
                  type="button"
                  onClick={() => void handleNaverCopy('title')}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-bold text-white transition hover:opacity-90"
                >
                  {naverCopied === 'title' ? '제목 복사됨 ✓' : '① 네이버 제목 복사'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleNaverCopy('body')}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-bold text-white transition hover:opacity-90"
                >
                  {naverCopied === 'body' ? '본문 복사됨 ✓' : '② 네이버 본문 복사 (꾸밈 포함)'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--text-dim)] transition hover:opacity-90"
            >
              {copied ? '복사됨 ✓' : '전체 내용 복사 (붙여넣기용)'}
            </button>
          </div>
          {naver && (
            <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
              네이버 글쓰기에서 제목 칸에 ①, 본문에 ②를 붙여넣고 회색 [📸 사진 추천] 자리에 사진을 넣은 뒤 그 줄을 지우면 돼요.
              노란 칸([경험 삽입]·진단 폼 링크)은 직접 채워주세요.
            </p>
          )}
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
  // 대기중이면서 미달(통과 못한) 항목 수 — "미달 정리" 버튼 노출/개수용.
  const failedPendingCount = getApprovalQueue('pending', brand).filter((i) => !i.passed).length
  void version // 승인/반려 후 재조회 트리거용

  function handleClearFailed() {
    if (failedPendingCount === 0) return
    const ok = window.confirm(
      `${brand}의 대기중 미달 기획 ${failedPendingCount}건을 결재함에서 삭제할까요?\n(승인·반려한 항목과 통과한 기획은 그대로 유지됩니다. 되돌릴 수 없어요.)`,
    )
    if (!ok) return
    clearFailedPending(brand)
    setVersion((v) => v + 1)
  }

  return (
    <div>
      <PreviewBanner message="라이터·버즈·리믹서가 산출물을 만들 때마다 자동으로 여기에 올라옵니다. 승인/반려는 지금은 기록용이며, 실제 발행(네이버·스레드·유튜브 업로드)은 아직 수동입니다." />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-[var(--surface-2)] p-1 w-fit">
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

        {/* 미달 테스트 기획 일괄 정리 — 대기중 탭에서 미달 항목이 있을 때만 노출 */}
        {tab === 'pending' && failedPendingCount > 0 && (
          <button
            type="button"
            onClick={handleClearFailed}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-bold text-[var(--open)] transition hover:bg-[var(--open-soft)]"
          >
            미달 {failedPendingCount}건 정리
          </button>
        )}
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

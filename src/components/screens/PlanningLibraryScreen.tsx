import { useEffect, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { getEntries, syncEntriesFromSupabase } from '../../lib/calendarStore'
import type { CalendarChannel, CalendarEntry } from '../../types/calendar'
import type { Brand } from '../../types/brand'

const LIBRARY_CHANNELS: CalendarChannel[] = ['blog', 'thread', 'youtube']

const CHANNEL_LABEL: Record<CalendarChannel, string> = {
  blog: '블로그',
  thread: '스레드',
  youtube: '유튜브',
  agency: '대행',
  etc: '기타',
}

const CHANNEL_AGENT_LABEL: Record<CalendarChannel, string> = {
  blog: '라이터',
  thread: '버즈',
  youtube: '리믹서',
  agency: '대행',
  etc: '',
}

const CHANNEL_DOT: Record<CalendarChannel, string> = {
  blog: 'bg-[var(--accent)]',
  thread: 'bg-[var(--ch-thread)]',
  youtube: 'bg-[var(--ch-yt)]',
  agency: 'bg-[var(--text-faint)]',
  etc: 'bg-[var(--text-faint)]',
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

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}월 ${Number(d)}일`
}

function PlanningCard({ entry }: { entry: CalendarEntry }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const preview = entry.contentHtml ? stripHtml(entry.contentHtml) : entry.note

  async function handleCopy() {
    const text = `${entry.title}\n\n${entry.contentHtml ? stripHtml(entry.contentHtml) : entry.note}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 클립보드 권한이 없는 브라우저 환경 — 조용히 무시
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-faint)]">
          {entry.brand}
        </span>
        <span className="flex items-center gap-1 text-[11.5px] font-bold text-[var(--text-dim)]">
          📅 {formatDate(entry.date)}
        </span>
      </div>

      <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 text-left">
        <p className="text-[13.5px] font-bold leading-snug text-[var(--text)]">{entry.title}</p>
        {!open && preview && (
          <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
            {preview}
          </p>
        )}
      </button>

      {open && (
        <div className="rounded-lg bg-[var(--surface-2)] p-3 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
          {entry.contentHtml ? (
            <div dangerouslySetInnerHTML={{ __html: entry.contentHtml }} />
          ) : (
            <span className="text-[var(--text-faint)]">{entry.note || '상세 내용이 없습니다.'}</span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
        <span className="rounded-full bg-[var(--done-soft)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--done)]">
          {entry.status === 'done' ? '발행 완료' : entry.status === 'open' ? '이슈' : '예정'}
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-dim)] transition hover:opacity-90"
          >
            {copied ? '복사됨 ✓' : '복사'}
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-strong)] transition hover:opacity-90"
          >
            {open ? '접기' : '열기'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PlanningLibraryScreen({ brand }: { brand: Brand }) {
  const [channelFilter, setChannelFilter] = useState<CalendarChannel | 'all'>('all')
  const [query, setQuery] = useState('')
  const [, setVersion] = useState(0)

  // 서버 크론(content-schedule)이 만든 콘텐츠도 여기 보이게 진입 시 한 번 끌어온다.
  useEffect(() => {
    void syncEntriesFromSupabase().then(() => setVersion((v) => v + 1))
  }, [])

  const allEntries = getEntries(brand)
    .filter((e) => LIBRARY_CHANNELS.includes(e.channel) && (e.contentHtml || e.note))
    .sort((a, b) => b.date.localeCompare(a.date))

  const countByChannel = (ch: CalendarChannel) => allEntries.filter((e) => e.channel === ch).length

  const filtered = allEntries.filter((e) => {
    if (channelFilter !== 'all' && e.channel !== channelFilter) return false
    if (query.trim().length === 0) return true
    const q = query.trim().toLowerCase()
    return (
      e.title.toLowerCase().includes(q) ||
      (e.contentHtml ?? '').toLowerCase().includes(q) ||
      e.note.toLowerCase().includes(q)
    )
  })

  const channelsToShow = channelFilter === 'all' ? LIBRARY_CHANNELS : [channelFilter]

  return (
    <div>
      <PreviewBanner message="라이터·버즈·리믹서가 콘텐츠를 완성할 때마다 자동으로 여기에 쌓입니다. 카드를 열면 전체 원고를 볼 수 있고, 업로드할 땐 복사 버튼을 쓰세요." />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setChannelFilter('all')}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition ${
              channelFilter === 'all'
                ? 'bg-[var(--surface-3)] text-[var(--text)]'
                : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)]'
            }`}
          >
            전체 <span className="text-[10.5px] text-[var(--text-faint)]">{allEntries.length}</span>
          </button>
          {LIBRARY_CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => setChannelFilter(ch)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition ${
                channelFilter === ch
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                  : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)]'
              }`}
            >
              {CHANNEL_LABEL[ch]} <span className="text-[10.5px] text-[var(--text-faint)]">{countByChannel(ch)}</span>
            </button>
          ))}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 제목이나 내용으로 찾기"
          className="w-full max-w-[220px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-faint)]">
          아직 완성된 콘텐츠가 없습니다.
        </p>
      ) : (
        channelsToShow.map((ch) => {
          const items = filtered.filter((e) => e.channel === ch)
          if (items.length === 0) return null
          return (
            <section key={ch} className="mb-6">
              <div className="mb-2.5 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${CHANNEL_DOT[ch]}`} />
                <h2 className="text-[14px] font-extrabold text-[var(--text)]">{CHANNEL_LABEL[ch]}</h2>
                <span className="text-[11.5px] font-bold text-[var(--text-faint)]">
                  {CHANNEL_AGENT_LABEL[ch]} · {items.length}건
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((entry) => (
                  <PlanningCard key={entry.id} entry={entry} />
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { BlogComposer } from '../BlogComposer'
import { ThreadComposer } from '../ThreadComposer'
import { RemixComposer } from '../RemixComposer'
import { BrainPanel } from '../BrainPanel'
import { CoachPanel } from '../CoachPanel'
import {
  getEntries,
  syncEntriesFromSupabase,
  toggleChecklistStage,
  createEntry,
  deleteEntry,
} from '../../lib/calendarStore'
import type { CalendarChannel, CalendarEntry, ChecklistStageKey } from '../../types/calendar'
import { CHECKLIST_STAGE_LABEL } from '../../types/calendar'
import {
  getScheduledSlots,
  kstNow,
  kstDateKey,
  addDaysKst,
} from '../../lib/weeklySchedule'
import {
  getContentPhotos,
  addContentPhoto,
  deleteContentPhoto,
  getUpcomingBlogSlots,
  syncContentPhotosFromSupabase,
} from '../../lib/contentPhotoStore'
import { fileToBase64, mediaTypeOf } from '../../lib/imageFile'
import { fetchYoutubeVideoStats, type YoutubeVideoStatRow } from '../../lib/youtubeStatsStore'
import { analyzeYoutubeContent, type YoutubeAnalysis } from '../../agents/runYoutubeAnalysis'
import { startWorkLog, finishWorkLog } from '../../lib/workLog'
import { isOverDailyBudget } from '../../lib/budgetGuard'
import { BRAND_CONTEXT, type Brand } from '../../types/brand'

export type WorkspaceChannel = 'blog' | 'thread' | 'youtube'

const CHANNEL_LABEL: Record<WorkspaceChannel, string> = {
  blog: '블로그',
  thread: '스레드',
  youtube: '유튜브',
}

const CHANNEL_AGENT_LABEL: Record<WorkspaceChannel, string> = {
  blog: '라이터',
  thread: '버즈',
  youtube: '리믹서',
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

// dateStr("YYYY-MM-DD")은 이미 KST 기준 달력 날짜라 타임존 변환이 필요 없다.
// new Date(dateStr + 'T00:00:00+09:00').getDay()처럼 오프셋을 준 뒤 로컬
// getDay()를 읽으면, 실행 환경 로컬 타임존이 UTC일 때 자정 근처에서 요일이
// 하루 밀리는 문제가 실제로 있었다(예: 7/14 화요일이 월요일로 잘못 표시됨) —
// UTC 고정 파싱 + getUTCDay()로 타임존 영향을 아예 없앤다.
function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${dateStr}T00:00:00Z`).getUTCDay()]
  return `${Number(m)}월 ${Number(d)}일 (${weekday})`
}

function Accordion({
  title,
  status,
  defaultOpen = false,
  children,
}: {
  title: string
  status?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-[var(--text)]">{title}</span>
          {status && <span className="text-[11px] text-[var(--text-faint)]">{status}</span>}
        </span>
        <span className="text-[10px] text-[var(--text-faint)]">{open ? '▲ 접기' : '▼ 펼치기'}</span>
      </button>
      {open && <div className="border-t border-[var(--border)] p-4">{children}</div>}
    </div>
  )
}

function WeekStrip({ brand, channel }: { brand: Brand; channel: WorkspaceChannel }) {
  const today = kstNow()
  const startOfWeek = addDaysKst(today, -today.getUTCDay())
  const todayKey = kstDateKey(today)
  const entries = getEntries(brand).filter((e) => e.channel === channel)

  const days = Array.from({ length: 7 }, (_, i) => addDaysKst(startOfWeek, i))
  const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토']

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((d, i) => {
        const dateKey = kstDateKey(d)
        const isToday = dateKey === todayKey
        const isScheduled = getScheduledSlots(d).some((s) => s.brand === brand && s.channel === channel)
        const entry = entries.find((e) => e.date === dateKey)
        const checklist = entry?.checklist ?? []
        const allDone = checklist.length > 0 && checklist.every((c) => c.done)
        const dotClass = entry
          ? allDone
            ? 'bg-[var(--done)]'
            : 'bg-[var(--planned)]'
          : isScheduled
            ? 'bg-[var(--surface-3)]'
            : 'bg-transparent'
        return (
          <div
            key={dateKey}
            className={`rounded-lg border p-1.5 text-center ${
              isToday ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface-2)]'
            }`}
          >
            <p className="text-[9.5px] font-bold text-[var(--text-faint)]">{weekdayLabels[i]}</p>
            <div className="mt-1 flex justify-center">
              <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PhotoSlots({ brand }: { brand: Brand }) {
  const [, setVersion] = useState(0)
  const [uploading, setUploading] = useState<string | null>(null)

  useEffect(() => {
    void syncContentPhotosFromSupabase().then(() => setVersion((v) => v + 1))
  }, [])

  const slots = getUpcomingBlogSlots(7).filter((s) => s.brand === brand)

  async function handleFiles(date: string, files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(date)
    try {
      for (const file of Array.from(files)) {
        const mediaType = mediaTypeOf(file)
        if (!mediaType) continue
        const imageBase64 = await fileToBase64(file)
        addContentPhoto({ date, brand, label: file.name, imageBase64, mediaType })
      }
      setVersion((v) => v + 1)
    } finally {
      setUploading(null)
    }
  }

  if (slots.length === 0) {
    return <p className="text-[12px] text-[var(--text-faint)]">이번 주엔 블로그 예정일이 없습니다.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {slots.map((slot) => {
        const photos = getContentPhotos(slot.date, brand)
        return (
          <div key={slot.date} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] font-bold text-[var(--text)]">{formatDateLabel(slot.date)}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  photos.length > 0 ? 'bg-[var(--done-soft)] text-[var(--done)]' : 'bg-[var(--open-soft)] text-[var(--open)]'
                }`}
              >
                {photos.length > 0 ? `${photos.length}장` : '사진 필요'}
              </span>
            </div>
            {photos.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {photos.map((p) => (
                  <div key={p.id} className="group relative h-11 w-11 overflow-hidden rounded border border-[var(--border)]">
                    <img src={`data:${p.mediaType};base64,${p.imageBase64}`} alt={p.label} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => {
                        deleteContentPhoto(p.id)
                        setVersion((v) => v + 1)
                      }}
                      className="absolute inset-0 flex items-center justify-center bg-black/50 text-[9px] font-bold text-white opacity-0 transition group-hover:opacity-100"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[10.5px] font-bold text-[var(--text-dim)] hover:opacity-90">
              {uploading === slot.date ? '업로드 중...' : '📷 사진 추가'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(slot.date, e.target.files)}
              />
            </label>
          </div>
        )
      })}
    </div>
  )
}

function ContentCard({
  entry,
  onToggleChecklist,
  onDelete,
}: {
  entry: CalendarEntry
  onToggleChecklist: (key: ChecklistStageKey) => void
  onDelete: () => void
}) {
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
        <span className="flex items-center gap-1 text-[11px] font-bold text-[var(--text-dim)]">📅 {formatDateLabel(entry.date)}</span>
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 text-left">
        <p className="text-[13.5px] font-bold leading-snug text-[var(--text)]">{entry.title}</p>
        {!open && preview && <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-[var(--text-dim)]">{preview}</p>}
      </button>
      {entry.checklist && entry.checklist.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.checklist.map((stage) => (
            <button
              key={stage.key}
              type="button"
              onClick={() => onToggleChecklist(stage.key)}
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold transition ${
                stage.done
                  ? 'bg-[var(--done-soft)] text-[var(--done)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-faint)]'
              }`}
            >
              {stage.done ? '✓ ' : ''}
              {CHECKLIST_STAGE_LABEL[stage.key]}
            </button>
          ))}
        </div>
      )}
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
            className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-dim)] hover:opacity-90"
          >
            {copied ? '복사됨 ✓' : '복사'}
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-strong)] hover:opacity-90"
          >
            {open ? '접기' : '열기'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('이 글을 삭제할까요? 되돌릴 수 없습니다.')) onDelete()
            }}
            className="rounded-lg bg-[var(--open-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--open)] hover:opacity-90"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}

function ManualEntryForm({
  brand,
  channel,
  onAdded,
}: {
  brand: Brand
  channel: WorkspaceChannel
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => kstDateKey(kstNow()))
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')

  function handleAdd() {
    if (title.trim().length === 0) return
    createEntry({ date, brand, channel: channel as CalendarChannel, title: title.trim(), note: note.trim() })
    setTitle('')
    setNote('')
    onAdded()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11.5px] font-bold text-[var(--accent)] hover:underline"
      >
        + 직접 일정 추가
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="일정 제목"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="메모 (선택)"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleAdd}
          disabled={title.trim().length === 0}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          추가
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg bg-[var(--surface)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--text-dim)] hover:opacity-90"
        >
          취소
        </button>
      </div>
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`
  return n.toLocaleString('ko-KR')
}

// 레이더 크론이 매일 YouTube Data API로 가져온 최근 영상 통계를 보여주고,
// "지금 분석 실행"으로 그 실제 데이터를 기반으로 시청자 관점 피드백(잘 터진
// 영상의 핵심, 안 터진 영상의 문제점)을 즉시 받을 수 있다 — 팀채팅에서
// 브레인에게 시키면 웹 검색으로 엉뚱한 동명 채널을 조사하는 사고가 있어서,
// 내 채널 분석은 반드시 이 버튼(내부 데이터 기반)으로 하도록 만든 것.
function YoutubeStatsPanel({ brand }: { brand: Brand }) {
  const [stats, setStats] = useState<YoutubeVideoStatRow[] | null>(null)
  const [analysis, setAnalysis] = useState<YoutubeAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStats(null)
    setAnalysis(null)
    setAnalysisError(null)
    void fetchYoutubeVideoStats(brand).then((rows) => {
      if (!cancelled) setStats(rows)
    })
    return () => {
      cancelled = true
    }
  }, [brand])

  async function handleAnalyze() {
    if (!stats || stats.length === 0 || analyzing) return
    if (isOverDailyBudget()) {
      setAnalysisError('오늘 예산 한도를 초과해서 중단했습니다. 내일 다시 시도해주세요.')
      return
    }
    setAnalyzing(true)
    setAnalysisError(null)
    const logId = startWorkLog({
      agent: 'remix',
      brand,
      kind: '유튜브 콘텐츠 분석(수동)',
      note: `최근 영상 ${stats.length}개 분석`,
    })
    try {
      const result = await analyzeYoutubeContent({
        apiKey: 'server-managed',
        brandContext: BRAND_CONTEXT[brand],
        stats,
      })
      setAnalysis(result)
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        note: result.summary,
        detailHtml: `<b>${result.summary}</b><br/><br/><b>분석</b><br/>${result.findings
          .map((f) => `- ${f}`)
          .join('<br/>')}<br/><br/><b>다음 기획 추천</b><br/>${result.nextSteps.map((n) => `- ${n}`).join('<br/>')}`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setAnalysisError(message)
      finishWorkLog(logId, { status: 'error', statusLabel: '오류', note: '분석 실패', detailHtml: message })
    } finally {
      setAnalyzing(false)
    }
  }

  if (stats === null) {
    return <p className="text-[12px] text-[var(--text-faint)]">불러오는 중…</p>
  }
  if (stats.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-faint)]">
        아직 데이터가 없습니다 — 유튜브 API 연동(YOUTUBE_API_KEY, 채널 ID) 후 매일 새벽 레이더 크론이 자동으로 채웁니다.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={analyzing}
        onClick={() => void handleAnalyze()}
        className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-[12px] font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {analyzing ? '분석 중… (보통 1~2분)' : '🔍 지금 분석 실행 — 잘 터진/안 터진 영상 시청자 관점 피드백'}
      </button>
      {analysisError && <p className="text-[11.5px] text-[var(--open)]">{analysisError}</p>}
      {analysis && (
        <div className="space-y-1.5 rounded-lg border-[1.5px] border-[var(--accent)] bg-[var(--accent-soft)] p-3">
          <p className="text-[12.5px] font-bold text-[var(--text)]">{analysis.summary}</p>
          <div className="text-[11.5px] leading-relaxed text-[var(--text-dim)]">
            {analysis.findings.map((f, i) => (
              <p key={i}>- {f}</p>
            ))}
          </div>
          <p className="pt-1 text-[11px] font-bold text-[var(--accent-strong)]">다음 기획 추천</p>
          <div className="text-[11.5px] leading-relaxed text-[var(--text-dim)]">
            {analysis.nextSteps.map((n, i) => (
              <p key={i}>- {n}</p>
            ))}
          </div>
          <p className="pt-1 text-[10.5px] text-[var(--text-faint)]">팀채팅에도 전략 카드로 저장됐습니다.</p>
        </div>
      )}
      {stats.map((v) => (
        <div key={v.videoId} className="flex items-center gap-2.5 rounded-lg bg-[var(--surface-2)] p-2">
          {v.thumbnailUrl && (
            <img src={v.thumbnailUrl} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold text-[var(--text)]">{v.title}</p>
            <p className="text-[10.5px] text-[var(--text-faint)]">
              👁️ {formatCount(v.viewCount)} · 👍 {formatCount(v.likeCount)} · 💬 {formatCount(v.commentCount)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ChannelWorkspaceScreen({ brand, channel }: { brand: Brand; channel: WorkspaceChannel }) {
  const [, setVersion] = useState(0)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void syncEntriesFromSupabase().then(() => setVersion((v) => v + 1))
  }, [brand])

  const calendarChannel = channel as CalendarChannel
  const entries = getEntries(brand)
    .filter((e) => e.channel === calendarChannel && (e.contentHtml || e.note))
    .sort((a, b) => b.date.localeCompare(a.date))
  const filtered = entries.filter((e) => {
    if (query.trim().length === 0) return true
    const q = query.trim().toLowerCase()
    return e.title.toLowerCase().includes(q) || (e.contentHtml ?? '').toLowerCase().includes(q)
  })

  const Composer = channel === 'blog' ? BlogComposer : channel === 'thread' ? ThreadComposer : RemixComposer

  return (
    <div>
      <PreviewBanner
        message={`${CHANNEL_LABEL[channel]} 관련 작업(일정·사진·직접 작성·완성글·성과 분석)을 이 탭 하나에서 전부 합니다.`}
      />

      <div className="space-y-4">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-2.5 text-[13px] font-bold text-[var(--text)]">📅 이번 주 일정</p>
          <WeekStrip brand={brand} channel={channel} />
          <div className="mt-3">
            <ManualEntryForm brand={brand} channel={channel} onAdded={() => setVersion((v) => v + 1)} />
          </div>
        </section>

        {channel === 'blog' && (
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-2.5 text-[13px] font-bold text-[var(--text)]">📸 사진 업로드</p>
            <PhotoSlots brand={brand} />
          </section>
        )}

        <Accordion title="✍️ 새 글 직접 만들기">
          <div className="-m-4">
            <Composer brand={brand} />
          </div>
        </Accordion>

        <section>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-bold text-[var(--text)]">
              🗂️ 완성된 글 모아보기 <span className="text-[11px] font-normal text-[var(--text-faint)]">{CHANNEL_AGENT_LABEL[channel]} · {entries.length}건</span>
            </p>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔍 제목이나 내용으로 찾기"
              className="w-full max-w-[200px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-faint)]">
              아직 완성된 콘텐츠가 없습니다.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((entry) => (
                <ContentCard
                  key={entry.id}
                  entry={entry}
                  onToggleChecklist={(key) => {
                    toggleChecklistStage(entry.id, key)
                    setVersion((v) => v + 1)
                  }}
                  onDelete={() => {
                    deleteEntry(entry.id)
                    setVersion((v) => v + 1)
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-3 text-[13px] font-bold text-[var(--text)]">🔍 성과 분석</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Accordion title="레퍼런스 분석" status="경쟁사·트렌드 리서치">
              <div className="-m-4">
                <BrainPanel brand={brand} />
              </div>
            </Accordion>
            {channel === 'blog' ? (
              <Accordion title="내 콘텐츠 분석" status="스크린샷 분석 + 방문자 통계">
                <div className="-m-4">
                  <CoachPanel brand={brand} />
                </div>
              </Accordion>
            ) : channel === 'youtube' ? (
              <Accordion title="내 콘텐츠 분석" status="조회수·좋아요·댓글 (매일 자동 수집)">
                <YoutubeStatsPanel brand={brand} />
              </Accordion>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-faint)]">
                내 콘텐츠 분석은 메타(스레드) API 연동 후 여기에 추가될 예정입니다.
                지금은 게시물 단위 조회수·반응 데이터를 가져올 방법이 없어서 비워둡니다.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

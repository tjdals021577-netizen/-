import { useEffect, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import {
  getEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  importTodayFromWorkLog,
  syncEntriesFromSupabase,
  toggleChecklistStage,
} from '../../lib/calendarStore'
import type { CalendarChannel, CalendarEntry, CalendarStatus, ChecklistStageKey } from '../../types/calendar'
import { CHECKLIST_STAGE_LABEL } from '../../types/calendar'
import type { Brand } from '../../types/brand'

const CHANNEL_LABEL: Record<CalendarChannel, string> = {
  blog: '블로그',
  thread: '스레드',
  youtube: '유튜브',
  agency: '대행',
  etc: '기타',
}

const STATUS_LABEL: Record<CalendarStatus, string> = {
  planned: '예정',
  done: '완료',
  open: '이슈',
}

const STATUS_CHIP: Record<CalendarStatus, string> = {
  planned: 'bg-[var(--planned-soft)] text-[var(--planned)]',
  done: 'bg-[var(--done-soft)] text-[var(--done)]',
  open: 'bg-[var(--open-soft)] text-[var(--open)]',
}

const STATUS_CYCLE: Record<CalendarStatus, CalendarStatus> = {
  planned: 'done',
  done: 'open',
  open: 'planned',
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`
}

function todayKey(): string {
  const t = new Date()
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate())
}

function ChecklistRow({
  entry,
  onToggle,
}: {
  entry: CalendarEntry
  onToggle: (key: ChecklistStageKey) => void
}) {
  if (!entry.checklist || entry.checklist.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {entry.checklist.map((stage) => (
        <button
          key={stage.key}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(stage.key)
          }}
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold transition ${
            stage.done
              ? 'bg-[var(--done-soft)] text-[var(--done)]'
              : 'bg-[var(--surface)] text-[var(--text-faint)]'
          }`}
        >
          {stage.done ? '✓ ' : ''}
          {CHECKLIST_STAGE_LABEL[stage.key]}
        </button>
      ))}
    </div>
  )
}

function CalendarEntryRow({
  entry,
  onCycleStatus,
  onDelete,
  onToggleChecklist,
}: {
  entry: CalendarEntry
  onCycleStatus: () => void
  onDelete: () => void
  onToggleChecklist: (key: ChecklistStageKey) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-faint)]">
          {CHANNEL_LABEL[entry.channel]}
        </span>
        <button
          type="button"
          onClick={onCycleStatus}
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_CHIP[entry.status]}`}
        >
          {STATUS_LABEL[entry.status]}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="block w-full text-left"
      >
        <p className="text-[13px] font-semibold text-[var(--text)]">
          <span className={`mr-1 inline-block transition-transform ${open ? 'rotate-90' : ''} text-[var(--text-faint)]`}>▸</span>
          {entry.title}
        </p>
        {entry.note && (
          <p className="mt-0.5 pl-3 text-[11.5px] text-[var(--text-dim)]">{entry.note}</p>
        )}
      </button>
      <ChecklistRow entry={entry} onToggle={onToggleChecklist} />
      {open && (
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
          {entry.contentHtml ? (
            <div dangerouslySetInnerHTML={{ __html: entry.contentHtml }} />
          ) : (
            <span className="text-[var(--text-faint)]">상세 내용이 없습니다.</span>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="mt-1.5 text-[11px] text-[var(--open)] hover:underline"
      >
        삭제
      </button>
    </li>
  )
}

export function CalendarScreen({ brand }: { brand: Brand }) {
  const today = new Date()
  const [cursorYear, setCursorYear] = useState(today.getFullYear())
  const [cursorMonth, setCursorMonth] = useState(today.getMonth()) // 0-based
  const [selectedDate, setSelectedDate] = useState(todayKey())
  const [version, setVersion] = useState(0)

  const [title, setTitle] = useState('')
  const [channel, setChannel] = useState<CalendarChannel>('blog')
  const [note, setNote] = useState('')

  const entries = getEntries(brand)
  void version // 저장소 변경 후 재조회 트리거용

  // 캘린더 화면을 열 때마다 근무기록에서 아직 등록 안 된 오늘 완료분을
  // 자동으로 가져오고, 서버 크론(content-schedule)이 만든 항목도 끌어온다 —
  // 버튼을 안 눌러도 항상 최신 상태로 보인다.
  useEffect(() => {
    importTodayFromWorkLog(brand)
    setVersion((v) => v + 1)
    void syncEntriesFromSupabase().then(() => setVersion((v) => v + 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand])

  const entriesByDate = new Map<string, typeof entries>()
  for (const e of entries) {
    const list = entriesByDate.get(e.date) ?? []
    list.push(e)
    entriesByDate.set(e.date, list)
  }

  const firstWeekday = new Date(cursorYear, cursorMonth, 1).getDay()
  const daysInMonth = new Date(cursorYear, cursorMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  function goPrevMonth() {
    if (cursorMonth === 0) {
      setCursorYear((y) => y - 1)
      setCursorMonth(11)
    } else {
      setCursorMonth((m) => m - 1)
    }
  }
  function goNextMonth() {
    if (cursorMonth === 11) {
      setCursorYear((y) => y + 1)
      setCursorMonth(0)
    } else {
      setCursorMonth((m) => m + 1)
    }
  }

  function handleRefresh() {
    importTodayFromWorkLog(brand)
    setVersion((v) => v + 1)
  }

  function handleAdd() {
    if (title.trim().length === 0) return
    createEntry({ date: selectedDate, brand, channel, title: title.trim(), note: note.trim() })
    setTitle('')
    setNote('')
    setVersion((v) => v + 1)
  }

  function handleCycleStatus(id: string, current: CalendarStatus) {
    updateEntry(id, { status: STATUS_CYCLE[current] })
    setVersion((v) => v + 1)
  }

  function handleDelete(id: string) {
    deleteEntry(id)
    setVersion((v) => v + 1)
  }

  function handleToggleChecklist(id: string, key: ChecklistStageKey) {
    toggleChecklistStage(id, key)
    setVersion((v) => v + 1)
  }

  const selectedEntries = entriesByDate.get(selectedDate) ?? []

  return (
    <div>
      <PreviewBanner message="라이터·버즈·리믹서가 콘텐츠를 만들면 자동으로 오늘 날짜에 등록됩니다. 일정을 클릭하면 전체 내용을 볼 수 있어요. 자동 매일 08:05 갱신(스케줄러 없이도 날짜가 바뀔 때 실행)은 Phase 4 이후 지원됩니다." />

      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded-lg bg-[var(--surface-2)] px-3.5 py-2 text-[12.5px] font-bold text-[var(--text-dim)] transition hover:opacity-90"
        >
          새로고침
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={goPrevMonth}
              className="rounded-lg px-2.5 py-1 text-sm text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
            >
              ◂
            </button>
            <p className="text-sm font-bold text-[var(--text)]">
              {cursorYear}년 {cursorMonth + 1}월
            </p>
            <button
              type="button"
              onClick={goNextMonth}
              className="rounded-lg px-2.5 py-1 text-sm text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
            >
              ▸
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold text-[var(--text-faint)]">
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} />
              const key = dateKey(cursorYear, cursorMonth, day)
              const dayEntries = entriesByDate.get(key) ?? []
              const isSelected = key === selectedDate
              const isToday = key === todayKey()
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(key)}
                  className={`flex min-h-[58px] flex-col items-start rounded-lg border p-1.5 text-left ${
                    isSelected
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-transparent hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <span
                    className={`text-[11.5px] ${
                      isToday ? 'font-bold text-[var(--accent)]' : 'text-[var(--text-dim)]'
                    }`}
                  >
                    {day}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-0.5">
                    {dayEntries.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        className={`h-1.5 w-1.5 rounded-full ${
                          e.status === 'done'
                            ? 'bg-[var(--done)]'
                            : e.status === 'open'
                              ? 'bg-[var(--open)]'
                              : 'bg-[var(--planned)]'
                        }`}
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-3 text-sm font-bold text-[var(--text)]">{selectedDate}</p>

          {selectedEntries.length === 0 ? (
            <p className="mb-3 text-xs text-[var(--text-faint)]">이 날짜엔 일정이 없습니다.</p>
          ) : (
            <ul className="mb-3 space-y-2">
              {selectedEntries.map((e) => (
                <CalendarEntryRow
                  key={e.id}
                  entry={e}
                  onCycleStatus={() => handleCycleStatus(e.id, e.status)}
                  onDelete={() => handleDelete(e.id)}
                  onToggleChecklist={(key) => handleToggleChecklist(e.id, key)}
                />
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="일정 제목"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as CalendarChannel)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] focus:outline-none"
            >
              {(Object.keys(CHANNEL_LABEL) as CalendarChannel[]).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="메모 (선택)"
              rows={2}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={title.trim().length === 0}
              className="w-full rounded-lg bg-[var(--accent)] py-1.5 text-[12.5px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              이 날짜에 일정 추가
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

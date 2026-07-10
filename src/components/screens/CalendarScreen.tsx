import { useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import {
  getEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  importTodayFromWorkLog,
} from '../../lib/calendarStore'
import type { CalendarChannel, CalendarStatus } from '../../types/calendar'

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

export function CalendarScreen() {
  const today = new Date()
  const [cursorYear, setCursorYear] = useState(today.getFullYear())
  const [cursorMonth, setCursorMonth] = useState(today.getMonth()) // 0-based
  const [selectedDate, setSelectedDate] = useState(todayKey())
  const [version, setVersion] = useState(0)
  const [importMessage, setImportMessage] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [channel, setChannel] = useState<CalendarChannel>('blog')
  const [note, setNote] = useState('')

  const entries = getEntries()
  void version // 저장소 변경 후 재조회 트리거용

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

  function handleImport() {
    const count = importTodayFromWorkLog()
    setImportMessage(
      count > 0
        ? `오늘 완료된 콘텐츠 ${count}건을 캘린더에 등록했습니다.`
        : '새로 등록할 완료 콘텐츠가 없습니다.',
    )
    setVersion((v) => v + 1)
  }

  function handleAdd() {
    if (title.trim().length === 0) return
    createEntry({ date: selectedDate, channel, title: title.trim(), note: note.trim() })
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

  const selectedEntries = entriesByDate.get(selectedDate) ?? []

  return (
    <div>
      <PreviewBanner message="자동 매일 08:05 갱신은 스케줄러(Phase 4) 연동 후 지원됩니다. 지금은 직접 일정을 추가하거나, 아래 버튼으로 오늘 완료된 콘텐츠를 근무기록에서 가져올 수 있습니다." />

      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => void handleImport()}
          className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90"
        >
          근무기록에서 가져오기
        </button>
        {importMessage && (
          <p className="text-[11.5px] text-[var(--text-dim)]">{importMessage}</p>
        )}
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
                <li
                  key={e.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-faint)]">
                      {CHANNEL_LABEL[e.channel]}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCycleStatus(e.id, e.status)}
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_CHIP[e.status]}`}
                    >
                      {STATUS_LABEL[e.status]}
                    </button>
                  </div>
                  <p className="text-[13px] font-semibold text-[var(--text)]">{e.title}</p>
                  {e.note && (
                    <p className="mt-0.5 text-[11.5px] text-[var(--text-dim)]">{e.note}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(e.id)}
                    className="mt-1.5 text-[11px] text-[var(--open)] hover:underline"
                  >
                    삭제
                  </button>
                </li>
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

import { useEffect, useState } from 'react'
import { DAILY_BUDGET_USD, getTodaySpendUsd } from '../../lib/budgetGuard'
import { getWorkLog } from '../../lib/workLog'
import { fetchLatestRadarSnapshot, type RadarSnapshot } from '../../lib/radarStore'
import { getEntries, syncEntriesFromSupabase } from '../../lib/calendarStore'
import type { CalendarChannel } from '../../types/calendar'
import { MorningPanel } from '../MorningPanel'
import { PreviewBanner } from './PreviewBanner'
import { BRANDS, type Brand } from '../../types/brand'

function todaySpendForBrand(brand: Brand): number {
  const today = new Date().toISOString().slice(0, 10)
  return getWorkLog(undefined, brand)
    .filter((e) => e.startedAt.slice(0, 10) === today && e.costUsd !== undefined)
    .reduce((sum, e) => sum + (e.costUsd ?? 0), 0)
}

// blog.naver.com/멘토아이디/글번호 형태의 리퍼러에서 "누구의 블로그인지"
// (아이디)를 뽑아 읽기 쉽게 보여준다 — 형태가 예상과 다르면 원본 그대로.
function formatBlogReferrer(referrer: string): string {
  const match = referrer.match(/blog\.naver\.com\/([^/?#]+)(?:\/(\d+))?/i)
  if (!match) return referrer
  const blogId = match[1]
  return match[2] ? `${blogId}의 블로그 (글 ${match[2]})` : `${blogId}의 블로그`
}

function BrandSection({ brand, refreshKey }: { brand: Brand; refreshKey: number }) {
  const spend = todaySpendForBrand(brand)
  const [radar, setRadar] = useState<RadarSnapshot | null>(null)
  const [imweb, setImweb] = useState<RadarSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchLatestRadarSnapshot(brand, 'ga4').then((snap) => {
      if (!cancelled) setRadar(snap)
    })
    fetchLatestRadarSnapshot(brand, 'imweb').then((snap) => {
      if (!cancelled) setImweb(snap)
    })
    return () => {
      cancelled = true
    }
  }, [brand, refreshKey])

  const topSource = radar?.trafficSources[0]
  const topPage = radar?.topPages[0]
  const stats = [
    {
      label: `${radar?.periodLabel ?? '어제'} 방문자`,
      value: radar ? `${radar.activeUsers}명` : '—',
    },
    {
      label: '1위 유입경로',
      value: topSource ? `${topSource.source} (${topSource.sessions.toLocaleString('ko-KR')}명)` : '—',
    },
    { label: '인기 페이지', value: topPage ? topPage.path : '—' },
    {
      label: `${imweb?.periodLabel ?? '어제'} 주문`,
      value: imweb ? `${imweb.orderCount ?? 0}건` : '—',
    },
    {
      label: `${imweb?.periodLabel ?? '이번 달'} 매출(아임웹)`,
      value: imweb?.revenueKrw != null ? `${imweb.revenueKrw.toLocaleString('ko-KR')}원` : '—',
    },
    { label: '오늘 사용액(추정)', value: `$${spend.toFixed(3)}` },
  ]

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="mb-3 text-sm font-bold text-[var(--text)]">{brand}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 rounded-lg bg-[var(--surface-2)] p-3">
            <p className="break-words text-[15px] font-bold leading-snug text-[var(--text)]">{s.value}</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">{s.label}</p>
          </div>
        ))}
      </div>

      {radar && radar.naverLandingPages.length > 0 && (
        <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3">
          <p className="mb-2 text-[11px] font-bold text-[var(--text-faint)]">
            네이버 검색 → 착지 페이지 (브랜드명 검색은 보통 홈 "/", 블로그 글 검색은 그 글 주소로 착지)
          </p>
          <div className="space-y-1">
            {radar.naverLandingPages.map((p) => (
              <div key={p.landingPage} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate text-[var(--text-dim)]">{p.landingPage || '/'}</span>
                <span className="shrink-0 font-bold text-[var(--text)]">{p.sessions.toLocaleString('ko-KR')}명</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {radar && radar.blogReferrers.length > 0 && (
        <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3">
          <p className="mb-2 text-[11px] font-bold text-[var(--text-faint)]">
            어느 네이버 블로그에서 왔는지 (앱에서 열면 안 잡힐 수 있어 잡힌 만큼만 표시)
          </p>
          <div className="space-y-1">
            {radar.blogReferrers.map((r) => (
              <div key={r.referrer} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate text-[var(--text-dim)]" title={r.referrer}>
                  {formatBlogReferrer(r.referrer)}
                </span>
                <span className="shrink-0 font-bold text-[var(--text)]">{r.views.toLocaleString('ko-KR')}회</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const CHANNEL_DOT_VAR: Record<CalendarChannel, string> = {
  blog: 'var(--accent)',
  thread: 'var(--ch-thread)',
  youtube: 'var(--ch-yt)',
  agency: 'var(--text-faint)',
  etc: 'var(--text-faint)',
}

const CHANNEL_LEGEND_LABEL: Record<'blog' | 'thread' | 'youtube', string> = {
  blog: '블로그',
  thread: '스레드',
  youtube: '유튜브',
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

// 채널 탭에서 지금까지 하나씩 보던 걸 여기선 전체 브랜드·전체 채널을 색깔
// 점으로 한눈에 보여준다 — 캘린더 화면(전체 월간 보기)이 없어지면서
// "이번 달 전체 일정"을 볼 수 있는 유일한 자리라 여기 남겨둠.
function MiniMonthCalendar() {
  const today = new Date()
  const [cursorYear, setCursorYear] = useState(today.getFullYear())
  const [cursorMonth, setCursorMonth] = useState(today.getMonth())
  const [, setVersion] = useState(0)

  useEffect(() => {
    void syncEntriesFromSupabase().then(() => setVersion((v) => v + 1))
  }, [])

  const entries = getEntries()
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

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <button type="button" onClick={goPrevMonth} className="rounded-lg px-2 py-1 text-sm text-[var(--text-dim)] hover:bg-[var(--surface-2)]">
          ◂
        </button>
        <p className="text-[12.5px] font-bold text-[var(--text)]">{cursorYear}년 {cursorMonth + 1}월</p>
        <button type="button" onClick={goNextMonth} className="rounded-lg px-2 py-1 text-sm text-[var(--text-dim)] hover:bg-[var(--surface-2)]">
          ▸
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[9.5px] font-bold text-[var(--text-faint)]">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
          <div key={d} className="pb-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />
          const key = dateKey(cursorYear, cursorMonth, day)
          const dayEntries = entriesByDate.get(key) ?? []
          const isToday = key === todayKey()
          return (
            <div
              key={key}
              className={`rounded-md p-1 text-center ${isToday ? 'border border-[var(--accent)] bg-[var(--accent-soft)]' : 'bg-[var(--surface-2)]'}`}
            >
              <p className="text-[9.5px] text-[var(--text-dim)]">{day}</p>
              <div className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                {dayEntries.slice(0, 4).map((e) => (
                  <span
                    key={e.id}
                    className="h-1 w-1 rounded-full"
                    style={{ background: CHANNEL_DOT_VAR[e.channel] }}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2.5 text-[9.5px] text-[var(--text-faint)]">
        {(Object.keys(CHANNEL_LEGEND_LABEL) as (keyof typeof CHANNEL_LEGEND_LABEL)[]).map((ch) => (
          <span key={ch} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHANNEL_DOT_VAR[ch] }} />
            {CHANNEL_LEGEND_LABEL[ch]}
          </span>
        ))}
      </div>
    </div>
  )
}

function MorningAccordion({ brand }: { brand: Brand }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[13px] font-bold text-[var(--text)]">☀️ {brand} — 모닝 브리핑</span>
        <span className="text-[10px] text-[var(--text-faint)]">{open ? '▲ 접기' : '▼ 펼치기'}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] p-4">
          <MorningPanel brand={brand} />
        </div>
      )}
    </div>
  )
}

export function DashboardScreen() {
  const todaySpendTotal = getTodaySpendUsd()
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [refreshSamples, setRefreshSamples] = useState<string[]>([])

  async function refreshRevenue() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMsg(null)
    setRefreshSamples([])
    try {
      const password = import.meta.env.VITE_APP_PASSWORD
      const res = await fetch('/api/radar-refresh', {
        method: 'POST',
        headers: password ? { 'X-App-Password': password } : {},
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `서버 오류 (${res.status})`)
      setRefreshKey((k) => k + 1)
      setRefreshMsg(Array.isArray(data?.results) ? data.results.join(' · ') : '새로고침 완료')
      setRefreshSamples(Array.isArray(data?.samples) ? data.samples : [])
    } catch (err) {
      setRefreshMsg(`실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div>
      <PreviewBanner message="레이더가 연결된 브랜드는 매일 아침 실제 방문자·유입경로(GA4)·주문·매출(아임웹) 숫자가 채워집니다. 매출은 '이번 달 누적(오늘 포함)'이고, 아래 버튼으로 지금 바로 새로고침할 수 있습니다." />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text)]">통합 대시보드</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshRevenue()}
            disabled={refreshing}
            className="rounded-lg border border-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {refreshing ? '매출 불러오는 중…' : '🔄 지금 매출 새로고침'}
          </button>
          <p className="text-[11px] text-[var(--text-faint)]">
            오늘 API 사용액(전체) ${todaySpendTotal.toFixed(3)} / ${DAILY_BUDGET_USD}
          </p>
        </div>
      </div>
      {refreshMsg && (
        <p className="mb-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-[11px] text-[var(--text-dim)]">{refreshMsg}</p>
      )}
      {refreshSamples.length > 0 && (
        <details className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-[var(--accent)]">🔎 진단용 원본 데이터 (금액이 이상하면 이 내용을 개발자에게 전달)</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10.5px] leading-relaxed text-[var(--text-dim)]">{refreshSamples.join('\n\n')}</pre>
        </details>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <MiniMonthCalendar />
        <div className="space-y-2">
          {BRANDS.map((b) => (
            <MorningAccordion key={b} brand={b} />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {BRANDS.map((b) => (
          <BrandSection key={b} brand={b} refreshKey={refreshKey} />
        ))}
      </div>
    </div>
  )
}

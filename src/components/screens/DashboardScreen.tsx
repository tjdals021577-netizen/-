import { useEffect, useState } from 'react'
import { DAILY_BUDGET_USD, getTodaySpendUsd } from '../../lib/budgetGuard'
import { getWorkLog } from '../../lib/workLog'
import {
  fetchLatestRadarSnapshot,
  fetchRecentRadarSnapshots,
  dedupeByDay,
  type RadarSnapshot,
} from '../../lib/radarStore'
import { getEntries, syncEntriesFromSupabase } from '../../lib/calendarStore'
import type { CalendarChannel } from '../../types/calendar'
import { MorningPanel } from '../MorningPanel'
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

// 증감 칩 — 증가=녹색 ▲, 감소=빨강 ▼, 변동 없음/데이터 없음은 회색. 색만이 아니라
// 화살표+숫자로도 구분해서 색맹에도 읽히게 한다.
function DeltaChip({ delta, suffix }: { delta: number | null; suffix?: string }) {
  if (delta === null) {
    return <span className="text-[11px] text-[var(--text-faint)]">비교할 어제 데이터 없음</span>
  }
  const color = delta > 0 ? 'var(--up)' : delta < 0 ? 'var(--down)' : 'var(--text-faint)'
  const mark = delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : '→ 0'
  return (
    <span className="text-[12.5px] font-bold" style={{ color }}>
      {mark}
      {suffix ? <span className="ml-1 text-[10.5px] font-normal text-[var(--text-faint)]">{suffix}</span> : null}
    </span>
  )
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-[var(--text-faint)]">{label}</p>
      <p className="mt-0.5 text-[var(--fs-xl)] font-extrabold leading-none text-[var(--text)]" style={{ fontSize: 'var(--fs-xl)' }}>
        {value}
      </p>
    </div>
  )
}

interface HeroData {
  visitorsToday: number
  visitorsDelta: number | null
  revenue: number | null
  orders: number
}

// 히어로 요약 바 — 두 브랜드 합산 핵심 숫자를 가로로. 어제 방문자를 가장 크게,
// 그 옆에 어제 대비 증감. 나머지(이번 달 매출·주문·오늘 API)는 보조 스탯.
// 데이터는 기존 radarStore 리더만 읽는다(수집/ API 로직 미변경).
function HeroSummary({
  refreshKey,
  refreshing,
  onRefresh,
  refreshMsg,
  apiSpend,
}: {
  refreshKey: number
  refreshing: boolean
  onRefresh: () => void
  refreshMsg: string | null
  apiSpend: number
}) {
  const [data, setData] = useState<HeroData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let vToday = 0
      let vPrev = 0
      let prevKnown = true
      let revenue = 0
      let revKnown = false
      let orders = 0
      for (const b of BRANDS) {
        const [ga4list, imweb] = await Promise.all([
          fetchRecentRadarSnapshots(b, 'ga4', 8),
          fetchLatestRadarSnapshot(b, 'imweb'),
        ])
        const days = dedupeByDay(ga4list)
        vToday += days[0]?.activeUsers ?? 0
        if (days[1]) vPrev += days[1].activeUsers
        else prevKnown = false
        if (imweb?.revenueKrw != null) {
          revenue += imweb.revenueKrw
          revKnown = true
        }
        orders += imweb?.orderCount ?? 0
      }
      if (!cancelled) {
        setData({
          visitorsToday: vToday,
          visitorsDelta: prevKnown ? vToday - vPrev : null,
          revenue: revKnown ? revenue : null,
          orders,
        })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const revenueText =
    data?.revenue != null ? `${data.revenue.toLocaleString('ko-KR')}원` : '—'

  return (
    <section className="card p-5">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-bold text-[var(--text-faint)]">오늘 아침 요약 · 업메리 + 마잘남 합산</p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg border border-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {refreshing ? '매출 불러오는 중…' : '🔄 지금 매출 새로고침'}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
        {/* 어제 방문자 — 화면에서 가장 큰 숫자 */}
        <div>
          <p className="text-[11px] font-bold text-[var(--text-faint)]">어제 방문자 (합산)</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className="leading-none text-[var(--text)]"
              style={{ fontSize: 'var(--fs-hero)', fontWeight: 'var(--fw-hero)', letterSpacing: 'var(--tracking-hero)' }}
            >
              {data ? data.visitorsToday.toLocaleString('ko-KR') : '—'}
            </span>
            <span className="text-[15px] font-bold text-[var(--text-dim)]">명</span>
            {data && <DeltaChip delta={data.visitorsDelta} suffix="어제보다" />}
          </div>
        </div>

        <HeroStat label="이번 달 매출" value={revenueText} />
        <HeroStat label="이번 달 주문" value={data ? `${data.orders}건` : '—'} />
        <HeroStat label="오늘 API 사용액" value={`$${apiSpend.toFixed(3)}`} />
      </div>

      {refreshMsg && (
        <p className="mt-3 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-[11px] text-[var(--text-dim)]">{refreshMsg}</p>
      )}
    </section>
  )
}

export function DashboardScreen() {
  const todaySpendTotal = getTodaySpendUsd()
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)

  async function refreshRevenue() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMsg(null)
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
    } catch (err) {
      setRefreshMsg(`실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 히어로 요약 바 — 3초 안에 상황 파악: 어제 방문자(가장 크게)+증감, 매출·주문·API */}
      <HeroSummary
        refreshKey={refreshKey}
        refreshing={refreshing}
        onRefresh={() => void refreshRevenue()}
        refreshMsg={refreshMsg}
        apiSpend={todaySpendTotal}
      />

      {/* 브랜드별 상세 — 세로로 쌓지 않고 좌우 2단으로 나란히(스크롤 없이 비교) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {BRANDS.map((b) => (
          <BrandSection key={b} brand={b} refreshKey={refreshKey} />
        ))}
      </div>

      {/* 달력·모닝은 시야 방해 안 하게 하단으로 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <MiniMonthCalendar />
        <div className="space-y-2">
          {BRANDS.map((b) => (
            <MorningAccordion key={b} brand={b} />
          ))}
        </div>
      </div>

      <p className="text-right text-[10.5px] text-[var(--text-faint)]">
        오늘 API 사용액(전체) ${todaySpendTotal.toFixed(3)} / ${DAILY_BUDGET_USD}
      </p>
    </div>
  )
}

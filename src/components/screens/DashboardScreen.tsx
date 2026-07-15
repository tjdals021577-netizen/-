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
  revenueDelta: number | null // 오늘 매출 - 어제 매출 (합산)
}

function kstDateStr(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
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
      let revToday = 0
      let revYest = 0
      let dailyKnown = false
      const today = kstDateStr(0)
      const yest = kstDateStr(-1)
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
        if (imweb && imweb.dailyRevenue.length > 0) {
          dailyKnown = true
          revToday += imweb.dailyRevenue.find((d) => d.date === today)?.revenue ?? 0
          revYest += imweb.dailyRevenue.find((d) => d.date === yest)?.revenue ?? 0
        }
      }
      if (!cancelled) {
        setData({
          visitorsToday: vToday,
          visitorsDelta: prevKnown ? vToday - vPrev : null,
          revenue: revKnown ? revenue : null,
          orders,
          revenueDelta: dailyKnown ? revToday - revYest : null,
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

        <div>
          <p className="text-[11px] font-bold text-[var(--text-faint)]">이번 달 매출</p>
          <p className="mt-0.5 font-extrabold leading-none text-[var(--text)]" style={{ fontSize: 'var(--fs-xl)' }}>
            {revenueText}
          </p>
          {data && data.revenueDelta != null && data.revenueDelta !== 0 && (
            <p className="mt-1 text-[11px] font-bold" style={{ color: data.revenueDelta > 0 ? 'var(--up)' : 'var(--down)' }}>
              {data.revenueDelta > 0 ? '▲' : '▼'} 오늘 {Math.abs(data.revenueDelta).toLocaleString('ko-KR')}원
            </p>
          )}
        </div>
        <HeroStat label="이번 달 주문" value={data ? `${data.orders}건` : '—'} />
        <HeroStat label="오늘 API 사용액" value={`$${apiSpend.toFixed(3)}`} />
      </div>

      {refreshMsg && (
        <p className="mt-3 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-[11px] text-[var(--text-dim)]">{refreshMsg}</p>
      )}
    </section>
  )
}

// GA4 스냅샷은 "어제치"를 오늘 수집한다 — 방문자의 실제 날짜 = 수집일(KST) - 1일.
function ga4VisitorDate(createdAt: string): string {
  const t = new Date(createdAt).getTime()
  if (!Number.isFinite(t)) return ''
  return new Date(t + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// 방문자 추이 area 스파크라인 — 채운 영역 + 라인 + 끝점 강조(dataviz 원칙).
function AreaSpark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) {
    return <p className="py-4 text-center text-[11px] text-[var(--text-faint)]">데이터 쌓이는 중… (며칠 지나면 그래프가 그려져요)</p>
  }
  const W = 300
  const H = 66
  const pad = 5
  const max = Math.max(1, ...values)
  const n = values.length
  const x = (i: number) => pad + (i / (n - 1)) * (W - 2 * pad)
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="방문자 추이">
      <path d={area} fill={color} opacity="0.14" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r="3.5" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// 월별 매출 막대.
function MonthlyBars({ data, color }: { data: { month: string; revenue: number }[]; color: string }) {
  if (data.length === 0) {
    return <p className="py-4 text-center text-[11px] text-[var(--text-faint)]">데이터 쌓이는 중…</p>
  }
  const max = Math.max(1, ...data.map((d) => d.revenue))
  return (
    <div className="flex items-end gap-2" style={{ height: 80 }}>
      {data.map((d) => {
        const h = Math.max(3, Math.round((d.revenue / max) * 60))
        return (
          <div key={d.month} className="flex flex-1 flex-col items-center gap-1" title={`${d.month}: ${d.revenue.toLocaleString('ko-KR')}원`}>
            <span className="text-[9px] text-[var(--text-faint)]">{d.revenue > 0 ? `${Math.round(d.revenue / 10000)}만` : '0'}</span>
            <div className="w-full rounded-t-[3px]" style={{ height: h, background: color }} />
            <span className="text-[9px] text-[var(--text-faint)]">{Number(d.month.slice(5))}월</span>
          </div>
        )
      })}
    </div>
  )
}

interface DailyRow {
  date: string
  visitors: number | null
  source: string | null
  orders: number
  revenue: number
}

// 브랜드별 "기간별 분석" — 방문자 추이 그래프 + 월별 매출 그래프 + 일자별 표.
// 방문자·유입경로는 기존 GA4 스냅샷(읽기 전용), 주문·매출은 아임웹 일별 분해에서.
function PerformanceSection({ brand, refreshKey }: { brand: Brand; refreshKey: number }) {
  const [rows, setRows] = useState<DailyRow[] | null>(null)
  const [visitorSeries, setVisitorSeries] = useState<number[]>([])
  const [monthly, setMonthly] = useState<{ month: string; revenue: number }[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [ga4list, imweb] = await Promise.all([
        fetchRecentRadarSnapshots(brand, 'ga4', 30),
        fetchLatestRadarSnapshot(brand, 'imweb'),
      ])
      const ga4days = dedupeByDay(ga4list) // desc
      const visitorByDate = new Map<string, { visitors: number; source: string | null }>()
      for (const s of ga4days) {
        const d = ga4VisitorDate(s.createdAt)
        if (d && !visitorByDate.has(d)) {
          visitorByDate.set(d, { visitors: s.activeUsers, source: s.trafficSources[0]?.source ?? null })
        }
      }
      const imwebDaily = imweb?.dailyRevenue ?? []
      const imwebByDate = new Map(imwebDaily.map((d) => [d.date, d]))

      const allDates = new Set<string>([...visitorByDate.keys(), ...imwebByDate.keys()])
      const sorted = [...allDates].sort((a, b) => b.localeCompare(a)) // desc
      const tableRows: DailyRow[] = sorted.slice(0, 10).map((date) => ({
        date,
        visitors: visitorByDate.get(date)?.visitors ?? null,
        source: visitorByDate.get(date)?.source ?? null,
        orders: imwebByDate.get(date)?.orderCount ?? 0,
        revenue: imwebByDate.get(date)?.revenue ?? 0,
      }))

      // 방문자 그래프(오름차순, 최근 14일)
      const vAsc = [...visitorByDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-14)
      // 월별 매출(오름차순, 최근 6개월)
      const byMonth = new Map<string, number>()
      for (const d of imwebDaily) {
        const m = d.date.slice(0, 7)
        byMonth.set(m, (byMonth.get(m) ?? 0) + d.revenue)
      }
      const monthlyArr = [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-6)
        .map(([month, revenue]) => ({ month, revenue }))

      if (!cancelled) {
        setRows(tableRows)
        setVisitorSeries(vAsc.map(([, v]) => v.visitors))
        setMonthly(monthlyArr)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [brand, refreshKey])

  return (
    <section className="card p-4">
      <p className="mb-3 text-[13px] font-bold text-[var(--text)]">📊 {brand} — 기간별 분석</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-[var(--surface-2)] p-3">
          <p className="mb-1.5 text-[11px] font-bold text-[var(--text-faint)]">방문자 추이 (최근 14일)</p>
          <AreaSpark values={visitorSeries} color="var(--ch-yt)" />
        </div>
        <div className="rounded-lg bg-[var(--surface-2)] p-3">
          <p className="mb-1.5 text-[11px] font-bold text-[var(--text-faint)]">월별 매출 (최근 6개월)</p>
          <MonthlyBars data={monthly} color="var(--accent)" />
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-[var(--text-faint)]">
              <th className="py-1.5 pr-3 text-left font-bold">일자</th>
              <th className="py-1.5 pr-3 text-right font-bold">주문수</th>
              <th className="py-1.5 pr-3 text-right font-bold">매출액</th>
              <th className="py-1.5 pr-3 text-right font-bold">방문자</th>
              <th className="py-1.5 text-left font-bold">유입경로</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={5} className="py-3 text-center text-[var(--text-faint)]">불러오는 중…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="py-3 text-center text-[var(--text-faint)]">데이터 쌓이는 중…</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.date} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-3 tabular-nums text-[var(--text-dim)]">{r.date.slice(5)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--text)]">{r.orders}건</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-[var(--text)]">{r.revenue.toLocaleString('ko-KR')}원</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--text)]">{r.visitors ?? '—'}</td>
                  <td className="py-1.5 truncate text-[var(--text-dim)]">{r.source ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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

      {/* 기간별 분석 — 방문자 추이·월별 매출 그래프 + 일자별 표 (브랜드별) */}
      {BRANDS.map((b) => (
        <PerformanceSection key={b} brand={b} refreshKey={refreshKey} />
      ))}

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

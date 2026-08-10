import { useEffect, useState } from 'react'
import { TeamChatScreen } from './screens/TeamChatScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { AgencyScreen } from './screens/AgencyScreen'
import { ChannelWorkspaceScreen, type WorkspaceChannel } from './screens/ChannelWorkspaceScreen'
import { ApprovalScreen } from './screens/ApprovalScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { getApprovalQueue } from '../lib/approvalStore'
import { fetchLatestRadarSnapshot, type RadarSnapshot } from '../lib/radarStore'
import { BRANDS, BRAND_CHANNELS, type Brand } from '../types/brand'

type TabId = 'team' | 'dash' | 'agency' | 'blog' | 'thread' | 'youtube' | 'approval' | 'settings'

// 탭 호버 미리보기 — 대표님 지시대로 "과하면 뺄 수 있게" 분리해서 구현.
// 이 값만 false로 두면 미리보기 드롭다운이 통째로 사라진다(탭 바는 그대로).
const SHOW_TAB_PREVIEW = true

const CHANNEL_BRAND_LABEL: Record<WorkspaceChannel, string> = {
  blog: '블로그',
  thread: '스레드',
  youtube: '유튜브',
}

const TABS: { id: TabId; label: string; channel?: WorkspaceChannel; hint: string }[] = [
  { id: 'team', label: '팀 채팅', hint: '팀원에게 일 시키고 대화 — 라이터·버즈·리믹서·브레인' },
  { id: 'dash', label: '대시보드', hint: '두 브랜드 방문자·매출 한눈에' },
  { id: 'blog', label: '블로그', channel: 'blog', hint: '이번 주 일정 · 직접 작성 · 완성글 · 성과 분석' },
  { id: 'thread', label: '스레드', channel: 'thread', hint: '스레드 글 작성 · 레퍼런스 리라이팅 · 성과' },
  { id: 'youtube', label: '유튜브', channel: 'youtube', hint: '대본 기획 · 조회수·좋아요·댓글 분석' },
  { id: 'agency', label: '대행 관리', hint: '클라이언트별 스레드 대행 — 매일 시안 3개' },
  { id: 'approval', label: '결재함', hint: 'AI가 만든 초안 검토 후 발행' },
  { id: 'settings', label: '설정', hint: '레퍼런스 이미지 · 환경 설정' },
]

interface DashPreview {
  visitors: number | null
  revenue: number | null
}

// 대시보드 탭 호버 시 보여줄 요약 — 기존 radarStore 리더만 읽는다(수집/ API 로직 미변경).
function TabPreview({
  tab,
  pendingCount,
  dash,
}: {
  tab: (typeof TABS)[number]
  pendingCount: number
  dash: Record<Brand, DashPreview>
}) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-60 origin-top rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 opacity-0 shadow-[var(--card-shadow)] transition-all duration-150 ease-out group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 motion-safe:-translate-y-1"
      role="tooltip"
    >
      <p className="text-[11.5px] leading-relaxed text-[var(--text-dim)]">{tab.hint}</p>

      {tab.id === 'dash' && (
        <div className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2">
          {BRANDS.map((b) => (
            <div key={b} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-bold text-[var(--text)]">{b}</span>
              <span className="text-[var(--text-dim)]">
                방문 {dash[b].visitors ?? '—'}명 · 매출{' '}
                {dash[b].revenue != null ? `${(dash[b].revenue / 10000).toFixed(0)}만원` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab.id === 'approval' && pendingCount > 0 && (
        <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] font-bold text-[var(--accent)]">
          결재 대기 {pendingCount}건
        </p>
      )}
    </div>
  )
}

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>('team')
  const [brand, setBrand] = useState<Brand>('마잘남')
  const [dash, setDash] = useState<Record<Brand, DashPreview>>({
    업메리: { visitors: null, revenue: null },
    마잘남: { visitors: null, revenue: null },
  })
  const pendingApprovalCount = getApprovalQueue('pending', brand).length

  const availableTabs = TABS.filter(
    (t) => !t.channel || BRAND_CHANNELS[brand].includes(CHANNEL_BRAND_LABEL[t.channel]),
  )

  // 브랜드를 바꿨는데 그 브랜드엔 없는 채널 탭을 보고 있었으면(예: 업메리로
  // 바꿨는데 스레드 탭을 보던 중) 안전한 탭으로 돌아간다.
  useEffect(() => {
    if (!availableTabs.some((t) => t.id === activeTab)) {
      setActiveTab('team')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand])

  // 탭 호버 미리보기용 요약을 한 번만 읽어둔다(읽기 전용, 실패해도 조용히 무시).
  useEffect(() => {
    if (!SHOW_TAB_PREVIEW) return
    let cancelled = false
    for (const b of BRANDS) {
      void Promise.all([
        fetchLatestRadarSnapshot(b, 'ga4'),
        fetchLatestRadarSnapshot(b, 'imweb'),
      ]).then(([ga4, imweb]: [RadarSnapshot | null, RadarSnapshot | null]) => {
        if (cancelled) return
        setDash((prev) => ({
          ...prev,
          [b]: { visitors: ga4?.activeUsers ?? null, revenue: imweb?.revenueKrw ?? null },
        }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto min-h-screen px-4 py-5" style={{ maxWidth: 'var(--content-max)' }}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
          <span className="h-5 w-5 rounded-md bg-[var(--accent)]" />
          업메리 · 마잘남 AI 운영
        </div>

        <div className="flex gap-0.5 rounded-full bg-[var(--surface-2)] p-0.5 text-xs font-semibold">
          {BRANDS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBrand(b)}
              className={`rounded-full px-3.5 py-1 transition ${
                brand === b ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-faint)] hover:text-[var(--text)]'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </header>

      {/* 풀폭 탭 바 — 본문 폭에 맞춰 꽉 차게, 활성 탭은 accent 밑줄로 확실히 구분.
          overflow는 쓰지 않는다(호버 드롭다운이 잘리므로) — 좁은 화면에선 줄바꿈. */}
      <nav className="mb-5 flex flex-wrap items-stretch gap-x-1 border-b border-[var(--border)]">
        {availableTabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <div key={tab.id} className="group relative">
              <button
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap px-3.5 pb-2.5 pt-1.5 text-[13.5px] font-semibold transition-colors ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'
                }`}
              >
                {tab.label}
                {tab.id === 'approval' && pendingApprovalCount > 0 && (
                  <span className="rounded-full bg-[var(--open)] px-1.5 text-[10px] font-bold text-white">
                    {pendingApprovalCount}
                  </span>
                )}
                <span
                  className={`absolute inset-x-1 -bottom-px h-0.5 rounded-full transition-all ${
                    active ? 'bg-[var(--accent)] opacity-100' : 'opacity-0'
                  }`}
                />
              </button>
              {SHOW_TAB_PREVIEW && (
                <TabPreview tab={tab} pendingCount={pendingApprovalCount} dash={dash} />
              )}
            </div>
          )
        })}
      </nav>

      <main>
        {activeTab === 'team' && <TeamChatScreen brand={brand} />}
        {activeTab === 'dash' && <DashboardScreen />}
        {activeTab === 'agency' && <AgencyScreen />}
        {activeTab === 'blog' && <ChannelWorkspaceScreen brand={brand} channel="blog" />}
        {activeTab === 'thread' && <ChannelWorkspaceScreen brand={brand} channel="thread" />}
        {activeTab === 'youtube' && <ChannelWorkspaceScreen brand={brand} channel="youtube" />}
        {activeTab === 'approval' && <ApprovalScreen brand={brand} />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>
    </div>
  )
}

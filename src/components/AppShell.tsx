import { useEffect, useState } from 'react'
import { TeamChatScreen } from './screens/TeamChatScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { AgencyScreen } from './screens/AgencyScreen'
import { ChannelWorkspaceScreen, type WorkspaceChannel } from './screens/ChannelWorkspaceScreen'
import { ApprovalScreen } from './screens/ApprovalScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { getApprovalQueue } from '../lib/approvalStore'
import { BRANDS, BRAND_CHANNELS, type Brand } from '../types/brand'

type TabId = 'team' | 'dash' | 'agency' | 'blog' | 'thread' | 'youtube' | 'approval' | 'settings'

const CHANNEL_BRAND_LABEL: Record<WorkspaceChannel, string> = {
  blog: '블로그',
  thread: '스레드',
  youtube: '유튜브',
}

const TABS: { id: TabId; label: string; channel?: WorkspaceChannel }[] = [
  { id: 'team', label: '팀 채팅' },
  { id: 'dash', label: '대시보드' },
  { id: 'blog', label: '블로그', channel: 'blog' },
  { id: 'thread', label: '스레드', channel: 'thread' },
  { id: 'youtube', label: '유튜브', channel: 'youtube' },
  { id: 'agency', label: '대행 관리' },
  { id: 'approval', label: '결재함' },
  { id: 'settings', label: '설정' },
]

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>('team')
  const [brand, setBrand] = useState<Brand>('마잘남')
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

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
          <span className="h-5 w-5 rounded-md bg-[var(--accent)]" />
          업메리 · 마잘남 AI 운영
        </div>

        <nav className="flex gap-1 rounded-lg bg-[var(--surface-2)] p-1">
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm'
                  : 'text-[var(--text-faint)] hover:text-[var(--text)]'
              }`}
            >
              {tab.label}
              {tab.id === 'approval' && pendingApprovalCount > 0 && (
                <span className="rounded-full bg-[var(--open)] px-1.5 text-[10px] font-bold text-white">
                  {pendingApprovalCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex gap-0.5 rounded-full bg-[var(--surface-2)] p-0.5 text-xs font-semibold">
          {BRANDS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBrand(b)}
              className={`rounded-full px-3 py-1 transition ${
                brand === b
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-faint)]'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </header>

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

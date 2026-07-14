import { useState } from 'react'
import { OpsScreen } from './screens/OpsScreen'
import { TeamChatScreen } from './screens/TeamChatScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { AgencyScreen } from './screens/AgencyScreen'
import { CalendarScreen } from './screens/CalendarScreen'
import { PlanningLibraryScreen } from './screens/PlanningLibraryScreen'
import { ApprovalScreen } from './screens/ApprovalScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { getApprovalQueue } from '../lib/approvalStore'
import { BRANDS, type Brand } from '../types/brand'

type TabId = 'ops' | 'team' | 'dash' | 'agency' | 'calendar' | 'planning' | 'approval' | 'settings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'ops', label: '운영실' },
  { id: 'team', label: '팀 채팅' },
  { id: 'dash', label: '대시보드' },
  { id: 'agency', label: '대행 관리' },
  { id: 'calendar', label: '캘린더' },
  { id: 'planning', label: '기획함' },
  { id: 'approval', label: '결재함' },
  { id: 'settings', label: '설정' },
]

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>('ops')
  const [brand, setBrand] = useState<Brand>('마잘남')
  const pendingApprovalCount = getApprovalQueue('pending', brand).length

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
          <span className="h-5 w-5 rounded-md bg-[var(--accent)]" />
          업메리 · 마잘남 AI 운영
        </div>

        <nav className="flex gap-1 rounded-lg bg-[var(--surface-2)] p-1">
          {TABS.map((tab) => (
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
        {activeTab === 'ops' && <OpsScreen brand={brand} />}
        {activeTab === 'team' && <TeamChatScreen brand={brand} />}
        {activeTab === 'dash' && <DashboardScreen />}
        {activeTab === 'agency' && <AgencyScreen />}
        {activeTab === 'calendar' && <CalendarScreen brand={brand} />}
        {activeTab === 'planning' && <PlanningLibraryScreen brand={brand} />}
        {activeTab === 'approval' && <ApprovalScreen brand={brand} />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>
    </div>
  )
}

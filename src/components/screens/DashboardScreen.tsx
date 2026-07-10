import { useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { DAILY_BUDGET_USD, getTodaySpendUsd } from '../../lib/budgetGuard'
import { CoachPanel } from '../CoachPanel'
import { MorningPanel } from '../MorningPanel'

export function DashboardScreen() {
  const [todaySpend] = useState(() => getTodaySpendUsd())

  const stats = [
    { label: '어제 방문자', value: '—' },
    { label: '1위 유입경로', value: '—' },
    { label: '결제 전환', value: '—' },
    { label: '오늘 API 사용액', value: `$${todaySpend.toFixed(3)} / $${DAILY_BUDGET_USD}` },
  ]

  return (
    <div>
      <PreviewBanner message="방문자·유입경로·결제 전환은 Phase 4에서 GA4·아임웹 연동 후 실제 숫자로 채워집니다. API 사용액만 지금도 실제 값입니다." />
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">
          통합 대시보드
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-lg bg-[var(--surface-2)] p-3"
            >
              <p className="text-lg font-bold text-[var(--text)]">
                {s.value}
              </p>
              <p className="text-[11px] text-[var(--text-faint)]">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <MorningPanel />
      </div>

      <div className="mt-4">
        <CoachPanel />
      </div>
    </div>
  )
}

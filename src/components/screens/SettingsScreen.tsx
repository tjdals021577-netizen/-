import { useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { DAILY_BUDGET_USD, getTodaySpendUsd } from '../../lib/budgetGuard'

export function SettingsScreen() {
  const [todaySpend] = useState(() => getTodaySpendUsd())
  const pct = Math.min(100, (todaySpend / DAILY_BUDGET_USD) * 100)

  return (
    <div>
      <PreviewBanner message="로그인 보호는 홈페이지를 실제로 배포하는 Phase 4에서 붙습니다. 아래 예산 가드는 이미 실제로 동작 중입니다(블로그 위원회 사용량 기준)." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text)]">
            로그인 보호
          </p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">
            비밀번호 하나로 세션 유지 (Phase 4 예정)
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-2 text-sm font-semibold text-[var(--text)]">
            일일 예산 가드
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-[var(--text-faint)]">
            오늘 사용액 ${todaySpend.toFixed(3)} / ${DAILY_BUDGET_USD}
          </p>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { DAILY_BUDGET_USD, getTodaySpendUsd } from '../../lib/budgetGuard'
import { testSupabaseConnection } from '../../lib/remoteSync'

export function SettingsScreen() {
  const [todaySpend] = useState(() => getTodaySpendUsd())
  const pct = Math.min(100, (todaySpend / DAILY_BUDGET_USD) * 100)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    const result = await testSupabaseConnection()
    setTestResult(result)
    setTesting(false)
  }

  return (
    <div>
      <PreviewBanner message="로그인 보호는 홈페이지를 실제로 배포하는 Phase 4에서 붙습니다. 아래 예산 가드는 이미 실제로 동작 중입니다(블로그 위원회 사용량 기준)." />

      <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="mb-1 text-sm font-semibold text-[var(--text)]">Supabase 연결 테스트</p>
        <p className="mb-3 text-xs text-[var(--text-faint)]">
          버튼을 누르면 실제로 테스트 데이터 1건을 Supabase에 보내보고, 성공/실패와 원인을 그대로 보여줍니다.
        </p>
        <button
          type="button"
          disabled={testing}
          onClick={() => void handleTestConnection()}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testing ? '테스트 중…' : '지금 연결 테스트'}
        </button>
        {testResult && (
          <pre
            className={`mt-3 whitespace-pre-wrap rounded-lg p-3 text-xs ${
              testResult.ok
                ? 'bg-[var(--done-soft)] text-[var(--done)]'
                : 'bg-[var(--open-soft)] text-[var(--open)]'
            }`}
          >
            {testResult.message}
          </pre>
        )}
      </div>

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

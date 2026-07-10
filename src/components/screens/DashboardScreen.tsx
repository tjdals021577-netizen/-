import { DAILY_BUDGET_USD, getTodaySpendUsd } from '../../lib/budgetGuard'
import { getWorkLog } from '../../lib/workLog'
import { CoachPanel } from '../CoachPanel'
import { MorningPanel } from '../MorningPanel'
import { PreviewBanner } from './PreviewBanner'
import { BRANDS, type Brand } from '../../types/brand'

function todaySpendForBrand(brand: Brand): number {
  const today = new Date().toISOString().slice(0, 10)
  return getWorkLog(undefined, brand)
    .filter((e) => e.startedAt.slice(0, 10) === today && e.costUsd !== undefined)
    .reduce((sum, e) => sum + (e.costUsd ?? 0), 0)
}

function BrandSection({ brand }: { brand: Brand }) {
  const spend = todaySpendForBrand(brand)
  const stats = [
    { label: '어제 방문자', value: '—' },
    { label: '1위 유입경로', value: '—' },
    { label: '결제 전환', value: '—' },
    { label: '블로그 성과', value: '—' },
    { label: '오늘 사용액(추정)', value: `$${spend.toFixed(3)}` },
  ]

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="mb-3 text-sm font-bold text-[var(--text)]">{brand}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-[var(--surface-2)] p-3">
            <p className="text-lg font-bold text-[var(--text)]">{s.value}</p>
            <p className="text-[11px] text-[var(--text-faint)]">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DashboardScreen() {
  const todaySpendTotal = getTodaySpendUsd()

  return (
    <div>
      <PreviewBanner message="방문자·유입경로·결제 전환·블로그 성과는 Phase 4에서 GA4·아임웹 연동 후 브랜드별 실제 숫자로 채워집니다. API 사용액만 지금도 실제 값입니다." />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text)]">
          통합 대시보드 — 브랜드별
        </h2>
        <p className="text-[11px] text-[var(--text-faint)]">
          오늘 API 사용액(전체) ${todaySpendTotal.toFixed(3)} / ${DAILY_BUDGET_USD}
        </p>
      </div>

      <div className="space-y-3">
        {BRANDS.map((b) => (
          <BrandSection key={b} brand={b} />
        ))}
      </div>

      {BRANDS.map((b) => (
        <div key={b} className="mt-4 space-y-4">
          <h3 className="text-sm font-bold text-[var(--text)]">{b} — 모닝 · 코치</h3>
          <MorningPanel brand={b} />
          <CoachPanel brand={b} />
        </div>
      ))}
    </div>
  )
}

import { PreviewBanner } from './PreviewBanner'

const STATS = [
  { label: '어제 방문자', value: '—' },
  { label: '1위 유입경로', value: '—' },
  { label: '결제 전환', value: '—' },
  { label: '오늘 API 사용액', value: '$0.00 / $5.00' },
]

export function DashboardScreen() {
  return (
    <div>
      <PreviewBanner message="일간·주간·월간 리포트와 월 정산(가계부)은 Phase 4에서 GA4·아임웹 연동 후 실제 숫자로 채워집니다." />
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">
          통합 대시보드
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATS.map((s) => (
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
    </div>
  )
}

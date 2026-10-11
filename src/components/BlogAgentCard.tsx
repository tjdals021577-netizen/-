import type { BlogReview, BlogRole } from '../types/blog'
import { BLOG_RUBRICS, BLOG_ROLE_LABEL } from '../agents/blogRubric'

export type BlogAgentStatus = 'idle' | 'loading' | 'done' | 'error'

interface Props {
  role: BlogRole
  status: BlogAgentStatus
  review?: BlogReview
  errorMessage?: string
}

function scoreColorClass(score: number): string {
  if (score >= 90) return 'text-[var(--done)]'
  if (score >= 75) return 'text-[var(--planned)]'
  return 'text-[var(--open)]'
}

const SEVERITY_LABEL: Record<string, string> = {
  risk: '반드시 확인',
  check: '확인 필요',
  info: '참고',
}

function severityClass(severity: string): string {
  if (severity === 'risk')
    return 'bg-[var(--open-soft)] text-[var(--open)]'
  if (severity === 'check')
    return 'bg-[var(--planned-soft)] text-[var(--planned)]'
  return 'bg-[var(--surface-2)] text-[var(--text-faint)]'
}

export function BlogAgentCard({ role, status, review, errorMessage }: Props) {
  const rubric = BLOG_RUBRICS[role]

  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text)]">
          {BLOG_ROLE_LABEL[role]}
        </h3>
        {status === 'loading' && (
          <span className="animate-pulse text-xs text-[var(--accent)]">
            채점 중…
          </span>
        )}
        {status === 'done' && review && (
          <span
            className={`text-lg font-bold ${scoreColorClass(review.totalScore)}`}
          >
            {review.totalScore}
            <span className="text-xs text-[var(--text-faint)]">/100</span>
          </span>
        )}
        {status === 'error' && (
          <span className="text-xs text-[var(--open)]">실패</span>
        )}
      </div>

      {status === 'idle' && (
        <p className="text-xs text-[var(--text-faint)]">대기 중</p>
      )}

      {status === 'error' && (
        <p className="text-xs text-[var(--open)]">{errorMessage}</p>
      )}

      {status === 'done' && review && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-[var(--text-dim)]">
            {review.summary}
          </p>

          <div className="space-y-1.5">
            {rubric.map((c) => {
              const cs = review.criteriaScores.find(
                (s) => s.criterionId === c.id,
              )
              const score = cs?.score ?? 0
              return (
                <div key={c.id}>
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-dim)]">
                    <span>{c.label}</span>
                    <span>{score}/20</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${(score / 20) * 100}%` }}
                    />
                  </div>
                  {cs?.comment && (
                    <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                      근거: {cs.comment}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {review.flags.length > 0 && (
            <details className="text-[11px] text-[var(--text-dim)]" open>
              <summary className="cursor-pointer font-medium text-[var(--text)]">
                수정 포인트 {review.flags.length}건
              </summary>
              <ul className="mt-1.5 space-y-1.5">
                {review.flags.map((f, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-[var(--border)] p-2"
                  >
                    <span
                      className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${severityClass(f.severity)}`}
                    >
                      {SEVERITY_LABEL[f.severity] ?? f.severity}
                    </span>
                    {f.quote && (
                      <span className="text-[var(--text-faint)]">
                        "{f.quote}"
                      </span>
                    )}
                    <p className="mt-0.5 text-[var(--text-dim)]">{f.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

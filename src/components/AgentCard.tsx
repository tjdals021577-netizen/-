import type { AgentReview, AgentRole } from '../types/domain'
import { RUBRICS, ROLE_LABEL } from '../agents/rubric'

export type AgentStatus = 'idle' | 'loading' | 'done' | 'error'

interface Props {
  role: AgentRole
  status: AgentStatus
  review?: AgentReview
  errorMessage?: string
}

const ROLE_EMOJI: Record<AgentRole, string> = {
  planning: '🗂️',
  editing: '✂️',
  strategy: '📈',
}

function scoreColor(score: number): string {
  if (score >= 90) return 'text-emerald-400'
  if (score >= 75) return 'text-yellow-400'
  return 'text-red-400'
}

export function AgentCard({ role, status, review, errorMessage }: Props) {
  const rubric = RUBRICS[role]

  return (
    <div className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
          <span>{ROLE_EMOJI[role]}</span>
          {ROLE_LABEL[role]}
        </h3>
        {status === 'loading' && (
          <span className="text-xs text-violet-400 animate-pulse">
            채점 중…
          </span>
        )}
        {status === 'done' && review && (
          <span className={`text-lg font-bold ${scoreColor(review.totalScore)}`}>
            {review.totalScore}
            <span className="text-xs text-neutral-500">/100</span>
          </span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-400">실패</span>
        )}
      </div>

      {status === 'idle' && (
        <p className="text-xs text-neutral-600">대기 중</p>
      )}

      {status === 'error' && (
        <p className="text-xs text-red-400/80">{errorMessage}</p>
      )}

      {status === 'done' && review && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-neutral-400">
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
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span>{c.label}</span>
                    <span>{score}/20</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-violet-500"
                      style={{ width: `${(score / 20) * 100}%` }}
                    />
                  </div>
                  {cs?.comment && (
                    <p className="mt-0.5 text-[11px] text-neutral-600">
                      {cs.comment}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {review.risks.length > 0 && (
            <div className="rounded-lg bg-red-950/30 p-2 text-[11px] text-red-300">
              <b>주의:</b> {review.risks.join(' / ')}
            </div>
          )}

          <details className="text-[11px] text-neutral-500">
            <summary className="cursor-pointer text-neutral-400">
              컷 제안 {review.cutSuggestions.length} · 강조 제안{' '}
              {review.emphasisSuggestions.length}
            </summary>
            <ul className="mt-1 space-y-1">
              {review.cutSuggestions.map((c, i) => (
                <li key={`cut-${i}`}>
                  ✂️ {c.startSec.toFixed(1)}s–{c.endSec.toFixed(1)}s [
                  {c.action}] {c.reason}
                </li>
              ))}
              {review.emphasisSuggestions.map((e, i) => (
                <li key={`emp-${i}`}>
                  ✨ {e.timeSec.toFixed(1)}s [{e.type}] {e.label} — {e.reason}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  )
}

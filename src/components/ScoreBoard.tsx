import type { AgentReview, AgentRole } from '../types/domain'
import { PASS_THRESHOLD } from '../types/domain'
import { AgentCard, type AgentStatus } from './AgentCard'

export interface RoleState {
  status: AgentStatus
  review?: AgentReview
  errorMessage?: string
}

interface Props {
  states: Record<AgentRole, RoleState>
  averageScore: number | null
}

const ROLES: AgentRole[] = ['planning', 'editing', 'strategy']

export function ScoreBoard({ states, averageScore }: Props) {
  const allDone = ROLES.every((r) => states[r].status === 'done')
  const passed = allDone && (averageScore ?? 0) >= PASS_THRESHOLD

  return (
    <div className="space-y-3">
      {averageScore !== null && (
        <div
          className={`flex items-center justify-between rounded-xl border p-4 ${
            passed
              ? 'border-emerald-700 bg-emerald-950/30'
              : 'border-neutral-800 bg-neutral-900/60'
          }`}
        >
          <div>
            <p className="text-xs text-neutral-400">3인 평균 점수</p>
            <p
              className={`text-2xl font-bold ${passed ? 'text-emerald-400' : 'text-neutral-200'}`}
            >
              {averageScore.toFixed(1)}
              <span className="text-sm text-neutral-500"> / 100</span>
            </p>
          </div>
          <div
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              passed
                ? 'bg-emerald-600 text-white'
                : 'bg-neutral-800 text-neutral-300'
            }`}
          >
            {allDone
              ? passed
                ? `통과 (기준 ${PASS_THRESHOLD}점 이상)`
                : `보류 (기준 ${PASS_THRESHOLD}점 미달)`
              : '심사 진행 중'}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {ROLES.map((role) => (
          <AgentCard
            key={role}
            role={role}
            status={states[role].status}
            review={states[role].review}
            errorMessage={states[role].errorMessage}
          />
        ))}
      </div>
    </div>
  )
}

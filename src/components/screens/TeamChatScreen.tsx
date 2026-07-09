import { PreviewBanner } from './PreviewBanner'

const AGENTS = [
  { name: '브레인', role: '콘텐츠 전략팀', status: '휴식중' },
  { name: '캘린', role: '콘텐츠 기획팀', status: '업무중' },
  { name: '라이터', role: '블로그 SEO 위원회', status: '업무중' },
  { name: '버즈', role: '스레드 위원회', status: '업무중' },
  { name: '리믹서', role: '유튜브 대본 기획', status: '휴식중' },
  { name: '코치', role: '발행 후 분석·피드백', status: '휴식중' },
  { name: '레이더', role: '통합 대시보드', status: '업무중' },
  { name: '모닝', role: '데일리 브리핑', status: '대기중' },
]

export function TeamChatScreen() {
  return (
    <div>
      <PreviewBanner message="팀 채팅은 Phase 2~5에서 각 에이전트가 실제로 연결되면 대화가 오갑니다. 지금은 팀원 구성만 미리 보여드립니다." />
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">
          AI 팀원 (8)
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {AGENTS.map((a) => (
            <div
              key={a.name}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {a.name}
                </p>
                <p className="text-xs text-[var(--text-faint)]">{a.role}</p>
              </div>
              <span className="text-[11px] font-semibold text-[var(--text-faint)]">
                {a.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { getWorkLog, cancelRunningWorkLogs, reapStaleRunningWorkLogs, syncWorkLogFromSupabase, type WorkLogEntry, type WorkLogStatus } from '../../lib/workLog'
import { DISPATCHABLE_AGENTS, type DispatchableAgent } from '../../agents/dispatch'
import { dispatchJobRemote } from '../../lib/remoteDispatch'
import { decideNextStep } from '../../agents/chatDecide'
import { addMessage, getMessages, getMemory, addMemoryFacts, deleteMemoryFact, getLastOutput } from '../../lib/agentChatStore'
import type { AgentChatMessage } from '../../types/agentChat'
import { isOverDailyBudget } from '../../lib/budgetGuard'
import { cancelActiveClaudeCalls, ClaudeCancelledError } from '../../lib/claude'
import { getApprovalQueue, syncApprovalsFromSupabase } from '../../lib/approvalStore'
import { syncReferenceHooksFromSupabase } from '../../lib/hookStore'
import { BRAND_CHANNELS, BRAND_CONTEXT, type Brand } from '../../types/brand'

// "모두에게" 지시할 때, 그 브랜드가 아예 운영 안 하는 채널의 에이전트는
// 애초에 빼고 보낸다(버즈/리믹서는 무조건 에러가 날 걸 알면서 보낼 이유가
// 없음) — writer/brain은 채널 제약이 없어서 항상 대상에 포함됨.
const AGENT_CHANNEL_REQUIREMENT: Partial<Record<DispatchableAgent, string>> = {
  buzz: '스레드',
  remix: '유튜브',
}

interface AgentMeta {
  key: string
  name: string
  primaryTag: string
  secondaryTag: string
  colorVar: string
  initial: string
  limit: string
  dispatchable: boolean
  // 'chat' = 내가 팀채팅에서 직접 시키는 대화형, 'auto' = 손 안 대도 알아서
  // 도는 백그라운드(모닝·레이더). 코치는 팀원 목록에서 빼고 블로그 탭 성과
  // 분석 버튼으로 흡수했다(대표님 정리안) — 그래서 여기 없다.
  group: 'chat' | 'auto'
}

// 브레인·코치는 "레퍼런스 분석"·"내 콘텐츠 분석" 결과가 이 피드로 모여서
// 전략 카드로 강조 표시된다 — 채널 탭에서 실행하고 결과·다음 기획 논의는
// 여기서 이어가는 구조. 리믹서는 유튜브 대본 기획(일반 작업)과 "유튜브
// 콘텐츠 분석"(전략) 둘 다 만들어내므로, kind에 "분석"이 들어간 것만
// 전략 카드로 구분한다 — 대본 기획 결과까지 전부 강조되면 오히려 혼란스러움.
const STRATEGY_AGENT_KEYS = new Set(['brain', 'coach'])
function isStrategyEntry(entry: WorkLogEntry): boolean {
  return STRATEGY_AGENT_KEYS.has(entry.agent) || (entry.agent === 'remix' && entry.kind.includes('분석'))
}

const AGENTS: AgentMeta[] = [
  // 대화형 — 내가 팀채팅에서 직접 시키는 4명
  { key: 'writer', name: '라이터', primaryTag: '블로그 글쓰기', secondaryTag: '3인 위원회 채점', colorVar: '--agent-c', initial: '라', limit: '20분', dispatchable: true, group: 'chat' },
  { key: 'buzz', name: '버즈', primaryTag: '마잘남 스레드 글쓰기', secondaryTag: '전자책 반영', colorVar: '--ch-thread', initial: '버', limit: '15분', dispatchable: true, group: 'chat' },
  { key: 'remix', name: '리믹서', primaryTag: '유튜브 대본 기획', secondaryTag: '성과 분석 겸직', colorVar: '--ch-yt', initial: '리', limit: '20분', dispatchable: true, group: 'chat' },
  { key: 'brain', name: '브레인', primaryTag: '시장·트렌드 리서치', secondaryTag: '검색은 여기만', colorVar: '--agent-a', initial: '브', limit: '10분', dispatchable: true, group: 'chat' },
  // 자동 — 손 안 대도 알아서 도는 2명(대화 불가)
  { key: 'morning', name: '모닝', primaryTag: '아침 카톡 요약', secondaryTag: '매일 8시 자동', colorVar: '--agent-h', initial: '모', limit: '10분', dispatchable: false, group: 'auto' },
  { key: 'radar', name: '레이더', primaryTag: '방문자·통계 수집', secondaryTag: '매일 새벽 자동', colorVar: '--agent-g', initial: '레', limit: '10분', dispatchable: false, group: 'auto' },
]

const AGENT_BY_KEY = new Map(AGENTS.map((a) => [a.key, a]))
const CHAT_AGENTS = AGENTS.filter((a) => a.group === 'chat')
const AUTO_AGENTS = AGENTS.filter((a) => a.group === 'auto')

// 코치는 팀원 목록(사이드바)에서는 뺐지만, 블로그 성과 분석 결과는 여전히
// work_log로 이 피드에 흘러들어온다 — 그 버블에 이름·색·이니셜을 붙이기
// 위한 표시 전용 정보(사이드바에는 안 나옴).
const DISPLAY_META: Record<string, { name: string; initial: string; colorVar: string }> = {
  coach: { name: '코치', initial: '코', colorVar: '--agent-f' },
}
function displayMeta(agentKey: string): { name: string; initial: string; colorVar: string } {
  const meta = AGENT_BY_KEY.get(agentKey)
  if (meta) return { name: meta.name, initial: meta.initial, colorVar: meta.colorVar }
  return DISPLAY_META[agentKey] ?? { name: agentKey, initial: '?', colorVar: '--accent' }
}

const STATUS_ICON: Record<WorkLogStatus, string> = {
  running: '⏳',
  done: '✅',
  attention: '⚠️',
  error: '❌',
}

const STATUS_CHIP: Record<WorkLogStatus, string> = {
  done: 'bg-[var(--done-soft)] text-[var(--done)]',
  error: 'bg-[var(--open-soft)] text-[var(--open)]',
  attention: 'bg-[var(--planned-soft)] text-[var(--planned)]',
  running: 'bg-[var(--planned-soft)] text-[var(--planned)]',
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim()
}

// 에이전트별 통상 소요시간 안내 — "처리 중이에요"만 떠 있으면 얼마나
// 기다려야 하는지 알 수 없다는 피드백 반영. 웹서치·채점 유무에 따라 다름.
const AGENT_ETA_KO: Record<string, string> = {
  writer: '보통 2~5분',
  buzz: '보통 1~2분',
  remix: '보통 1~3분',
  brain: '보통 2~4분',
  coach: '보통 1~2분',
  morning: '보통 1분',
}

function elapsedLabel(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}초`
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

function agentIsBusy(agentKey: string, brand: Brand): boolean {
  return getWorkLog(agentKey, brand).some((e) => e.status === 'running')
}

// "방금 만든 결과물"(수정보완 대상)을 찾는다. 브라우저 메모리(이 세션에서 방금
// 만든 것)를 우선 보고, 없으면 결재함(Supabase에서 동기화됨)의 같은 에이전트
// 최신 결과물로 폴백한다 — 크론(자동 기획)이나 다른 세션/기기에서 만든 기획도
// "이거 고쳐줘"의 대상이 되게 하기 위함. 브레인은 결재함에 안 올라가서 폴백 없음.
function resolveLastOutput(
  agent: DispatchableAgent,
  brand: Brand,
): { title: string; content: string } | undefined {
  const local = getLastOutput(agent, brand)
  if (local) return { title: local.title, content: local.content }
  // 결재함 폴백은 "같은 팀원(=같은 채널)"의 최신 결과물만 본다 — 라이터=블로그,
  // 버즈=스레드, 리믹서=유튜브라 채널이 자동으로 맞는다. 단, 레이더가 올린 유튜브
  // "분석 리포트"는 기획(글)이 아니므로 수정 대상에서 제외한다(리믹서와 agent가
  // 같아서 안 거르면 분석 리포트를 고치려 들 수 있음).
  const latestApproval = getApprovalQueue(undefined, brand).find(
    (i) => i.agent === agent && i.scoreLabel !== '분석 리포트',
  )
  if (latestApproval) {
    return { title: latestApproval.title, content: stripHtml(latestApproval.contentHtml) }
  }
  return undefined
}

// 실제 작업 결과(work_log)와 순수 대화(agent_chat_messages)가 같은 피드에
// 시간순으로 섞여서 나온다 — 하나는 지시→결과물, 다른 하나는 되묻는 질문·
// 잡담 같은 "말"만 오간 기록이라 서로 데이터 구조가 달라서 태그로 구분한다.
type TimelineItem =
  | { kind: 'log'; time: string; entry: WorkLogEntry }
  | { kind: 'chat'; time: string; message: AgentChatMessage }

// "모두에게" 보낸 메시지는 에이전트마다 자기 맥락으로 기억해야 해서 각자의
// 기록에 따로 저장돼 있다 — 여러 에이전트를 한 피드에 합칠 때 그대로 두면
// 내가 보낸 말이 에이전트 수만큼 중복으로 찍힌다. 같은 batchId를 가진 사용자
// 메시지는 하나만 남긴다.
function dedupeBroadcastMessages(messages: AgentChatMessage[]): AgentChatMessage[] {
  const seenBatch = new Set<string>()
  return messages.filter((m) => {
    if (m.role !== 'user' || !m.batchId) return true
    if (seenBatch.has(m.batchId)) return false
    seenBatch.add(m.batchId)
    return true
  })
}

function buildTimeline(entries: WorkLogEntry[], messages: AgentChatMessage[]): TimelineItem[] {
  return [
    ...entries.map((entry) => ({ kind: 'log' as const, time: entry.startedAt, entry })),
    ...messages.map((message) => ({ kind: 'chat' as const, time: message.createdAt, message })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
}

// 통합 피드라 한 버블 묶음에 여러 에이전트가 섞여 나오므로, 상단에 고정된
// 이름 하나 대신 매 항목마다 어느 에이전트인지 배지를 붙여서 보여준다.
function ChatBubbles({ items, onCancelRunning }: { items: TimelineItem[]; onCancelRunning: () => void }) {
  return (
    <>
      {items.map((item) => {
        if (item.kind === 'chat') {
          const { message } = item
          const agentMeta = displayMeta(message.agent)
          const agentName = agentMeta.name
          if (message.role === 'user') {
            return (
              <div key={`chat-${message.id}`} className="mb-3 flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[var(--accent)] px-3.5 py-2 text-[13px] text-white">
                  {message.content}
                </div>
              </div>
            )
          }
          return (
            <div key={`chat-${message.id}`} className="mb-3 flex justify-start">
              <div className="max-w-[80%]">
                <p className="mb-0.5 flex items-center gap-1 px-1 text-[10px] font-bold text-[var(--text-faint)]">
                  <span
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] text-white"
                    style={{ background: `var(${agentMeta.colorVar})` }}
                  >
                    {agentMeta.initial}
                  </span>
                  {agentName}
                  {message.isQuestion && (
                    <span className="rounded-full bg-[var(--planned-soft)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--planned)]">
                      되묻는 질문
                    </span>
                  )}
                </p>
                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-[var(--surface-2)] px-3.5 py-2 text-[13px] text-[var(--text)]">
                  {message.content}
                </div>
              </div>
            </div>
          )
        }

        const { entry } = item
        const agentMeta = displayMeta(entry.agent)
        const agentName = agentMeta.name
        return (
          <div key={`log-${entry.id}`} className="mb-3">
            <div className="flex justify-end">
              <div className="max-w-[80%] break-words rounded-2xl rounded-tr-sm bg-[var(--accent)] px-3.5 py-2 text-[13px] text-white">
                {entry.note}
              </div>
            </div>
            <div className="mt-1.5 flex justify-start">
              <div className="max-w-[80%]">
                <p className="mb-0.5 flex items-center gap-1 px-1 text-[10px] font-bold text-[var(--text-faint)]">
                  <span
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] text-white"
                    style={{ background: `var(${agentMeta.colorVar})` }}
                  >
                    {agentMeta.initial}
                  </span>
                  {agentName}
                  {isStrategyEntry(entry) && entry.status !== 'running' && (
                    <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--accent-strong)]">
                      전략 카드
                    </span>
                  )}
                </p>
                <div
                  className={`whitespace-pre-wrap break-words px-3.5 py-2 text-[13px] text-[var(--text)] ${
                    isStrategyEntry(entry) && entry.status !== 'running'
                      ? 'rounded-2xl border-[1.5px] border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'rounded-2xl rounded-tl-sm bg-[var(--surface-2)]'
                  }`}
                >
                  {entry.status === 'running'
                    ? `${STATUS_ICON.running} 처리 중이에요… (${elapsedLabel(entry.startedAt)} 경과 · ${AGENT_ETA_KO[entry.agent] ?? '보통 몇 분'} 걸려요)\n💡 서버에서 작성 중이라 탭을 꺼도 됩니다 — 나중에 들어오면 결재함에 올라와 있어요.`
                    : `${STATUS_ICON[entry.status]} ${stripHtml(entry.detailHtml) || entry.statusLabel}`}
                </div>
                {/* 진행 중인 작업 바로 옆에 '중단' 버튼을 둔다 — 하단 입력창의
                    취소 버튼은 이 세션에서 방금 보낸 작업일 때만 떠서, 새로고침
                    했거나 다른 곳에서 시작된 '처리 중'은 멈출 방법이 없었다.
                    이 버튼은 어떤 경우든 그 작업을 중단·정리한다. */}
                {entry.status === 'running' && (
                  <button
                    type="button"
                    onClick={onCancelRunning}
                    className="mt-1 rounded-lg border border-[var(--open)] px-2.5 py-1 text-[11px] font-bold text-[var(--open)] transition hover:bg-[var(--open-soft)]"
                  >
                    ⛔ 이 작업 중단하기
                  </button>
                )}
              </div>
            </div>
            {entry.status !== 'running' && (
              <p className="mt-1 text-center text-[10.5px] text-[var(--text-faint)]">
                {agentName}의 상태가 '{entry.statusLabel}'(으)로 변경되었습니다 · {formatRelativeTime(entry.endedAt ?? entry.startedAt)}
              </p>
            )}
          </div>
        )
      })}
    </>
  )
}

const apiKey = 'server-managed'

export function TeamChatScreen({ brand }: { brand: Brand }) {
  // 피드 필터('all'이면 전체 팀 활동을 시간순으로 섞어서 보여줌)와
  // 메시지를 보낼 대상 에이전트를 분리했다 — 예전에는 하나의 selectedKey가
  // 둘 다 겸해서, 다른 에이전트에게 지시하려면 먼저 그 에이전트를 클릭해
  // 피드를 전환해야 했다(사용자가 "한명씩 누르면서 확인하기 힘들다"고 지적).
  const [feedFilter, setFeedFilter] = useState<string>('all')
  const [instruction, setInstruction] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null)
  const [logVersion, setLogVersion] = useState(0)
  const feedEndRef = useRef<HTMLDivElement>(null)

  const viewingAgent = feedFilter === 'all' ? null : (AGENT_BY_KEY.get(feedFilter) ?? null)
  // 대화 대상은 "지금 보고 있는 피드"에 고정된다 — '전체 보기'면 모두에게,
  // 특정 팀원 피드면 그 팀원에게만. 예전엔 피드와 대상이 따로 놀아서, 전체
  // 보기 중인데 대상이 리믹서로 남아 엉뚱한 사람에게 지시가 들어가는 사고가
  // 났다(대표님 지적). null이면 대화 불가(모닝·레이더 같은 자동 전용 팀원).
  const dispatchTarget: DispatchableAgent | 'all' | null =
    feedFilter === 'all'
      ? 'all'
      : viewingAgent && viewingAgent.dispatchable
        ? (feedFilter as DispatchableAgent)
        : null
  const log = feedFilter === 'all' ? getWorkLog(undefined, brand) : getWorkLog(feedFilter, brand)
  const chatMessages =
    feedFilter === 'all'
      ? dedupeBroadcastMessages(DISPATCHABLE_AGENTS.flatMap((a) => getMessages(a, brand)))
      : getMessages(feedFilter, brand)
  const timeline = buildTimeline(log, chatMessages)
  const memoryFacts = viewingAgent && viewingAgent.dispatchable ? getMemory(viewingAgent.key, brand) : []
  const busyAgents = AGENTS.filter((a) => agentIsBusy(a.key, brand))
  const recentAcrossTeam = [...log]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 4)
  void logVersion // 근무기록·대화기록 재조회 트리거용

  // 서버 크론이 만든 근무기록(스레드 매일 시안·콘텐츠 스케줄·브레인 등)은
  // Supabase에만 있어서 팀채팅에 안 보였다 — 화면 진입 시 한 번 당겨온다.
  // 결재함도 같이 당겨온다 — "방금 만든 기획 고쳐줘"의 폴백(직전 결과물)이
  // 결재함에서 나오기 때문(크론·다른 세션이 만든 기획도 수정 대상이 되게).
  useEffect(() => {
    void Promise.all([
      syncWorkLogFromSupabase(),
      syncApprovalsFromSupabase(),
      // 구글시트 후킹 레퍼런스 캐시 — 버즈(스레드) 글 생성 시 참고.
      syncReferenceHooksFromSupabase(),
    ]).then(() => {
      // 다른 세션·이전 방문에서 죽은 채 'running'으로 남은 유령 기록을 정리한다
      // (Supabase에서 막 당겨온 것 포함) — "처리 중… N분 경과"가 끝없이 뜨는 것 방지.
      reapStaleRunningWorkLogs()
      setLogVersion((v) => v + 1)
    })
  }, [])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' })
  }, [feedFilter, logVersion])

  // "처리 중 (N분 경과)" 표시가 실시간으로 올라가고, 다른 곳에서 끝난 작업도
  // 자동으로 반영되게 15초마다 조용히 다시 그린다 — logVersion과 분리한 별도
  // 상태를 쓰는 이유는, logVersion은 스크롤 맨 아래 이동을 트리거해서 15초마다
  // 읽던 위치가 튀면 안 되기 때문.
  const [, setClockTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      // 유령 'running' 기록(백그라운드·새로고침으로 죽은 호출)을 주기적으로
      // 자동 정리 — 화면을 켜둔 채 기다리는 동안 스스로 '시간 초과'로 회복된다.
      reapStaleRunningWorkLogs()
      // 진행 중인 작업이 있으면 서버가 방금 끝냈을 수 있으니 결과를 당겨온다 —
      // 이제 생성은 서버에서 돌기 때문에, 탭을 켜둔 채 기다리는 동안 서버 완료가
      // 자동으로 결재함·근무기록에 반영된다(새로고침 없이).
      const hasRunning = getWorkLog(undefined, brand).some((e) => e.status === 'running')
      if (hasRunning) {
        void Promise.all([syncWorkLogFromSupabase(), syncApprovalsFromSupabase()]).then(() => {
          reapStaleRunningWorkLogs()
          setLogVersion((v) => v + 1)
        })
      }
      setClockTick((t) => t + 1)
    }, 15_000)
    return () => clearInterval(timer)
  }, [brand])

  // 한 에이전트가 지시 한 건을 어떻게 받아들일지 처리하는 단위 — 역할마다
  // 판단이 다를 수 있어서("모두에게"를 보내도 각자 따로 되묻거나 실행할 수
  // 있게) 단일 대상 전송과 "모두에게" 전송이 이 함수를 각자 독립적으로
  // 호출한다.
  async function runAgentTurn(agent: DispatchableAgent, text: string, batchId?: string): Promise<void> {
    addMessage({ agent, brand, role: 'user', content: text, batchId })
    setLogVersion((v) => v + 1)
    const history = getMessages(agent, brand)
    const memory = getMemory(agent, brand).map((m) => m.fact)
    // 직전 결과물 찾기 — ①브라우저 메모리(방금 이 세션에서 만든 것) 우선,
    // 없으면 ②결재함(Supabase 동기화)의 같은 에이전트 최신 결과물로 폴백한다.
    // 그래야 크론(자동 기획)이나 다른 세션/기기에서 만든 기획도 "이거 고쳐줘"가
    // 먹힌다(예전엔 로컬 메모리에만 의존해 "결과물이 없다"고 되물었다).
    const effectiveLast = resolveLastOutput(agent, brand)
    const decision = await decideNextStep({
      apiKey,
      agent,
      brandContext: BRAND_CONTEXT[brand],
      userMessage: text,
      history,
      memory,
      lastOutput: effectiveLast ? `제목: ${effectiveLast.title}\n${effectiveLast.content}` : undefined,
    })
    if (decision.memoryFacts.length > 0) {
      addMemoryFacts(agent, brand, decision.memoryFacts)
    }
    if (decision.kind === 'act') {
      addMessage({ agent, brand, role: 'agent', content: decision.text || '작업을 시작할게요.' })
      setLogVersion((v) => v + 1)
      try {
        // 생성·채점은 서버(/api/dispatch)에서 끝까지 돌린다 — 탭을 벗어나거나
        // 새로고침해도 서버가 결과를 결재함에 올린다(브라우저에서 돌리다 죽어서
        // "처리 중"이 무한히 뜨던 문제 해결). 수정보완 요청이면 직전 결과물을
        // 넘겨 그걸 고쳐 쓰게 한다(새로 안 씀).
        await dispatchJobRemote({
          agent,
          brand,
          instruction: decision.cleanInstruction || text,
          previousOutput: decision.isRevision && effectiveLast ? effectiveLast : undefined,
        })
      } catch (err) {
        // 실패해도 최소한 대화로 알려준다 — 예전엔 조용히 아무 답도 안 나와서
        // "왜 말을 안 해?"가 됐다(취소는 이미 담백한 메시지로 처리됨).
        if (!(err instanceof ClaudeCancelledError)) {
          addMessage({
            agent,
            brand,
            role: 'agent',
            content: `죄송해요, 작업 중 문제가 생겼어요: ${err instanceof Error ? err.message : String(err)}\n다시 한 번 요청해 주시겠어요?`,
          })
          setLogVersion((v) => v + 1)
        }
        throw err
      }
    } else {
      addMessage({
        agent,
        brand,
        role: 'agent',
        content: decision.text || (decision.kind === 'question' ? '조금 더 구체적으로 알려주실 수 있을까요?' : '네, 확인했습니다.'),
        isQuestion: decision.kind === 'question',
      })
      setLogVersion((v) => v + 1)
    }
  }

  async function handleDispatch() {
    setDispatchMessage(null)
    if (dispatchTarget === null) {
      setDispatchMessage('모닝·레이더는 자동으로만 돌아요 — 대화로 지시할 수 없습니다.')
      return
    }
    if (instruction.trim().length === 0) {
      setDispatchMessage(
        '지시 내용을 입력해주세요 — 아직 콘텐츠 캘린더 연동 전이라 비워두면 자동으로 주제를 고르지 못합니다.',
      )
      return
    }
    if (isOverDailyBudget()) {
      setDispatchMessage('오늘 예산 한도를 초과해서 중단했습니다. 내일 다시 시도해주세요.')
      return
    }
    setDispatching(true)
    const text = instruction.trim()
    setInstruction('')
    setLogVersion((v) => v + 1) // 지시 직후 "진행중" 버블이 바로 보이도록
    try {
      if (dispatchTarget === 'all') {
        // "모두에게"도 각 에이전트가 독립적으로 되묻거나 실행하도록 한다 —
        // 역할마다 판단이 다를 수 있어서(예: 같은 지시라도 라이터는 바로
        // 실행 가능한데 리믹서는 벤치마킹 대상이 애매해 되물어야 할 수 있음).
        const targets = DISPATCHABLE_AGENTS.filter((agent) => {
          const requiredChannel = AGENT_CHANNEL_REQUIREMENT[agent]
          return !requiredChannel || BRAND_CHANNELS[brand].includes(requiredChannel)
        })
        const batchId = `broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const results = await Promise.allSettled(targets.map((agent) => runAgentTurn(agent, text, batchId)))
        const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
        const wasCancelled = rejected.some((r) => r.reason instanceof ClaudeCancelledError)
        if (wasCancelled) {
          setDispatchMessage('작업을 취소했어요.')
        } else if (rejected.length > 0) {
          setDispatchMessage(`${targets.length}명 중 ${rejected.length}명 실패 — 각자의 결과 버블에서 확인하세요.`)
        }
      } else {
        // 바로 작업을 실행하지 않고, 먼저 이 지시가 실행해도 될 만큼 충분한지
        // 판단시킨다 — 애매하면 되묻고, 충분하면 지금까지 대화를 종합한
        // 지시문으로 기존 dispatchJob을 그대로 실행한다.
        await runAgentTurn(dispatchTarget, text)
      }
    } catch (err) {
      // 취소는 실패가 아니므로 담백하게 안내한다.
      setDispatchMessage(
        err instanceof ClaudeCancelledError ? '작업을 취소했어요.' : err instanceof Error ? err.message : String(err),
      )
    } finally {
      setDispatching(false)
      setCancelling(false)
      setLogVersion((v) => v + 1)
    }
  }

  // 진행 중인 지시를 즉시 중단한다 — 잘못 입력해서 엉뚱한 분석·작성이 돌기
  // 시작했을 때 대표님이 바로 끊을 수 있게. ①떠 있는 프록시 호출을 전부 abort
  // 하면 이 세션의 dispatchJob이 '취소됨'으로 근무기록을 정리한다. ②새로고침·
  // 다른 세션 때문에 진행 중이던 비동기는 사라졌는데 근무기록만 'running'으로
  // 남아 "처리 중…"이 영원히 떠 있는 고아 기록은 abort로 안 지워지므로,
  // cancelRunningWorkLogs가 강제로 '취소됨' 처리해 즉시 정리한다.
  function handleCancel() {
    setCancelling(true)
    setDispatchMessage('작업을 중단했어요.')
    cancelActiveClaudeCalls()
    cancelRunningWorkLogs(brand)
    setDispatching(false)
    setCancelling(false)
    setLogVersion((v) => v + 1)
  }

  const todayCount = log.filter(
    (e) => e.startedAt.slice(0, 10) === new Date().toISOString().slice(0, 10),
  ).length
  const todayCost = log
    .filter((e) => e.startedAt.slice(0, 10) === new Date().toISOString().slice(0, 10))
    .reduce((s, e) => s + (e.costUsd ?? 0), 0)
  const lastRun = [...log].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )[0]

  return (
    <div>
      <PreviewBanner message="내가 시키는 팀원은 4명 — 라이터(블로그)·버즈(스레드)·리믹서(유튜브)·브레인(리서치). 왼쪽에서 팀원(또는 전체 보기)을 고르면 대화 대상이 그쪽으로 고정돼, 메시지가 엉뚱한 사람에게 들어가지 않아요. 모닝·레이더는 손 안 대도 매일 자동으로 돌고, 성과 분석은 각 채널 탭의 '내 콘텐츠 분석'에서 실행합니다." />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[210px_1fr_240px]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <button
            type="button"
            onClick={() => setFeedFilter('all')}
            className={`mb-2 flex w-full items-center gap-2.5 rounded-lg border p-2 text-left ${
              feedFilter === 'all'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-transparent hover:bg-[var(--surface-2)]'
            }`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent)] text-[12.5px] font-bold text-white">
              전체
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold text-[var(--text)]">전체 보기</span>
              <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-faint)]">
                <span className={`h-1.5 w-1.5 rounded-full ${busyAgents.length > 0 ? 'bg-[var(--done)]' : 'bg-[var(--text-faint)]'}`} />
                {busyAgents.length > 0 ? `${busyAgents.length}명 업무중` : '전원 휴식중'}
              </span>
            </span>
          </button>

          {/* 대화형 — 내가 직접 시키는 팀원 */}
          <p className="mb-1 mt-1 px-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
            내가 시키는 팀원 · {CHAT_AGENTS.length}
          </p>
          {CHAT_AGENTS.map((a) => {
            const isBusy = agentIsBusy(a.key, brand)
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => setFeedFilter(a.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg border p-2 text-left ${
                  feedFilter === a.key
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-transparent hover:bg-[var(--surface-2)]'
                }`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[12.5px] font-bold text-white"
                  style={{ background: `var(${a.colorVar})` }}
                >
                  {a.initial}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-[var(--text)]">{a.name}</span>
                  <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-faint)]">
                    <span className={`h-1.5 w-1.5 rounded-full ${isBusy ? 'bg-[var(--done)]' : 'bg-[var(--text-faint)]'}`} />
                    {a.primaryTag}
                  </span>
                </span>
              </button>
            )
          })}

          {/* 자동 — 손 안 대도 도는 백그라운드(대화 불가) */}
          <p className="mb-1 mt-3 px-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
            자동 · 손 안 대도 돎
          </p>
          {AUTO_AGENTS.map((a) => {
            const isBusy = agentIsBusy(a.key, brand)
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => setFeedFilter(a.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg border p-2 text-left opacity-90 ${
                  feedFilter === a.key
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-transparent hover:bg-[var(--surface-2)]'
                }`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[12.5px] font-bold text-white"
                  style={{ background: `var(${a.colorVar})` }}
                >
                  {a.initial}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-[var(--text)]">{a.name}</span>
                  <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-faint)]">
                    <span className={`h-1.5 w-1.5 rounded-full ${isBusy ? 'bg-[var(--done)]' : 'bg-[var(--text-faint)]'}`} />
                    {a.primaryTag}
                  </span>
                </span>
              </button>
            )
          })}
          <p className="mt-2 px-1 text-[10px] leading-relaxed text-[var(--text-faint)]">
            블로그·유튜브 성과 분석은 각 채널 탭의 '내 콘텐츠 분석'에서 실행해요.
          </p>
        </div>

        <div className="flex h-[75vh] max-h-[820px] min-h-[520px] min-w-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2.5 border-b border-[var(--border)] p-3.5">
            {viewingAgent ? (
              <>
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white"
                  style={{ background: `var(${viewingAgent.colorVar})` }}
                >
                  {viewingAgent.initial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-[var(--text)]">
                    {viewingAgent.name}{' '}
                    <span
                      className={`ml-1 text-[10.5px] font-semibold ${
                        agentIsBusy(viewingAgent.key, brand) ? 'text-[var(--done)]' : 'text-[var(--text-faint)]'
                      }`}
                    >
                      {agentIsBusy(viewingAgent.key, brand) ? '● 업무중' : '● 휴식중'}
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-[var(--text-faint)]">
                    {viewingAgent.primaryTag} · {viewingAgent.secondaryTag}
                  </p>
                </div>
              </>
            ) : (
              <>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-[15px] text-white">
                  👥
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-[var(--text)]">
                    전체 팀{' '}
                    <span className={`ml-1 text-[10.5px] font-semibold ${busyAgents.length > 0 ? 'text-[var(--done)]' : 'text-[var(--text-faint)]'}`}>
                      {busyAgents.length > 0 ? `● ${busyAgents.length}명 업무중` : '● 전원 휴식중'}
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-[var(--text-faint)]">모든 팀원의 활동을 한 곳에서 확인하세요</p>
                </div>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3.5">
            <p className="mb-3 text-center text-[11px] text-[var(--text-faint)]">
              {viewingAgent
                ? `${viewingAgent.name}의 활동만 보고 있어요 — 왼쪽 "전체 보기"를 누르면 모든 팀원을 다시 함께 볼 수 있어요.`
                : `${brand} 팀 채팅 — 모든 팀원의 활동이 시간순으로 함께 표시됩니다.`}
            </p>
            {timeline.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--text-faint)]">아직 대화 기록이 없습니다.</p>
            ) : (
              <ChatBubbles items={timeline} onCancelRunning={handleCancel} />
            )}
            <div ref={feedEndRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border)] p-2.5">
            {/* 대상은 지금 보고 있는 피드에 "고정"된다 — 드롭다운이 아니라 읽기
                전용 칩. 전체 보기면 모두에게, 특정 팀원 피드면 그 팀원에게. */}
            <span
              className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[12px] font-bold text-[var(--accent)]"
              title="대화 대상은 왼쪽에서 보고 있는 팀원(또는 전체)에 자동으로 맞춰집니다."
            >
              {dispatchTarget === 'all'
                ? '🔒 모두에게'
                : dispatchTarget
                  ? `🔒 ${viewingAgent?.name}에게`
                  : '대화 불가'}
            </span>
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={dispatchTarget === null}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !dispatching && busyAgents.length === 0 && dispatchTarget !== null)
                  void handleDispatch()
              }}
              placeholder={
                dispatchTarget === null
                  ? '모닝·레이더는 자동으로만 돌아요 — 대화 대상이 아닙니다.'
                  : dispatchTarget === 'all'
                    ? '전체 팀에게 메시지를 입력하세요… (예: 타로 궁합 후기 블로그 써줘)'
                    : `${viewingAgent?.name}에게 메시지를 입력하세요… (예: 타로 궁합 후기 블로그 써줘)`
              }
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            {dispatching || busyAgents.length > 0 ? (
              // 실행 중(이 세션에서 보낸 작업 or 다른 곳에서 시작돼 아직 '처리
              // 중'인 작업)에는 전송 대신 "중단" 버튼을 보여준다 — 잘못 입력했거나
              // 새로고침 후 멈춰버린 작업을 바로 끊을 수 있게. 누르면 진행 중인
              // 호출을 abort하고, 남아 있는 '처리 중' 기록도 정리한다.
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancel}
                className="shrink-0 rounded-lg bg-[var(--open)] px-4 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelling ? '중단 중…' : '중단'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleDispatch()}
                className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90"
              >
                전송
              </button>
            )}
          </div>
          {dispatchMessage && (
            <p className="px-3.5 pb-2.5 text-[11.5px] text-[var(--text-dim)]">{dispatchMessage}</p>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <div className="mb-3 flex items-center gap-2.5">
              {viewingAgent ? (
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[15px] font-bold text-white"
                  style={{ background: `var(${viewingAgent.colorVar})` }}
                >
                  {viewingAgent.initial}
                </span>
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-[17px] text-white">
                  👥
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-[var(--text)]">{viewingAgent ? viewingAgent.name : '전체 팀'}</p>
                <p
                  className={`text-[10.5px] font-semibold ${
                    (viewingAgent ? agentIsBusy(viewingAgent.key, brand) : busyAgents.length > 0)
                      ? 'text-[var(--done)]'
                      : 'text-[var(--text-faint)]'
                  }`}
                >
                  {viewingAgent
                    ? agentIsBusy(viewingAgent.key, brand)
                      ? '● 업무중'
                      : '● 휴식중'
                    : busyAgents.length > 0
                      ? `● ${busyAgents.length}명 업무중`
                      : '● 전원 휴식중'}
                </p>
              </div>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-dim)]">
              {viewingAgent ? `${viewingAgent.primaryTag} · ${viewingAgent.secondaryTag}` : '오늘 팀 전체 활동 요약'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-[var(--surface-2)] p-2">
                <p className="text-[15px] font-bold text-[var(--text)]">{todayCount}</p>
                <p className="text-[10px] text-[var(--text-faint)]">오늘 처리 건수</p>
              </div>
              <div className="rounded-lg bg-[var(--surface-2)] p-2">
                <p className="text-[15px] font-bold text-[var(--text)]">${todayCost.toFixed(3)}</p>
                <p className="text-[10px] text-[var(--text-faint)]">오늘 사용액</p>
              </div>
              <div className="rounded-lg bg-[var(--surface-2)] p-2">
                <p className="text-[13px] font-bold text-[var(--text)]">
                  {lastRun ? formatRelativeTime(lastRun.startedAt) : '—'}
                </p>
                <p className="text-[10px] text-[var(--text-faint)]">마지막 실행</p>
              </div>
              <div className="rounded-lg bg-[var(--surface-2)] p-2">
                <p className="text-[13px] font-bold text-[var(--text)]">{viewingAgent ? viewingAgent.limit : '—'}</p>
                <p className="text-[10px] text-[var(--text-faint)]">업무 제한 시간</p>
              </div>
            </div>
          </div>

          {viewingAgent && viewingAgent.dispatchable && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                {viewingAgent.name}가 기억하는 것
              </p>
              {memoryFacts.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
                  대화하면서 파악한 취향·스타일이 여기 쌓여서 다음 작업에 계속 참고됩니다.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {memoryFacts.map((fact) => (
                    <div
                      key={fact.id}
                      className="flex items-start justify-between gap-1.5 rounded-lg bg-[var(--surface-2)] p-1.5"
                    >
                      <p className="text-[11px] leading-snug text-[var(--text-dim)]">{fact.fact}</p>
                      <button
                        type="button"
                        onClick={() => {
                          deleteMemoryFact(fact.id)
                          setLogVersion((v) => v + 1)
                        }}
                        className="shrink-0 text-[10px] text-[var(--text-faint)] hover:text-[var(--open)]"
                        aria-label="기억 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
              최근 대화
            </p>
            {recentAcrossTeam.length === 0 ? (
              <p className="text-[11px] text-[var(--text-faint)]">아직 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {recentAcrossTeam.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFeedFilter(entry.agent)}
                    className="block w-full rounded-lg p-1.5 text-left hover:bg-[var(--surface-2)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-semibold text-[var(--text)]">
                        {displayMeta(entry.agent).name}
                      </span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${STATUS_CHIP[entry.status]}`}>
                        {entry.statusLabel}
                      </span>
                    </div>
                    <p className="truncate text-[10.5px] text-[var(--text-faint)]">{entry.note}</p>
                    <p className="text-[10px] text-[var(--text-faint)]">{formatRelativeTime(entry.startedAt)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

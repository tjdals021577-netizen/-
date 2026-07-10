import { useEffect, useRef, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { ApiKeyBar } from '../ApiKeyBar'
import { getStoredApiKey, setStoredApiKey } from '../../lib/apiKey'
import { getWorkLog, type WorkLogEntry, type WorkLogStatus } from '../../lib/workLog'
import { dispatchJob, DISPATCHABLE_AGENTS, type DispatchableAgent } from '../../agents/dispatch'
import { isOverDailyBudget } from '../../lib/budgetGuard'
import type { Brand } from '../../types/brand'

interface AgentMeta {
  key: string
  name: string
  primaryTag: string
  secondaryTag: string
  colorVar: string
  initial: string
  limit: string
  dispatchable: boolean
}

const AGENTS: AgentMeta[] = [
  { key: 'morning', name: '모닝', primaryTag: '데일리 브리핑', secondaryTag: '대시보드에서 실행', colorVar: '--agent-h', initial: '모', limit: '10분', dispatchable: false },
  { key: 'brain', name: '브레인', primaryTag: '콘텐츠 전략팀', secondaryTag: '시장 벤치마킹', colorVar: '--agent-a', initial: '브', limit: '10분', dispatchable: true },
  { key: 'calen', name: '캘린', primaryTag: '콘텐츠 기획팀', secondaryTag: '캘린더에서 실행', colorVar: '--accent', initial: '캘', limit: '15분', dispatchable: false },
  { key: 'writer', name: '라이터', primaryTag: '블로그 SEO 위원회', secondaryTag: '3인 채점', colorVar: '--agent-c', initial: '라', limit: '20분', dispatchable: true },
  { key: 'buzz', name: '버즈', primaryTag: '스레드 위원회', secondaryTag: '대행 포함', colorVar: '--ch-thread', initial: '버', limit: '15분', dispatchable: true },
  { key: 'remix', name: '리믹서', primaryTag: '유튜브 대본 기획', secondaryTag: '벤치마킹 포함', colorVar: '--ch-yt', initial: '리', limit: '20분', dispatchable: true },
  { key: 'coach', name: '코치', primaryTag: '분석·피드백', secondaryTag: '대시보드에서 실행', colorVar: '--agent-f', initial: '코', limit: '15분', dispatchable: false },
  { key: 'radar', name: '레이더', primaryTag: '통합 대시보드', secondaryTag: '자동 수집(예정)', colorVar: '--agent-g', initial: '레', limit: '10분', dispatchable: false },
]

const AGENT_BY_KEY = new Map(AGENTS.map((a) => [a.key, a]))

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

function ChatBubbles({ entries, agentName }: { entries: WorkLogEntry[]; agentName: string }) {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  )
  return (
    <>
      {sorted.map((entry) => (
        <div key={entry.id} className="mb-3">
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[var(--accent)] px-3.5 py-2 text-[13px] text-white">
              {entry.note}
            </div>
          </div>
          <div className="mt-1.5 flex justify-start">
            <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[var(--surface-2)] px-3.5 py-2 text-[13px] text-[var(--text)]">
              {entry.status === 'running'
                ? `${STATUS_ICON.running} 처리 중이에요…`
                : `${STATUS_ICON[entry.status]} ${stripHtml(entry.detailHtml) || entry.statusLabel}`}
            </div>
          </div>
          {entry.status !== 'running' && (
            <p className="mt-1 text-center text-[10.5px] text-[var(--text-faint)]">
              {agentName}의 상태가 '{entry.statusLabel}'(으)로 변경되었습니다 · {formatRelativeTime(entry.endedAt ?? entry.startedAt)}
            </p>
          )}
        </div>
      ))}
    </>
  )
}

export function TeamChatScreen({ brand }: { brand: Brand }) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())
  const [selectedKey, setSelectedKey] = useState<string>('morning')
  const [instruction, setInstruction] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null)
  const [logVersion, setLogVersion] = useState(0)
  const feedEndRef = useRef<HTMLDivElement>(null)

  const selected = AGENT_BY_KEY.get(selectedKey) ?? AGENTS[0]
  const log = getWorkLog(selectedKey, brand)
  const allTodayLog = getWorkLog(undefined, brand)
  const recentAcrossTeam = [...allTodayLog]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 4)
  void logVersion // 근무기록 재조회 트리거용

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' })
  }, [selectedKey, logVersion])

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    setStoredApiKey(key)
  }

  async function handleDispatch() {
    setDispatchMessage(null)
    if (!DISPATCHABLE_AGENTS.includes(selectedKey as DispatchableAgent)) {
      const hint =
        selectedKey === 'morning' || selectedKey === 'coach'
          ? ' 대시보드 화면에서 직접 실행할 수 있습니다.'
          : selectedKey === 'calen'
            ? ' 캘린더 화면에서 직접 일정을 관리할 수 있습니다.'
            : ' 아직 백엔드(스케줄러) 연동 전이라 팀 채팅에서 바로 실행할 수 없습니다.'
      setDispatchMessage(`${selected.name}은(는) 팀 채팅의 자연어 지시로는 실행할 수 없습니다.${hint}`)
      return
    }
    if (!apiKey) {
      setDispatchMessage('먼저 Anthropic API 키를 저장하세요.')
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
    setLogVersion((v) => v + 1) // 지시 직후 "진행중" 버블이 바로 보이도록
    try {
      await dispatchJob({
        agent: selectedKey as DispatchableAgent,
        brand,
        apiKey,
        instruction,
      })
      setInstruction('')
    } catch (err) {
      setDispatchMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setDispatching(false)
      setLogVersion((v) => v + 1)
    }
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
  const busy = agentIsBusy(selectedKey, brand)

  return (
    <div>
      <PreviewBanner message="라이터·버즈·리믹서·브레인은 여기서 바로 실행됩니다. 모닝·코치는 대시보드, 캘린은 캘린더 화면에서 직접 실행합니다. 레이더는 스케줄러(Phase 4)가 붙기 전까지 화면만 준비돼 있습니다." />

      <ApiKeyBar apiKey={apiKey} onChange={handleApiKeyChange} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[210px_1fr_240px]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
            AI 팀원 · {AGENTS.length}
          </p>
          {AGENTS.map((a) => {
            const isBusy = agentIsBusy(a.key, brand)
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => setSelectedKey(a.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg border p-2 text-left ${
                  selectedKey === a.key
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
                    {isBusy ? '업무중' : '휴식중'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex min-h-[520px] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2.5 border-b border-[var(--border)] p-3.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white"
              style={{ background: `var(${selected.colorVar})` }}
            >
              {selected.initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-[var(--text)]">
                {selected.name}{' '}
                <span className={`ml-1 text-[10.5px] font-semibold ${busy ? 'text-[var(--done)]' : 'text-[var(--text-faint)]'}`}>
                  {busy ? '● 업무중' : '● 휴식중'}
                </span>
              </p>
              <p className="truncate text-[11px] text-[var(--text-faint)]">{selected.primaryTag} · {selected.secondaryTag}</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5">
            <p className="mb-3 text-center text-[11px] text-[var(--text-faint)]">
              {brand} 팀 채팅 — 모든 팀원이 업무를 시작했습니다. 무엇을 도와드릴까요?
            </p>
            {log.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--text-faint)]">아직 대화 기록이 없습니다.</p>
            ) : (
              <ChatBubbles entries={log} agentName={selected.name} />
            )}
            <div ref={feedEndRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border)] p-2.5">
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[12px] font-bold text-[var(--accent)] focus:outline-none"
            >
              {AGENTS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !dispatching) void handleDispatch()
              }}
              placeholder="메시지를 입력하세요… (예: 타로 궁합 후기 블로그 써줘)"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="button"
              disabled={dispatching}
              onClick={() => void handleDispatch()}
              className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {dispatching ? '실행 중…' : '전송'}
            </button>
          </div>
          {dispatchMessage && (
            <p className="px-3.5 pb-2.5 text-[11.5px] text-[var(--text-dim)]">{dispatchMessage}</p>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[15px] font-bold text-white"
                style={{ background: `var(${selected.colorVar})` }}
              >
                {selected.initial}
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-[var(--text)]">{selected.name}</p>
                <p className={`text-[10.5px] font-semibold ${busy ? 'text-[var(--done)]' : 'text-[var(--text-faint)]'}`}>
                  {busy ? '● 업무중' : '● 휴식중'}
                </p>
              </div>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-dim)]">
              {selected.primaryTag} · {selected.secondaryTag}
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
                <p className="text-[13px] font-bold text-[var(--text)]">{selected.limit}</p>
                <p className="text-[10px] text-[var(--text-faint)]">업무 제한 시간</p>
              </div>
            </div>
          </div>

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
                    onClick={() => setSelectedKey(entry.agent)}
                    className="block w-full rounded-lg p-1.5 text-left hover:bg-[var(--surface-2)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-semibold text-[var(--text)]">
                        {AGENT_BY_KEY.get(entry.agent)?.name ?? entry.agent}
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

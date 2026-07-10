import { useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { ApiKeyBar } from '../ApiKeyBar'
import { getStoredApiKey, setStoredApiKey } from '../../lib/apiKey'
import { getWorkLog, type WorkLogEntry } from '../../lib/workLog'
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
  cadence: string
  limit: string
  dispatchable: boolean
}

const AGENTS: AgentMeta[] = [
  { key: 'morning', name: '모닝', primaryTag: '데일리 브리핑', secondaryTag: '전건 결재', colorVar: '--agent-h', initial: '모', cadence: '대시보드에서 수동 실행 (자동 매일 08:00은 스케줄러 미연동)', limit: '10분', dispatchable: false },
  { key: 'brain', name: '브레인', primaryTag: '콘텐츠 전략팀', secondaryTag: '시장 벤치마킹', colorVar: '--agent-a', initial: '브', cadence: '요청 시 즉시 실행 (자동 매월 1일은 스케줄러 미연동)', limit: '10분', dispatchable: true },
  { key: 'calen', name: '캘린', primaryTag: '콘텐츠 기획팀', secondaryTag: '캘린더 갱신', colorVar: '--accent', initial: '캘', cadence: '캘린더 화면에서 수동 갱신 (자동 매일 08:05는 스케줄러 미연동)', limit: '15분', dispatchable: false },
  { key: 'writer', name: '라이터', primaryTag: '블로그 SEO 위원회', secondaryTag: '3인 채점', colorVar: '--agent-c', initial: '라', cadence: '요청 시 즉시 실행', limit: '20분', dispatchable: true },
  { key: 'buzz', name: '버즈', primaryTag: '스레드 위원회', secondaryTag: '대행 포함', colorVar: '--ch-thread', initial: '버', cadence: '요청 시 즉시 실행', limit: '15분', dispatchable: true },
  { key: 'remix', name: '리믹서', primaryTag: '유튜브 대본 기획', secondaryTag: '벤치마킹 포함', colorVar: '--ch-yt', initial: '리', cadence: '요청 시 즉시 실행', limit: '20분', dispatchable: true },
  { key: 'coach', name: '코치', primaryTag: '분석·피드백', secondaryTag: '선제 요청 가능', colorVar: '--agent-f', initial: '코', cadence: '대시보드에서 수동 실행 (자동 매주 월요일은 스케줄러 미연동)', limit: '15분', dispatchable: false },
  { key: 'radar', name: '레이더', primaryTag: '통합 대시보드', secondaryTag: '자동 수집', colorVar: '--agent-g', initial: '레', cadence: '매일 2회 (예정 — 스케줄러 미연동)', limit: '10분', dispatchable: false },
]

const MODEL = 'claude-sonnet-5'

const STATUS_CHIP: Record<string, string> = {
  done: 'bg-[var(--done-soft)] text-[var(--done)]',
  error: 'bg-[var(--open-soft)] text-[var(--open)]',
  attention: 'bg-[var(--planned-soft)] text-[var(--planned)]',
  running: 'bg-[var(--planned-soft)] text-[var(--planned)]',
}

function WorkLogRow({ entry }: { entry: WorkLogEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer border-t border-[var(--border)] first:border-t-0 hover:bg-[var(--surface-2)]"
      >
        <td className="px-3.5 py-2.5 text-[var(--text-dim)]">
          <span className={`mr-1 inline-block transition-transform ${open ? 'rotate-90 text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>▸</span>
          {entry.kind}
        </td>
        <td className="px-3.5 py-2.5">
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_CHIP[entry.status] ?? ''}`}>
            {entry.statusLabel}
          </span>
        </td>
        <td className="px-3.5 py-2.5 font-mono text-[11.5px] text-[var(--text-dim)]">
          {new Date(entry.startedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </td>
        <td className="px-3.5 py-2.5 font-mono text-[11.5px] text-[var(--text-dim)]">
          {entry.endedAt
            ? new Date(entry.endedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '—'}
        </td>
        <td className="px-3.5 py-2.5 font-mono text-[11.5px] text-[var(--text-dim)]">
          {entry.costUsd !== undefined ? `$${entry.costUsd.toFixed(3)}` : '—'}
        </td>
        <td className="px-3.5 py-2.5 text-[var(--text-dim)]">{entry.note}</td>
      </tr>
      {open && (
        <tr className="border-t border-[var(--border)] bg-[var(--bg)]">
          <td colSpan={6} className="px-10 py-3.5 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
            {entry.detailHtml ? (
              <div dangerouslySetInnerHTML={{ __html: entry.detailHtml }} />
            ) : (
              <span className="text-[var(--text-faint)]">아직 진행 중이라 상세 내용이 없습니다.</span>
            )}
          </td>
        </tr>
      )}
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

  const selected = AGENTS.find((a) => a.key === selectedKey) ?? AGENTS[0]
  const log = getWorkLog(selectedKey, brand)
  void logVersion // 근무기록 재조회 트리거용

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
    try {
      await dispatchJob({
        agent: selectedKey as DispatchableAgent,
        brand,
        apiKey,
        instruction,
      })
      setDispatchMessage('완료 — 아래 근무 기록에서 결과를 확인하세요.')
      setInstruction('')
      setLogVersion((v) => v + 1)
    } catch (err) {
      setDispatchMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setDispatching(false)
    }
  }

  return (
    <div>
      <PreviewBanner message="라이터·버즈·리믹서·브레인은 여기서 바로 실행됩니다. 모닝·코치는 대시보드, 캘린은 캘린더 화면에서 직접 실행합니다. 레이더는 스케줄러(Phase 4)가 붙기 전까지 화면만 준비돼 있습니다." />

      <ApiKeyBar apiKey={apiKey} onChange={handleApiKeyChange} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[230px_1fr]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
            AI 팀원 · {AGENTS.length}
          </p>
          {AGENTS.map((a) => (
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
                <span className="block truncate text-[10.5px] text-[var(--text-faint)]">{a.primaryTag}</span>
              </span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  a.dispatchable ? 'bg-[var(--done)]' : 'bg-[var(--text-faint)]'
                }`}
              />
            </button>
          ))}
        </div>

        <div>
          <div className="mb-4 flex items-center gap-3">
            <span
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
              style={{ background: `var(${selected.colorVar})` }}
            >
              {selected.initial}
            </span>
            <div>
              <p className="mb-1 text-lg font-bold text-[var(--text)]">{selected.name}</p>
              <div className="flex gap-1.5">
                <span className="rounded-full bg-[var(--open-soft)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--open)]">
                  {selected.primaryTag}
                </span>
                <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--text-dim)]">
                  {selected.secondaryTag}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="font-mono text-[15px] font-bold text-[var(--text)]">{selected.cadence}</p>
              <p className="text-[11px] text-[var(--text-faint)]">실행 주기</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="font-mono text-[15px] font-bold text-[var(--text)]">{MODEL}</p>
              <p className="text-[11px] text-[var(--text-faint)]">모델 (고정)</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="font-mono text-[15px] font-bold text-[var(--text)]">{selected.limit}</p>
              <p className="text-[11px] text-[var(--text-faint)]">업무 제한 시간</p>
            </div>
          </div>

          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">근무 기록</p>
            <p className="text-[11px] text-[var(--text-faint)]">행을 클릭하면 정확히 어떤 작업을 했는지 펼쳐집니다</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {log.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--text-faint)]">아직 실행 기록이 없습니다.</p>
            ) : (
              <table className="w-full min-w-[560px] text-[12.5px]">
                <thead>
                  <tr className="bg-[var(--surface-2)] text-left text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                    <th className="px-3.5 py-2.5">구분</th>
                    <th className="px-3.5 py-2.5">상태</th>
                    <th className="px-3.5 py-2.5">시작</th>
                    <th className="px-3.5 py-2.5">종료</th>
                    <th className="px-3.5 py-2.5">예상 사용료</th>
                    <th className="px-3.5 py-2.5">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((entry) => (
                    <WorkLogRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="sticky bottom-3 mt-4 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-sm">
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12.5px] font-bold text-[var(--accent)] focus:outline-none"
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
              placeholder="시킬 일을 자연어로 적어주세요 (예: 타로 궁합 후기 블로그 써줘)"
              className="min-w-0 flex-1 border-none bg-transparent px-1 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
            />
            <button
              type="button"
              disabled={dispatching}
              onClick={() => void handleDispatch()}
              className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {dispatching ? '실행 중…' : '▶ 일 시키기'}
            </button>
          </div>
          {dispatchMessage && (
            <p className="mt-2 text-[11.5px] text-[var(--text-dim)]">{dispatchMessage}</p>
          )}
        </div>
      </div>
    </div>
  )
}

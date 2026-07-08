import { useEffect, useState } from 'react'
import { ApiKeyBar } from './components/ApiKeyBar'
import { VideoUploader } from './components/VideoUploader'
import { ScriptInput } from './components/ScriptInput'
import { ScoreBoard, type RoleState } from './components/ScoreBoard'
import { EditPlanPanel } from './components/EditPlanPanel'
import { getStoredApiKey, setStoredApiKey } from './lib/apiKey'
import { runAgentReview } from './agents/runReview'
import { PASS_THRESHOLD, type AgentRole } from './types/domain'

const ROLES: AgentRole[] = ['planning', 'editing', 'strategy']

function initialRoleStates(): Record<AgentRole, RoleState> {
  return {
    planning: { status: 'idle' },
    editing: { status: 'idle' },
    strategy: { status: 'idle' },
  }
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)

  const [planSummary, setPlanSummary] = useState('')
  const [transcriptText, setTranscriptText] = useState('')

  const [roleStates, setRoleStates] =
    useState<Record<AgentRole, RoleState>>(initialRoleStates)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    setStoredApiKey(key)
  }

  function handleVideoSelect(file: File) {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(file)
    setVideoUrl(URL.createObjectURL(file))
    setDuration(null)
  }

  const doneReviews = ROLES.map((r) => roleStates[r].review).filter(
    (r): r is NonNullable<typeof r> => !!r,
  )
  const allDone = ROLES.every((r) => roleStates[r].status === 'done')
  const averageScore = allDone
    ? doneReviews.reduce((s, r) => s + r.totalScore, 0) / doneReviews.length
    : null
  const passed = allDone && (averageScore ?? 0) >= PASS_THRESHOLD

  const canStart =
    !!apiKey && transcriptText.trim().length > 0 && !!videoFile && !running

  async function startReview() {
    if (!canStart) return
    setRunning(true)
    setRoleStates({
      planning: { status: 'loading' },
      editing: { status: 'loading' },
      strategy: { status: 'loading' },
    })

    await Promise.allSettled(
      ROLES.map(async (role) => {
        try {
          const review = await runAgentReview({
            apiKey,
            role,
            planSummary,
            transcriptText,
          })
          setRoleStates((prev) => ({
            ...prev,
            [role]: { status: 'done', review },
          }))
        } catch (err) {
          setRoleStates((prev) => ({
            ...prev,
            [role]: {
              status: 'error',
              errorMessage: err instanceof Error ? err.message : String(err),
            },
          }))
        }
      }),
    )
    setRunning(false)
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-neutral-100">
          3인 AI 편집 심사위원회
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          기획 PD · 편집자 · 전략 담당 3개의 AI 에이전트가 각각 100점 만점으로
          채점하고, 평균 {PASS_THRESHOLD}점 이상이면 통과해 자동으로 컷
          편집/강조 포인트를 적용합니다. 서버 없이 브라우저에서만 동작합니다.
        </p>
      </header>

      <div className="space-y-4">
        <ApiKeyBar apiKey={apiKey} onChange={handleApiKeyChange} />

        <VideoUploader
          videoUrl={videoUrl}
          fileName={videoFile?.name ?? null}
          duration={duration}
          onSelect={handleVideoSelect}
          onDurationChange={setDuration}
        />

        <ScriptInput
          planSummary={planSummary}
          onPlanSummaryChange={setPlanSummary}
          transcriptText={transcriptText}
          onTranscriptChange={(text) => setTranscriptText(text)}
        />

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">
            3. AI 심사위원회 채점
          </h2>
          <button
            type="button"
            disabled={!canStart}
            onClick={startReview}
            className="w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? '3인 AI 심사 진행 중…' : '3인 AI 심사 시작'}
          </button>
          {!apiKey && (
            <p className="mt-1 text-center text-[11px] text-amber-400">
              먼저 위에서 Anthropic API 키를 저장하세요.
            </p>
          )}
          {!videoFile && (
            <p className="mt-1 text-center text-[11px] text-neutral-500">
              영상과 스크립트/자막을 모두 입력해야 심사를 시작할 수 있어요.
            </p>
          )}
        </div>

        {(running || allDone) && (
          <ScoreBoard states={roleStates} averageScore={averageScore} />
        )}

        {passed && videoFile && duration && (
          <EditPlanPanel
            videoFile={videoFile}
            duration={duration}
            reviews={doneReviews}
          />
        )}
      </div>
    </div>
  )
}

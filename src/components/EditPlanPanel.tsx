import { useState } from 'react'
import type { AgentReview } from '../types/domain'
import {
  computeKeepSegments,
  mergeAndRemapEmphasis,
  mergeCutRanges,
  totalKeepDuration,
  type Segment,
} from '../lib/editPlan'
import { renderEditedVideo } from '../lib/ffmpegEditor'

interface Props {
  videoFile: File
  duration: number
  reviews: AgentReview[]
}

const EMPHASIS_LABEL: Record<string, string> = {
  caption: '강조 자막',
  zoom_punch_in: '펀치인/줌',
  sfx: '효과음',
  freeze_frame: '프리즈 프레임',
  b_roll: 'B-roll',
  thumbnail_moment: '썸네일 각',
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

export function EditPlanPanel({ videoFile, duration, reviews }: Props) {
  const [rendering, setRendering] = useState(false)
  const [phase, setPhase] = useState('')
  const [progress, setProgress] = useState(0)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cutRanges: Segment[] = mergeCutRanges(reviews, duration)
  const keepSegments: Segment[] = computeKeepSegments(cutRanges, duration)
  const emphasis = mergeAndRemapEmphasis(reviews, keepSegments)
  const keptDuration = totalKeepDuration(keepSegments)

  async function handleRender() {
    setRendering(true)
    setError(null)
    setResultUrl(null)
    try {
      const blob = await renderEditedVideo({
        inputFile: videoFile,
        keepSegments,
        emphasis,
        onProgress: (ph, ratio) => {
          setPhase(ph)
          setProgress(ratio)
        },
      })
      setResultUrl(URL.createObjectURL(blob))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRendering(false)
    }
  }

  return (
    <div className="rounded-xl border border-emerald-800 bg-emerald-950/20 p-4">
      <h2 className="mb-3 text-sm font-semibold text-emerald-300">
        4. 통과 — 자동 편집 적용
      </h2>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-neutral-900/60 p-2">
          <p className="text-neutral-500">원본</p>
          <p className="font-semibold text-neutral-200">{fmt(duration)}</p>
        </div>
        <div className="rounded-lg bg-neutral-900/60 p-2">
          <p className="text-neutral-500">편집 후 예상</p>
          <p className="font-semibold text-emerald-400">{fmt(keptDuration)}</p>
        </div>
        <div className="rounded-lg bg-neutral-900/60 p-2">
          <p className="text-neutral-500">컷 구간 수</p>
          <p className="font-semibold text-neutral-200">{cutRanges.length}</p>
        </div>
      </div>

      {emphasis.length > 0 && (
        <details className="mb-3 text-xs text-neutral-400">
          <summary className="cursor-pointer text-neutral-300">
            강조 포인트 {emphasis.length}개 (자막/썸네일 각은 영상에 자동 삽입)
          </summary>
          <ul className="mt-1 space-y-0.5">
            {emphasis.map((e, i) => (
              <li key={i}>
                {fmt(e.newTimeSec)} · {EMPHASIS_LABEL[e.type] ?? e.type} —{' '}
                {e.label || e.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <button
        type="button"
        disabled={rendering}
        onClick={handleRender}
        className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {rendering
          ? `처리 중… (${phase === 'cutting' ? '컷 편집' : '렌더링'} ${Math.round(progress * 100)}%)`
          : '브라우저에서 편집 적용하고 다운로드'}
      </button>
      <p className="mt-1 text-center text-[11px] text-neutral-500">
        ffmpeg.wasm으로 브라우저 내부에서 처리됩니다. 영상 길이에 따라 수십 초~수 분 걸릴 수 있어요.
      </p>

      {error && (
        <p className="mt-2 rounded-lg bg-red-950/40 p-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {resultUrl && (
        <div className="mt-3 space-y-2">
          <video src={resultUrl} controls className="w-full rounded-lg bg-black" />
          <a
            href={resultUrl}
            download="edited.mp4"
            className="block w-full rounded-lg bg-neutral-800 py-2 text-center text-sm font-medium text-neutral-200 hover:bg-neutral-700"
          >
            edited.mp4 다운로드
          </a>
        </div>
      )}
    </div>
  )
}

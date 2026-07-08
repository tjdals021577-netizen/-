import { useRef, useState } from 'react'
import type { TranscriptCue } from '../types/domain'
import { cuesToPromptText, parseSubtitleFile } from '../lib/subtitles'

interface Props {
  planSummary: string
  onPlanSummaryChange: (v: string) => void
  transcriptText: string
  onTranscriptChange: (text: string, cues: TranscriptCue[]) => void
}

export function ScriptInput({
  planSummary,
  onPlanSummaryChange,
  transcriptText,
  onTranscriptChange,
}: Props) {
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [fileName, setFileName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    const content = await file.text()
    const cues = parseSubtitleFile(content)
    setFileName(file.name)
    onTranscriptChange(cuesToPromptText(cues), cues)
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">
        2. 기획안 & 스크립트/자막 입력
      </h2>

      <label className="mb-1 block text-xs text-neutral-400">
        기획안 요약 (선택, 있으면 채점 정확도 상승)
      </label>
      <textarea
        value={planSummary}
        onChange={(e) => onPlanSummaryChange(e.target.value)}
        placeholder="예: 30대 직장인 대상 재테크 꿀팁 숏폼. 훅 - 문제 제기 - 해결 3단계 구성."
        rows={2}
        className="mb-4 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-violet-500 focus:outline-none"
      />

      <div className="mb-2 flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`rounded-full px-3 py-1 ${
            mode === 'file'
              ? 'bg-violet-600 text-white'
              : 'bg-neutral-800 text-neutral-400'
          }`}
        >
          자막 파일 업로드 (.srt/.vtt)
        </button>
        <button
          type="button"
          onClick={() => setMode('paste')}
          className={`rounded-full px-3 py-1 ${
            mode === 'paste'
              ? 'bg-violet-600 text-white'
              : 'bg-neutral-800 text-neutral-400'
          }`}
        >
          텍스트 직접 붙여넣기
        </button>
      </div>

      {mode === 'file' ? (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".srt,.vtt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-dashed border-neutral-700 px-3 py-2 text-xs text-neutral-400 hover:border-violet-500 hover:text-violet-400"
          >
            {fileName ? `선택됨: ${fileName}` : '.srt 또는 .vtt 파일 선택'}
          </button>
          <p className="mt-1 text-xs text-neutral-600">
            타임코드가 있어야 컷/강조 지점을 초 단위로 정확히 제안받을 수 있어요.
          </p>
        </div>
      ) : (
        <textarea
          value={transcriptText}
          onChange={(e) => onTranscriptChange(e.target.value, [])}
          placeholder={
            '타임코드 포함 권장:\n[00:00-00:05] 안녕하세요 오늘은...\n[00:05-00:12] 첫 번째로...'
          }
          rows={8}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-violet-500 focus:outline-none"
        />
      )}

      {mode === 'file' && transcriptText && (
        <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-neutral-950 p-2 text-xs text-neutral-500">
          {transcriptText}
        </pre>
      )}
    </div>
  )
}

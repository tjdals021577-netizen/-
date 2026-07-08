import { useRef } from 'react'

interface Props {
  videoUrl: string | null
  fileName: string | null
  duration: number | null
  onSelect: (file: File) => void
  onDurationChange: (duration: number) => void
}

export function VideoUploader({
  videoUrl,
  fileName,
  duration,
  onSelect,
  onDurationChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-200">
          1. 원본 영상 업로드
        </h2>
        {fileName && (
          <span className="text-xs text-neutral-500">
            {fileName}
            {duration ? ` · ${duration.toFixed(1)}초` : ''}
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onSelect(file)
        }}
      />

      {!videoUrl ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-700 text-neutral-400 transition hover:border-violet-500 hover:text-violet-400"
        >
          <span className="text-2xl">＋</span>
          <span className="text-sm">클릭해서 영상 파일 선택</span>
          <span className="text-xs text-neutral-600">
            브라우저 안에서만 처리됩니다 (서버 업로드 없음)
          </span>
        </button>
      ) : (
        <div className="space-y-2">
          <video
            src={videoUrl}
            controls
            className="max-h-80 w-full rounded-lg bg-black"
            onLoadedMetadata={(e) =>
              onDurationChange(e.currentTarget.duration)
            }
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs text-violet-400 hover:underline"
          >
            다른 영상으로 교체
          </button>
        </div>
      )}
    </div>
  )
}

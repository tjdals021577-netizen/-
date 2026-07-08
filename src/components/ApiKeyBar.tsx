import { useState } from 'react'

interface Props {
  apiKey: string
  onChange: (key: string) => void
}

export function ApiKeyBar({ apiKey, onChange }: Props) {
  const [open, setOpen] = useState(!apiKey)
  const [draft, setDraft] = useState(apiKey)

  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between font-medium"
      >
        <span>
          Anthropic API 키 {apiKey ? '설정됨 ✓' : '(필수) 설정 필요'}
        </span>
        <span>{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-amber-300/80">
            이 앱은 백엔드 서버가 없습니다. 입력한 키는{' '}
            <b>브라우저 localStorage에만</b> 저장되고, Claude API 호출도
            브라우저에서 직접 이루어집니다. 공용 PC에서는 사용 후 키를
            삭제하세요.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 rounded-lg border border-amber-900/50 bg-neutral-950 px-2 py-1.5 text-neutral-200 placeholder:text-neutral-600 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onChange(draft)}
              className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-500"
            >
              저장
            </button>
            {apiKey && (
              <button
                type="button"
                onClick={() => {
                  setDraft('')
                  onChange('')
                }}
                className="rounded-lg bg-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-700"
              >
                삭제
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

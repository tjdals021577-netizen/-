import { useState } from 'react'

interface Props {
  apiKey: string
  onChange: (key: string) => void
}

export function ApiKeyBar({ apiKey, onChange }: Props) {
  const [open, setOpen] = useState(!apiKey)
  const [draft, setDraft] = useState(apiKey)

  return (
    <div className="rounded-xl border border-[var(--planned)] bg-[var(--planned-soft)] p-3 text-xs text-[var(--text)]">
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
          <p className="text-[var(--text-dim)]">
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
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onChange(draft)}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-white hover:opacity-90"
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
                className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text-dim)] hover:bg-[var(--surface-3)]"
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

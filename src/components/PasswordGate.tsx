import { useState, type FormEvent } from 'react'
import { tryUnlock } from '../lib/appPassword'

export function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (tryUnlock(password)) {
      setError(false)
      onUnlock()
    } else {
      setError(true)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm"
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="h-5 w-5 rounded-md bg-[var(--accent)]" />
          <p className="text-sm font-bold text-[var(--text)]">업메리 · 마잘남 AI 운영</p>
        </div>
        <p className="mb-4 text-xs text-[var(--text-dim)]">비밀번호를 입력하세요.</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(false)
          }}
          className="mb-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
        {error && (
          <p className="mb-3 text-[11.5px] text-[var(--open)]">비밀번호가 올바르지 않습니다.</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          입장
        </button>
      </form>
    </div>
  )
}

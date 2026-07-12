import { useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import { DAILY_BUDGET_USD, getTodaySpendUsd } from '../../lib/budgetGuard'
import { testSupabaseConnection } from '../../lib/remoteSync'
import { listReferences, addReference, deleteReference } from '../../lib/referenceStore'
import { fileToBase64, mediaTypeOf } from '../../lib/imageFile'

export function SettingsScreen() {
  const [todaySpend] = useState(() => getTodaySpendUsd())
  const pct = Math.min(100, (todaySpend / DAILY_BUDGET_USD) * 100)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [references, setReferences] = useState(() => listReferences())
  const [refLabel, setRefLabel] = useState('')
  const [refFile, setRefFile] = useState<File | null>(null)
  const [refError, setRefError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    const result = await testSupabaseConnection()
    setTestResult(result)
    setTesting(false)
  }

  async function handleAddReference() {
    if (!refFile) return
    const mediaType = mediaTypeOf(refFile)
    if (!mediaType) {
      setRefError('PNG, JPEG, WEBP 이미지만 지원합니다.')
      return
    }
    setUploading(true)
    setRefError(null)
    try {
      const imageBase64 = await fileToBase64(refFile)
      addReference({
        label: refLabel.trim() || refFile.name,
        imageBase64,
        mediaType,
      })
      setReferences(listReferences())
      setRefLabel('')
      setRefFile(null)
    } catch (err) {
      setRefError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  function handleDeleteReference(id: string) {
    deleteReference(id)
    setReferences(listReferences())
  }

  return (
    <div>
      <PreviewBanner message="로그인 보호는 홈페이지를 실제로 배포하는 Phase 4에서 붙습니다. 아래 예산 가드는 이미 실제로 동작 중입니다(블로그 위원회 사용량 기준)." />

      <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="mb-1 text-sm font-semibold text-[var(--text)]">Supabase 연결 테스트</p>
        <p className="mb-3 text-xs text-[var(--text-faint)]">
          버튼을 누르면 실제로 테스트 데이터 1건을 Supabase에 보내보고, 성공/실패와 원인을 그대로 보여줍니다.
        </p>
        <button
          type="button"
          disabled={testing}
          onClick={() => void handleTestConnection()}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testing ? '테스트 중…' : '지금 연결 테스트'}
        </button>
        {testResult && (
          <pre
            className={`mt-3 whitespace-pre-wrap rounded-lg p-3 text-xs ${
              testResult.ok
                ? 'bg-[var(--done-soft)] text-[var(--done)]'
                : 'bg-[var(--open-soft)] text-[var(--open)]'
            }`}
          >
            {testResult.message}
          </pre>
        )}
      </div>

      <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="mb-1 text-sm font-semibold text-[var(--text)]">레퍼런스 이미지 라이브러리</p>
        <p className="mb-3 text-xs text-[var(--text-faint)]">
          카피라이팅 스타일 참고용 이미지를 한 번 올려두면, 대행 클라이언트 초안이나 스레드 위원회에서 골라서
          함께 참고시킬 수 있습니다 (매번 새로 첨부할 필요 없음).
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={refLabel}
            onChange={(e) => setRefLabel(e.target.value)}
            placeholder="라벨 (예: 후킹 문구 스타일 A)"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setRefFile(e.target.files?.[0] ?? null)}
            className="block text-xs text-[var(--text-dim)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--text-dim)]"
          />
          <button
            type="button"
            disabled={!refFile || uploading}
            onClick={() => void handleAddReference()}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {uploading ? '추가 중…' : '추가'}
          </button>
        </div>
        {refError && <p className="mt-2 text-xs text-[var(--open)]">{refError}</p>}

        {references.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--text-faint)]">아직 등록된 레퍼런스가 없습니다.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {references.map((r) => (
              <div key={r.id} className="group relative overflow-hidden rounded-lg border border-[var(--border)]">
                <img
                  src={`data:${r.mediaType};base64,${r.imageBase64}`}
                  alt={r.label}
                  className="h-24 w-full object-cover"
                />
                <p className="truncate bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-[var(--text-dim)]">{r.label}</p>
                <button
                  type="button"
                  onClick={() => handleDeleteReference(r.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text)]">
            로그인 보호
          </p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">
            비밀번호 하나로 세션 유지 (Phase 4 예정)
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-2 text-sm font-semibold text-[var(--text)]">
            일일 예산 가드
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-[var(--text-faint)]">
            오늘 사용액 ${todaySpend.toFixed(3)} / ${DAILY_BUDGET_USD}
          </p>
        </div>
      </div>
    </div>
  )
}

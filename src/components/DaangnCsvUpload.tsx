// 설정 화면 — 당근 광고 CSV 업로드(업메리). 당근은 광고 API가 없어서 광고 관리자에서 내려받은 CSV(날짜·비용·노출·클릭)를
// 올리면 날짜별로 합쳐 저장하고, 대시보드 "광고" 카드가 리드(utm_source=daangn)와 합쳐 신청당 비용·ROAS를 계산한다.
import { useEffect, useState } from 'react'
import { mergeDaangnRows, parseDaangnCsv, type DaangnDailyRow } from '../lib/adFunnel'
import { fetchDaangnRows, saveDaangnRows } from '../lib/adStore'

export function DaangnCsvUpload() {
  const [saved, setSaved] = useState<DaangnDailyRow[] | null>(null)
  const [preview, setPreview] = useState<DaangnDailyRow[] | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void fetchDaangnRows().then((r) => setSaved(r.rows))
  }, [])

  async function handleFile(file: File | undefined) {
    setMessage(null)
    setPreview(null)
    if (!file) return
    const { rows, error } = parseDaangnCsv(await file.text())
    if (error) {
      setMessage({ ok: false, text: error })
      return
    }
    setPreview(rows)
  }

  async function handleSave() {
    if (!preview) return
    setSaving(true)
    setMessage(null)
    try {
      // 저장 직전에 최신 값을 다시 읽어 합친다(다른 컴퓨터에서 올린 것도 지우지 않게).
      const latest = await fetchDaangnRows()
      const merged = mergeDaangnRows(latest.rows, preview)
      await saveDaangnRows(merged)
      setSaved(merged)
      setPreview(null)
      setMessage({ ok: true, text: `저장했어요 — ${preview.length}일치 반영, 전체 ${merged.length}일. 대시보드 광고 카드에 바로 보여요.` })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const total = (rows: DaangnDailyRow[]) => rows.reduce((s, r) => s + r.spend, 0)

  return (
    <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="mb-1 text-sm font-semibold text-[var(--text)]">당근 광고 CSV 올리기 (업메리)</p>
      <p className="mb-3 text-xs text-[var(--text-faint)]">
        당근 광고 관리자에서 일별 성과를 CSV로 내려받아 올려주세요. 날짜·비용·노출·클릭 열을 자동으로 찾아요.
        같은 날짜를 다시 올리면 새 값으로 바뀌고, 나머지 날짜는 그대로 쌓여요.
        {saved && saved.length > 0 && ` 지금 저장된 기간: ${saved[0].date} ~ ${saved[saved.length - 1].date} (${saved.length}일)`}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => void handleFile(e.target.files?.[0])}
          className="block text-xs text-[var(--text-dim)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--text-dim)]"
        />
        <button
          type="button"
          disabled={!preview || saving}
          onClick={() => void handleSave()}
          className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
      {preview && (
        <p className="mt-2 text-xs text-[var(--text-dim)]">
          읽은 내용: {preview[0].date} ~ {preview[preview.length - 1].date} · {preview.length}일 · 비용 합계{' '}
          {Math.round(total(preview)).toLocaleString('ko-KR')}원 — 맞으면 저장을 눌러주세요.
        </p>
      )}
      {message && (
        <p className={`mt-2 text-xs ${message.ok ? 'text-[var(--done)]' : 'text-[var(--open)]'}`}>{message.text}</p>
      )}
    </div>
  )
}

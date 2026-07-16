import { useState } from 'react'
import { analyzeScreenshot } from '../agents/runCoach'
import type { CoachAnalysis } from '../types/coach'
import {
  DAILY_BUDGET_USD,
  getTodaySpendUsd,
  isOverDailyBudget,
} from '../lib/budgetGuard'
import { startWorkLog, finishWorkLog } from '../lib/workLog'
import { saveContentFeedback } from '../lib/contentFeedbackStore'
import { BRAND_CONTEXT, BRAND_CHANNELS, type Brand } from '../types/brand'
import { fileToBase64, mediaTypeOf } from '../lib/imageFile'

function buildDetailHtml(analysis: CoachAnalysis): string {
  const stats = analysis.extractedStats
    .map((s) => `${s.label}: <b>${s.value}</b>`)
    .join(' &nbsp;·&nbsp; ')
  return `${stats}<br/>${analysis.summary}`
}

const apiKey = 'server-managed'

export function CoachPanel({ brand }: { brand: Brand }) {
  const [context, setContext] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null)
  const [running, setRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [todaySpend, setTodaySpend] = useState(() => getTodaySpendUsd())

  function handleFileSelect(f: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(f)
    setPreviewUrl(f ? URL.createObjectURL(f) : null)
    setAnalysis(null)
  }

  const overBudget = isOverDailyBudget()
  const canRun = !!apiKey && !!file && !running && !overBudget

  async function handleAnalyze() {
    if (!file) return
    const mediaType = mediaTypeOf(file)
    if (!mediaType) {
      setErrorMessage('PNG, JPEG, WEBP 이미지만 지원합니다.')
      return
    }
    setRunning(true)
    setErrorMessage(null)
    const spendBefore = getTodaySpendUsd()
    const logId = startWorkLog({
      agent: 'coach',
      brand,
      kind: '스크린샷 분석',
      note: context || file.name,
    })
    try {
      const imageBase64 = await fileToBase64(file)
      const brandContext = `[브랜드]\n${BRAND_CONTEXT[brand]}\n운영 채널: ${BRAND_CHANNELS[brand].join(', ')}\n\n${context}`
      const result = await analyzeScreenshot({
        apiKey,
        context: brandContext,
        imageBase64,
        imageMediaType: mediaType,
      })
      setAnalysis(result)
      // 이 분석 결과를 저장해두면 다음 블로그 글 기획(화·목·토·일 자동 + 직접
      // 요청) 때 "지난 성과 피드백"으로 프롬프트에 자동 주입된다 — 성과를 보고
      // 다음 글을 디벨롭하는 루프.
      saveContentFeedback({
        brand,
        channel: 'blog',
        context,
        summary: result.summary,
        nextSteps: result.nextSteps,
      })
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: `지표 ${result.extractedStats.length}개 추출`,
        detailHtml: buildDetailHtml(result),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setErrorMessage(message)
      finishWorkLog(logId, {
        status: 'error',
        statusLabel: '오류',
        note: '분석 실패',
        detailHtml: message,
      })
    } finally {
      setRunning(false)
      setTodaySpend(getTodaySpendUsd())
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div>
        <h2 className="text-base font-bold text-[var(--text)]">
          코치 — 네이버 스크린샷 분석
        </h2>
        <p className="mt-1 text-xs text-[var(--text-dim)]">
          네이버 블로그 통계나 서치어드바이저 화면을 캡처해서 올리면, AI 비전이
          숫자를 읽고 분석·다음 액션까지 정리합니다.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
          어떤 콘텐츠인지 (선택)
        </label>
        <input
          type="text"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="예) 7/9 발행한 타로 궁합 콘텐츠"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
          통계 화면 스크린샷
        </label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-[var(--text-dim)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--text-dim)]"
        />
        {previewUrl && (
          <img
            src={previewUrl}
            alt="업로드한 스크린샷 미리보기"
            className="mt-2 max-h-48 rounded-lg border border-[var(--border)]"
          />
        )}
      </div>

      <button
        type="button"
        disabled={!canRun}
        onClick={() => void handleAnalyze()}
        className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? '분석 중…' : '스크린샷 분석'}
      </button>
      {overBudget && (
        <p className="text-center text-[11px] text-[var(--open)]">
          오늘 예산 한도(${DAILY_BUDGET_USD})를 초과해서 중단했습니다.
        </p>
      )}
      <p className="text-center text-[11px] text-[var(--text-faint)]">
        오늘 사용액 ${todaySpend.toFixed(3)} / ${DAILY_BUDGET_USD}
      </p>

      {errorMessage && (
        <div className="rounded-xl border border-[var(--open)] bg-[var(--open-soft)] p-3 text-sm text-[var(--open)]">
          {errorMessage}
        </div>
      )}

      {analysis && (
        <div className="space-y-3 border-t border-[var(--border)] pt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {analysis.extractedStats.map((s, i) => (
              <div key={i} className="rounded-lg bg-[var(--surface-2)] p-2.5">
                <p className="text-sm font-bold text-[var(--text)]">{s.value}</p>
                <p className="text-[10.5px] text-[var(--text-faint)]">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-[var(--text-dim)]">{analysis.summary}</p>
          {analysis.nextSteps.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--text-faint)]">
                다음 액션
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-[var(--text-dim)]">
                {analysis.nextSteps.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[11px] font-medium text-[var(--accent-strong)]">
            ✅ 이 분석은 저장돼서 다음 블로그 글(화·목·토·일 자동 + 직접 요청) 기획에 자동으로 반영됩니다.
          </p>
        </div>
      )}
    </div>
  )
}

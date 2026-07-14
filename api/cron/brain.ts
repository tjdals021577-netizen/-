import type { IncomingMessage, ServerResponse } from 'node:http'
import { callClaudeJsonWithWebSearch } from '../../src/lib/claude.js'
import { estimateCostUsd } from '../../src/lib/budgetGuard.js'
import { buildBrainSystemPrompt, buildBrainUserPrompt } from '../../src/agents/brainPrompts.js'
import { BRANDS, BRAND_CONTEXT, BRAND_CHANNELS } from '../../src/types/brand.js'
import { supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, sendText, sendJson } from '../_lib/cronHandler.js'

interface BrainReport {
  findings: { source: string; insight: string }[]
  summary: string
  recommendations: string[]
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseBrainReport(raw: unknown): BrainReport {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const findings = Array.isArray(rec.findings)
    ? rec.findings
        .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
        .map((f) => ({ source: String(f.source ?? ''), insight: String(f.insight ?? '') }))
    : []
  return {
    findings,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    recommendations: Array.isArray(rec.recommendations)
      ? rec.recommendations.filter((r): r is string => typeof r === 'string')
      : [],
  }
}

// Vercel Cron이 매월 1일 09:00 KST(00:00 UTC)에 호출한다 — vercel.json 참고.
// 사용자가 매번 주제를 입력하는 수동 리서치와 달리, 자동 실행은 주제가
// 없으므로 "이번 달 트렌드"라는 기본 주제로 돈다 — 리서치 품질보다는
// 매달 놓치지 않고 한 번씩 시장을 훑는 데 의의가 있다.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  // 브랜드별로 순차 실행하면(웹서치 포함 Claude 호출 2번) 300초 크론 제한을
  // 넘겨서 타임아웃이 났다(실제로 겪은 문제) — 브랜드끼리는 서로 의존관계가
  // 없으므로 병렬로 돌려서 전체 시간을 절반 가까이 줄인다.
  const results = await Promise.all(
    BRANDS.map(async (brand) => {
      const topic = `이번 달 ${brand} 콘텐츠 트렌드 및 벤치마킹`
      try {
        let costUsd = 0
        const raw = await callClaudeJsonWithWebSearch({
          apiKey,
          system: buildBrainSystemPrompt(),
          user: buildBrainUserPrompt({
            topic,
            context: `[브랜드]\n${BRAND_CONTEXT[brand]}\n운영 채널: ${BRAND_CHANNELS[brand].join(', ')}`,
          }),
          maxTokens: 4096,
          onUsage: (usage) => {
            costUsd = estimateCostUsd(usage)
          },
        })
        const report = parseBrainReport(raw)
        const nowIso = new Date().toISOString()

        await supabaseInsert('work_log', {
          id: makeId(),
          agent: 'brain',
          brand,
          kind: '월간 리서치(자동)',
          status: 'done',
          status_label: '완료',
          started_at: nowIso,
          ended_at: nowIso,
          cost_usd: costUsd,
          note: `발견 ${report.findings.length}건`,
          detail_html: `<b>발견 사항</b><br/>${report.findings
            .map((f) => `- [${f.source}] ${f.insight}`)
            .join('<br/>')}<br/><br/><b>요약</b><br/>${report.summary}`,
        })
        // 라이터/버즈/리믹서가 다시 찾아 쓸 수 있게 구조화해서도 저장한다
        // (src/lib/brainStore.ts와 같은 테이블 — 이쪽은 localStorage가 없는
        // 서버 환경이라 직접 insert한다).
        await supabaseInsert('brain_reports', {
          id: makeId(),
          brand,
          topic,
          findings: report.findings,
          summary: report.summary,
          recommendations: report.recommendations,
          created_at: nowIso,
        })
        return `${brand}: 발견 ${report.findings.length}건`
      } catch (err) {
        return `${brand}: 실패 (${err instanceof Error ? err.message : String(err)})`
      }
    }),
  )

  sendJson(res, 200, { ok: true, results })
}

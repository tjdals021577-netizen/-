import { callClaudeJsonWithWebSearch } from '../../src/lib/claude'
import { estimateCostUsd } from '../../src/lib/budgetGuard'
import { buildBrainSystemPrompt, buildBrainUserPrompt } from '../../src/agents/brainPrompts'
import { BRANDS, BRAND_CONTEXT, BRAND_CHANNELS } from '../../src/types/brand'
import { supabaseInsert } from '../_lib/supabaseAdmin'

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
export default async function handler(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.', { status: 500 })
  }

  const results: string[] = []

  for (const brand of BRANDS) {
    const topic = `이번 달 ${brand} 콘텐츠 트렌드 및 벤치마킹`
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
    results.push(`${brand}: 발견 ${report.findings.length}건`)
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

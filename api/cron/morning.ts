import { callClaudeJson } from '../../src/lib/claude'
import { estimateCostUsd } from '../../src/lib/budgetGuard'
import { buildMorningSystemPrompt, buildMorningUserPrompt } from '../../src/agents/morningPrompts'
import { BRANDS } from '../../src/types/brand'
import { supabaseSelect, supabaseInsert } from '../_lib/supabaseAdmin'

const AGENT_LABEL_KO: Record<string, string> = {
  morning: '모닝',
  brain: '브레인',
  calen: '캘린',
  writer: '라이터',
  buzz: '버즈',
  remix: '리믹서',
  coach: '코치',
  radar: '레이더',
}

interface WorkLogRow {
  agent: string
  kind: string
  status_label: string
  cost_usd: number | null
  note: string
}

interface MorningBriefing {
  headline: string
  agentSummaries: { agent: string; summary: string }[]
  risks: string[]
  nextActions: string[]
}

function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildLogText(rows: WorkLogRow[]): string {
  return rows
    .map((r) => {
      const label = AGENT_LABEL_KO[r.agent] ?? r.agent
      const cost = r.cost_usd !== null ? `$${r.cost_usd.toFixed(3)}` : '진행중'
      return `- [${label}] ${r.kind} / ${r.status_label} / ${cost} / ${r.note}`
    })
    .join('\n')
}

function parseBriefing(raw: unknown): MorningBriefing {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    headline: typeof rec.headline === 'string' ? rec.headline : '',
    agentSummaries: Array.isArray(rec.agentSummaries)
      ? rec.agentSummaries
          .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
          .map((s) => ({ agent: String(s.agent ?? ''), summary: String(s.summary ?? '') }))
      : [],
    risks: Array.isArray(rec.risks) ? rec.risks.filter((r): r is string => typeof r === 'string') : [],
    nextActions: Array.isArray(rec.nextActions)
      ? rec.nextActions.filter((n): n is string => typeof n === 'string')
      : [],
  }
}

// Vercel Cron이 매일 08:00 KST(23:00 UTC)에 호출한다 — vercel.json 참고.
// Vercel은 CRON_SECRET 환경변수가 설정돼 있으면 크론 호출 시 자동으로
// Authorization: Bearer $CRON_SECRET 헤더를 붙여준다 — 외부에서 이 URL을
// 알아도 그냥 못 부르게 막는 최소한의 보호장치.
export default async function handler(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.', { status: 500 })
  }

  const today = todayKst()
  const results: string[] = []

  for (const brand of BRANDS) {
    const rows = await supabaseSelect<WorkLogRow>(
      'work_log',
      `brand=eq.${encodeURIComponent(brand)}&started_at=gte.${today}T00:00:00&select=agent,kind,status_label,cost_usd,note`,
    )
    const logText = buildLogText(rows)
    const spendText = `$${rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0).toFixed(3)}`

    let costUsd = 0
    const raw = await callClaudeJson({
      apiKey,
      system: buildMorningSystemPrompt(),
      user: buildMorningUserPrompt({ brand, logText, spendText }),
      maxTokens: 2048,
      onUsage: (usage) => {
        costUsd = estimateCostUsd(usage)
      },
    })
    const briefing = parseBriefing(raw)
    const nowIso = new Date().toISOString()

    await supabaseInsert('work_log', {
      id: makeId(),
      agent: 'morning',
      brand,
      kind: '데일리 브리핑(자동)',
      status: 'done',
      status_label: '완료',
      started_at: nowIso,
      ended_at: nowIso,
      cost_usd: costUsd,
      note: briefing.headline,
      detail_html: `<b>${briefing.headline}</b><br/>${briefing.agentSummaries
        .map((s) => `- [${s.agent}] ${s.summary}`)
        .join('<br/>')}`,
    })
    results.push(`${brand}: ${briefing.headline}`)
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

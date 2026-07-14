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

interface RadarSnapshotRow {
  period_label: string
  sessions: number
  active_users: number
  conversions: number
  top_pages: { path: string; views: number }[]
  traffic_sources: { source: string; sessions: number }[]
  order_count: number | null
  revenue_krw: number | null
}

async function buildRadarText(brand: string): Promise<string | undefined> {
  const [ga4Rows, imwebRows] = await Promise.all([
    supabaseSelect<RadarSnapshotRow>(
      'radar_snapshots',
      `brand=eq.${encodeURIComponent(brand)}&source=eq.ga4&order=created_at.desc&limit=1&select=period_label,sessions,active_users,conversions,top_pages,traffic_sources,order_count,revenue_krw`,
    ),
    supabaseSelect<RadarSnapshotRow>(
      'radar_snapshots',
      `brand=eq.${encodeURIComponent(brand)}&source=eq.imweb&order=created_at.desc&limit=1&select=period_label,order_count,revenue_krw`,
    ),
  ])
  const ga4 = ga4Rows[0]
  const imweb = imwebRows[0]
  if (!ga4 && !imweb) return undefined

  const blocks: string[] = []
  if (ga4) {
    const topPage = ga4.top_pages[0]
    const topSource = ga4.traffic_sources[0]
    blocks.push(
      `[GA4] ${ga4.period_label} 방문자 ${ga4.active_users}명 / 세션 ${ga4.sessions}회 / 전환 ${ga4.conversions}건
1위 유입경로: ${topSource ? `${topSource.source} (세션 ${topSource.sessions}회)` : '(데이터 없음)'}
1위 인기 페이지: ${topPage ? `${topPage.path} (조회 ${topPage.views}회)` : '(데이터 없음)'}`,
    )
  }
  if (imweb) {
    blocks.push(
      `[아임웹] ${imweb.period_label} 주문 ${imweb.order_count ?? 0}건 / 매출 ${imweb.revenue_krw != null ? `${imweb.revenue_krw.toLocaleString('ko-KR')}원` : '(집계 안 됨)'}`,
    )
  }
  return blocks.join('\n\n')
}

interface MorningBriefing {
  headline: string
  agentSummaries: { agent: string; summary: string }[]
  risks: string[]
  nextActions: string[]
}

// 크론은 매일 08:00 KST에 도는데, 그 시점의 "오늘 자정~지금"만 보면 근무는
// 보통 낮에 일어나므로 아침엔 기록이 거의 비어있다(실제로 겪은 문제). 대신
// "어제 00:00~23:59 KST" 전체를 봐서 전날 하루를 정리해 아침에 전달한다.
function yesterdayKstRange(): { startIso: string; endIso: string; dateLabel: string } {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const kstToday = kstNow.toISOString().slice(0, 10)
  const kstYesterday = new Date(kstNow.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  return {
    startIso: `${kstYesterday}T00:00:00+09:00`,
    endIso: `${kstToday}T00:00:00+09:00`,
    dateLabel: `어제(${kstYesterday})`,
  }
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

  const { startIso, endIso, dateLabel } = yesterdayKstRange()
  const results: string[] = []

  for (const brand of BRANDS) {
    const rows = await supabaseSelect<WorkLogRow>(
      'work_log',
      `brand=eq.${encodeURIComponent(brand)}&started_at=gte.${encodeURIComponent(startIso)}&started_at=lt.${encodeURIComponent(endIso)}&select=agent,kind,status_label,cost_usd,note`,
    )
    const logText = buildLogText(rows)
    const spendText = `$${rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0).toFixed(3)}`
    const radarText = await buildRadarText(brand)

    let costUsd = 0
    const raw = await callClaudeJson({
      apiKey,
      system: buildMorningSystemPrompt(),
      user: buildMorningUserPrompt({ brand, dateLabel, logText, spendText, radarText }),
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

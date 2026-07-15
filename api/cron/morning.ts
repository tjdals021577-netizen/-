import type { IncomingMessage, ServerResponse } from 'node:http'
import { callClaudeJson } from '../../src/lib/claude.js'
import { estimateCostUsd } from '../../src/lib/budgetGuard.js'
import { buildMorningSystemPrompt, buildMorningUserPrompt } from '../../src/agents/morningPrompts.js'
import { BRANDS } from '../../src/types/brand.js'
import { supabaseSelect, supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, sendText, sendJson } from '../_lib/cronHandler.js'
import { getKakaoAccessToken, sendKakaoMemoToSelf } from '../_lib/kakao.js'
import { getScheduledSlots, kstNow, kstDateKey, kstWeekdayLabel, addDaysKst } from '../../src/lib/weeklySchedule.js'

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
  status: string
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

interface CalendarScheduleRow {
  brand: string
  channel: string
}

const CHANNEL_LABEL_KO: Record<string, string> = {
  blog: '블로그',
  thread: '스레드',
  youtube: '유튜브',
  agency: '대행',
  etc: '기타',
}

// content-schedule 크론이 오늘 새로 만든 항목을 캘린더에서 읽어와 "오늘 뭐가
// 예정돼 있는지"를 채널별 건수로만 압축한다 — content-schedule(06:00 KST)이
// 모닝(08:00 KST)보다 먼저 돌게 스케줄돼 있어서 이 시점엔 이미 오늘 항목이
// 들어가 있다. 카톡은 한 줄 요약이 목표라 제목·체크리스트는 앱에서 확인.
async function buildTodayScheduleText(brand: string, dateKey: string): Promise<string | undefined> {
  const rows = await supabaseSelect<CalendarScheduleRow>(
    'calendar_entries',
    `brand=eq.${encodeURIComponent(brand)}&date=eq.${dateKey}&channel=in.(blog,youtube,thread)&select=brand,channel`,
  )
  if (rows.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const r of rows) {
    counts.set(r.channel, (counts.get(r.channel) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([channel, n]) => `${CHANNEL_LABEL_KO[channel] ?? channel} ${n}건`)
    .join('·')
}

// 이틀 뒤 블로그 예정일에 아직 사진이 안 올라와 있으면 미리 알려준다 — 사진이
// 그날 새벽 크론이 도는 시점까지도 없으면 텍스트만으로 글이 만들어지기 때문에,
// 최소 하루 이상의 여유를 두고 미리 요청한다.
async function buildPhotoReminderText(): Promise<string | undefined> {
  const target = addDaysKst(kstNow(), 2)
  const dateKey = kstDateKey(target)
  const blogSlots = getScheduledSlots(target).filter((s) => s.channel === 'blog')
  if (blogSlots.length === 0) return undefined

  const missing: string[] = []
  for (const slot of blogSlots) {
    const rows = await supabaseSelect<{ id: string }>(
      'content_photos',
      `date=eq.${dateKey}&brand=eq.${encodeURIComponent(slot.brand)}&channel=eq.blog&select=id&limit=1`,
    )
    if (rows.length === 0) missing.push(slot.brand)
  }
  if (missing.length === 0) return undefined
  return `📸 ${dateKey}(블로그 예정일) — ${missing.join(', ')} 사진이 아직 없어요. 앱의 '블로그' 탭 → 사진 업로드에서 미리 올려주세요.`
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

// 채널별 한 줄 요약(대표님 요청 형식) — 어제 두 브랜드의 work_log를 합쳐서
// 라이터→블로그, 버즈→스레드, 리믹서→유튜브로 묶고 브랜드별 상태 건수를
// "완료N·보류N·오류N"으로 압축한다. AI 호출 없이 숫자만 세는 거라 비용 0.
const CHANNEL_AGENT_MAP: Record<string, string> = {
  writer: '블로그',
  buzz: '스레드',
  remix: '유튜브',
}

function buildChannelSummaryLines(rowsByBrand: { brand: string; rows: WorkLogRow[] }[]): string[] {
  const lines: string[] = []
  for (const channelLabel of ['블로그', '스레드', '유튜브']) {
    const brandParts: string[] = []
    for (const { brand, rows } of rowsByBrand) {
      const channelRows = rows.filter((r) => CHANNEL_AGENT_MAP[r.agent] === channelLabel)
      if (channelRows.length === 0) continue
      const done = channelRows.filter((r) => r.status === 'done').length
      const attention = channelRows.filter((r) => r.status === 'attention').length
      const error = channelRows.filter((r) => r.status === 'error').length
      const parts = [
        done > 0 ? `완료${done}` : '',
        attention > 0 ? `보류${attention}` : '',
        error > 0 ? `오류${error}` : '',
      ].filter(Boolean)
      if (parts.length > 0) brandParts.push(`${brand} ${parts.join('·')}`)
    }
    lines.push(`${channelLabel}: ${brandParts.length > 0 ? brandParts.join(' / ') : '활동 없음'}`)
  }
  return lines
}

// 오늘 요일 기준으로 주간 고정 루틴에서 뭐가 예정돼 있는지 — 실제 캘린더
// 항목(자동 기획 결과)과 별개로 "오늘은 원래 이걸 하는 날"을 알려준다.
function buildTodayPlanLine(now: Date): string {
  const slots = getScheduledSlots(now)
  if (slots.length === 0) return '오늘 예정 없음'
  const CH_KO: Record<string, string> = { blog: '블로그', youtube: '유튜브' }
  return slots.map((s) => `${s.brand} ${CH_KO[s.channel] ?? s.channel}`).join(' · ')
}

async function countPendingApprovals(): Promise<number> {
  const rows = await supabaseSelect<{ id: string }>('approval_queue', 'status=eq.pending&select=id')
  return rows.length
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
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  const { startIso, endIso, dateLabel } = yesterdayKstRange()
  const results: string[] = []
  const now = kstNow()
  const todayKey = kstDateKey(now)

  const headlines: string[] = []
  const rowsByBrand: { brand: string; rows: WorkLogRow[] }[] = []

  for (const brand of BRANDS) {
    const rows = await supabaseSelect<WorkLogRow>(
      'work_log',
      `brand=eq.${encodeURIComponent(brand)}&started_at=gte.${encodeURIComponent(startIso)}&started_at=lt.${encodeURIComponent(endIso)}&select=agent,kind,status,status_label,cost_usd,note`,
    )
    rowsByBrand.push({ brand, rows })
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
    headlines.push(`[${brand}] ${briefing.headline}`)
  }

  // ── 카톡 메시지 조립(대표님 지정 형식): 브랜드 요약 → 채널별 한 줄 →
  // 오늘 일정 + 주간 고정표 → 내가 해야 할 것 ──
  const kakaoLines: string[] = [...headlines]

  kakaoLines.push('', '📊 채널 요약')
  kakaoLines.push(...buildChannelSummaryLines(rowsByBrand))

  const todayEntries = await buildTodayScheduleText('마잘남', todayKey)
  const todayEntriesUpmery = await buildTodayScheduleText('업메리', todayKey)
  kakaoLines.push('', `📅 오늘(${kstWeekdayLabel(now)}): ${buildTodayPlanLine(now)}`)
  const prepared = [
    todayEntriesUpmery ? `업메리 ${todayEntriesUpmery}` : '',
    todayEntries ? `마잘남 ${todayEntries}` : '',
  ].filter(Boolean)
  if (prepared.length > 0) kakaoLines.push(`자동 기획됨: ${prepared.join(' / ')}`)
  kakaoLines.push('주간 고정: 월·수·금 유튜브(마잘남) / 화·목·토·일 블로그(업메리·마잘남)')

  kakaoLines.push('', '✅ 내가 해야 할 것')
  try {
    const pendingCount = await countPendingApprovals()
    if (pendingCount > 0) kakaoLines.push(`- 결재함 대기 ${pendingCount}건 컨펌`)
  } catch {
    // 결재함 조회 실패는 브리핑 전체를 막지 않는다
  }
  const errorCount = rowsByBrand.reduce((s, b) => s + b.rows.filter((r) => r.status === 'error').length, 0)
  if (errorCount > 0) kakaoLines.push(`- 어제 오류 ${errorCount}건 → 팀채팅에서 확인`)
  const photoReminder = await buildPhotoReminderText()
  if (photoReminder) kakaoLines.push(`- ${photoReminder}`)
  if (kakaoLines[kakaoLines.length - 1] === '✅ 내가 해야 할 것') {
    kakaoLines.push('- 오늘은 특별히 처리할 게 없어요')
  }

  // 카카오 연결이 안 돼 있으면(설정 전, 또는 토큰 없음) 조용히 건너뛴다 — 실패해도
  // 브리핑 자체는 이미 Supabase에 저장 완료된 뒤라 크론 전체를 실패로 안 만든다.
  const kakaoRestApiKey = process.env.KAKAO_REST_API_KEY
  if (kakaoRestApiKey) {
    try {
      const accessToken = await getKakaoAccessToken(kakaoRestApiKey, process.env.KAKAO_CLIENT_SECRET)
      if (accessToken) {
        await sendKakaoMemoToSelf({
          accessToken,
          text: `☀️ ${dateLabel} 브리핑\n\n${kakaoLines.join('\n')}\n\nhttps://topaz-omega-46.vercel.app`,
        })
        results.push('카카오 알림: 전송 완료')
      } else {
        results.push('카카오 알림: 건너뜀 (연결 안 됨 — /api/kakao-setup으로 최초 연결 필요)')
      }
    } catch (err) {
      results.push(`카카오 알림: 실패 (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  sendJson(res, 200, { ok: true, results })
}

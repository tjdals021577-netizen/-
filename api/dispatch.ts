// 팀 채팅 "일 시키기"를 서버(Vercel)에서 대신 실행하는 엔드포인트.
//
// 예전엔 글 생성·채점 파이프라인이 전부 브라우저(그 탭) 안에서 돌았다 —
// 그래서 작업 도중 탭을 벗어나거나(특히 모바일에서 화면 잠금·앱 전환) 새로고침하면
// 진행 중이던 호출이 통째로 죽고, 근무기록만 'running'으로 남아 "처리 중… N분"이
// 영원히 뜨는 문제가 있었다. 이 엔드포인트로 옮기면 생성이 서버에서 끝까지 돌아
// 결과를 Supabase(work_log·approval_queue·calendar_entries)에 직접 쓴다 —
// 대표님은 탭을 꺼도 되고, 나중에 다시 들어오면 결재함에 결과가 올라와 있다.
//
// 대화형 판단(되묻기·기억)은 여전히 브라우저(chatDecide)가 빠르게 처리하고,
// "실제로 생성하기(act)"로 결정된 무거운 작업만 이 서버 경로로 넘어온다.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateBlogDraft, runBlogReviewsResilient } from '../src/agents/runBlogReview.js'
import { blogVoiceFor } from '../src/agents/blogPrompts.js'
import { generateThreadDraft, runThreadReview } from '../src/agents/runThreadReview.js'
import { MAJALNAM_THREAD_VOICE } from '../src/agents/threadPrompts.js'
import { generateScoredRemixPlan } from '../src/agents/runRemix.js'
import { researchMarketResilient } from '../src/agents/runBrain.js'
import { formatHookReference } from '../src/agents/hookReference.js'
import { PASS_THRESHOLD } from '../src/types/domain.js'
import { BRAND_CONTEXT, BRAND_CHANNELS, BRAND_RESEARCH_FOCUS, BRANDS } from '../src/types/brand.js'
import type { Brand } from '../src/types/brand.js'
import type { BlogRole } from '../src/types/blog.js'
import type { ReferenceHook } from '../src/types/hook.js'
import { makeDefaultChecklist } from '../src/types/calendar.js'
import { kstNow, kstDateKey } from '../src/lib/weeklySchedule.js'
import { supabaseSelect, supabaseInsert } from './_lib/supabaseAdmin.js'
import { sendJson, sendText } from './_lib/cronHandler.js'

// 웹서치·긴 채점까지 안전하게 끝내기 위해 Vercel 상한(300초)으로 명시한다.
export const maxDuration = 300

const DAILY_BUDGET_USD = 5
const BLOG_ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']

type DispatchableAgent = 'writer' | 'buzz' | 'remix' | 'brain'
const VALID_AGENTS: DispatchableAgent[] = ['writer', 'buzz', 'remix', 'brain']

interface DispatchBody {
  agent: DispatchableAgent
  brand: Brand
  instruction: string
  // 브라우저가 만든 근무기록 id — 서버가 같은 id로 완료 행을 upsert해서
  // (merge-duplicates) 브라우저의 임시 'running' 버블이 그대로 완료로 바뀐다.
  logId: string
  // "방금 만든 거 이렇게 고쳐줘"일 때, 직전 결과물(수정 대상).
  previousOutput?: { title: string; content: string }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function getTodaySpendUsd(): Promise<number> {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const todayKey = nowKst.toISOString().slice(0, 10)
  const rows = await supabaseSelect<{ cost_usd: number | null }>(
    'work_log',
    `started_at=gte.${todayKey}T00:00:00%2B09:00&select=cost_usd`,
  )
  return rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
}

// ── 브레인 리서치·피드백·후킹 참고자료 (content-schedule 크론과 동일 패턴) ──
interface BrainReportRow {
  topic: string
  summary: string
  recommendations: string[]
  findings: { source: string; insight: string }[]
}

function formatBrainFindings(report: BrainReportRow | undefined): string | undefined {
  if (!report) return undefined
  const findingsText = (report.findings ?? [])
    .slice(0, 8)
    .map((f) => `- [${f.source}] ${f.insight.slice(0, 240)}`)
    .join('\n')
  const recoText = (report.recommendations ?? []).slice(0, 5).join(' / ')
  return `주제: ${report.topic}\n요약: ${report.summary.slice(0, 400)}\n${findingsText}${
    recoText ? `\n추천 액션: ${recoText}` : ''
  }`
}

async function fetchBrainFindings(brand: Brand): Promise<string | undefined> {
  try {
    const reports = await supabaseSelect<BrainReportRow>(
      'brain_reports',
      `brand=eq.${encodeURIComponent(brand)}&order=created_at.desc&limit=1&select=topic,summary,recommendations,findings`,
    )
    return formatBrainFindings(reports[0])
  } catch {
    return undefined
  }
}

interface ContentFeedbackRow {
  context: string
  summary: string
  next_steps: string[]
  created_at: string
}

async function fetchRecentFeedback(
  brand: Brand,
  channel: 'blog' | 'youtube',
): Promise<string | undefined> {
  try {
    const rows = await supabaseSelect<ContentFeedbackRow>(
      'content_feedback',
      `brand=eq.${encodeURIComponent(brand)}&channel=eq.${channel}&order=created_at.desc&limit=2` +
        `&select=context,summary,next_steps,created_at`,
    )
    if (rows.length === 0) return undefined
    return rows
      .map((r) => {
        const steps = (r.next_steps ?? []).length > 0 ? `\n다음 액션: ${r.next_steps.join(' / ')}` : ''
        return `- (${(r.created_at ?? '').slice(0, 10)}${r.context ? ` · ${r.context}` : ''}) ${r.summary}${steps}`
      })
      .join('\n')
  } catch {
    return undefined
  }
}

interface ReferenceHookRow {
  id: string
  hook: string
  industry?: string
  structure?: string
  cta?: string
  created_at?: string
}

async function fetchHookReference(): Promise<string> {
  try {
    const rows = await supabaseSelect<ReferenceHookRow>('reference_hooks', 'select=*&limit=500')
    const hooks: ReferenceHook[] = rows.map((r) => ({
      id: r.id,
      hook: r.hook,
      industry: r.industry,
      structure: r.structure,
      cta: r.cta,
      createdAt: r.created_at ?? new Date().toISOString(),
    }))
    return formatHookReference(hooks)
  } catch {
    return ''
  }
}

// ── 근무기록 헬퍼 ──
async function writeWorkLog(row: {
  logId: string
  agent: string
  brand: Brand
  kind: string
  status: 'running' | 'done' | 'attention' | 'error'
  statusLabel: string
  startedAt: string
  ended?: boolean
  note: string
  detailHtml: string
}): Promise<void> {
  await supabaseInsert('work_log', {
    id: row.logId,
    agent: row.agent,
    brand: row.brand,
    kind: row.kind,
    status: row.status,
    status_label: row.statusLabel,
    started_at: row.startedAt,
    ended_at: row.ended ? new Date().toISOString() : undefined,
    note: row.note,
    detail_html: row.detailHtml,
  })
}

// 콘텐츠 결과물(라이터·버즈·리믹서)을 결재함·캘린더·근무기록에 한꺼번에 쓴다.
async function finishContentJob(opts: {
  logId: string
  agent: string
  brand: Brand
  channel: 'blog' | 'thread' | 'youtube'
  kind: string
  title: string
  contentHtml: string
  passed: boolean
  scoreLabel: string
  note: string
  startedAt: string
  date: string
}): Promise<void> {
  const nowIso = new Date().toISOString()
  await writeWorkLog({
    logId: opts.logId,
    agent: opts.agent,
    brand: opts.brand,
    kind: opts.kind,
    status: opts.passed ? 'done' : 'attention',
    statusLabel: opts.passed ? '완료' : '보류',
    startedAt: opts.startedAt,
    ended: true,
    note: opts.note,
    detailHtml: opts.contentHtml,
  })
  await supabaseInsert('approval_queue', {
    id: makeId(),
    agent: opts.agent,
    brand: opts.brand,
    title: opts.title,
    content_html: opts.contentHtml,
    passed: opts.passed,
    score_label: opts.scoreLabel,
    created_at: nowIso,
    status: 'pending',
    source_work_log_id: opts.logId,
  })
  await supabaseInsert('calendar_entries', {
    id: makeId(),
    date: opts.date,
    brand: opts.brand,
    channel: opts.channel,
    title: opts.title,
    status: opts.passed ? 'planned' : 'open',
    note: opts.note,
    content_html: opts.contentHtml,
    checklist: makeDefaultChecklist(true),
    created_at: nowIso,
    source_work_log_id: opts.logId,
  })
}

// ── 에이전트별 실행 ──
async function runWriter(apiKey: string, body: DispatchBody, startedAt: string, date: string): Promise<string> {
  const { brand, instruction, previousOutput } = body
  const [marketFindings, pastFeedback] = await Promise.all([
    fetchBrainFindings(brand),
    fetchRecentFeedback(brand, 'blog'),
  ])
  const draft = await generateBlogDraft({
    apiKey,
    topic: instruction,
    keyPoints: '',
    photoDescriptions: '',
    brandContext: BRAND_CONTEXT[brand],
    marketFindings,
    pastFeedback,
    blogVoice: blogVoiceFor(brand),
    previousDraft: previousOutput
      ? { title: previousOutput.title, body: previousOutput.content, photoPlacements: [] }
      : undefined,
    feedback: previousOutput ? instruction : undefined,
  })
  const reviews = await runBlogReviewsResilient({ apiKey, roles: BLOG_ROLES, draft })
  const reviewed = reviews.length > 0
  const avg = reviewed ? reviews.reduce((s, r) => s + r.totalScore, 0) / reviews.length : 0
  const passed = reviewed && avg >= PASS_THRESHOLD
  const scoreNote = reviewed ? `${avg.toFixed(1)}점 ${passed ? '통과' : '미달'}` : '채점 실패 — 내용은 저장됨'
  const contentHtml = `${draft.body.replace(/\n/g, '<br/>')}${
    draft.photoPlacements.length > 0
      ? `<br/><br/><b>사진 배치 제안</b><br/>${draft.photoPlacements.map((p) => `- ${p}`).join('<br/>')}`
      : ''
  }`
  await finishContentJob({
    logId: body.logId,
    agent: 'writer',
    brand,
    channel: 'blog',
    kind: '수동 지시(팀 채팅)',
    title: draft.title,
    contentHtml,
    passed,
    scoreLabel: reviewed ? `${avg.toFixed(1)}/100` : '채점 실패',
    note: scoreNote,
    startedAt,
    date,
  })
  return scoreNote
}

async function runBuzz(apiKey: string, body: DispatchBody, startedAt: string, date: string): Promise<string> {
  const { brand, instruction, previousOutput } = body
  if (!BRAND_CHANNELS[brand].includes('스레드')) {
    throw new Error(`${brand}는 스레드 채널을 운영하지 않습니다.`)
  }
  const [marketFindings, hookReference] = await Promise.all([
    fetchBrainFindings(brand),
    fetchHookReference(),
  ])
  const draft = await generateThreadDraft({
    apiKey,
    topic: instruction,
    brandVoice: MAJALNAM_THREAD_VOICE,
    marketFindings,
    hookReference,
    previousDraft: previousOutput ? { text: previousOutput.content } : undefined,
    feedback: previousOutput ? instruction : undefined,
  })
  const review = await runThreadReview({ apiKey, draft })
  const passed = review.totalScore >= PASS_THRESHOLD
  const title = draft.text.slice(0, 40) + (draft.text.length > 40 ? '…' : '')
  const contentHtml = draft.text.replace(/\n/g, '<br/>')
  const note = `${review.totalScore}점 ${passed ? '통과' : '미달'}`
  await finishContentJob({
    logId: body.logId,
    agent: 'buzz',
    brand,
    channel: 'thread',
    kind: '수동 지시(팀 채팅)',
    title,
    contentHtml,
    passed,
    scoreLabel: `${review.totalScore}/100`,
    note,
    startedAt,
    date,
  })
  return note
}

async function runRemixJob(apiKey: string, body: DispatchBody, startedAt: string, date: string): Promise<string> {
  const { brand, instruction, previousOutput } = body
  if (!BRAND_CHANNELS[brand].includes('유튜브')) {
    throw new Error(`${brand}는 유튜브 채널을 운영하지 않습니다.`)
  }
  const [marketFindings, pastFeedback] = await Promise.all([
    fetchBrainFindings(brand),
    fetchRecentFeedback(brand, 'youtube'),
  ])
  const { plan, review } = await generateScoredRemixPlan({
    apiKey,
    topic: instruction,
    referenceText: '',
    brandContext: BRAND_CONTEXT[brand],
    marketFindings,
    pastFeedback,
    revision: previousOutput
      ? {
          previousPlan: { title: previousOutput.title, outline: previousOutput.content, hooks: [], benchmarkNotes: [] },
          feedback: instruction,
        }
      : undefined,
  })
  const videoTitle = plan.title || instruction
  const passed = review.totalScore >= PASS_THRESHOLD
  const scoreNote = `${review.totalScore}점 ${passed ? '통과' : '미달'}`
  const titleLine = plan.title ? `<b>🎬 제목</b><br/>${plan.title}<br/><br/>` : ''
  const contentHtml = `${titleLine}<b>훅 후보</b><br/>${plan.hooks
    .map((h) => `- ${h}`)
    .join('<br/>')}<br/><br/><b>대본 구성안</b><br/>${plan.outline.replace(
    /\n/g,
    '<br/>',
  )}<br/><br/><b>채점</b> ${scoreNote} — ${review.summary}`
  await finishContentJob({
    logId: body.logId,
    agent: 'remix',
    brand,
    channel: 'youtube',
    kind: '수동 지시(팀 채팅)',
    title: videoTitle,
    contentHtml,
    passed,
    scoreLabel: `${review.totalScore}/100`,
    note: `${scoreNote} · ${videoTitle}`,
    startedAt,
    date,
  })
  return scoreNote
}

async function runBrainJob(apiKey: string, body: DispatchBody, startedAt: string): Promise<string> {
  const { brand, instruction } = body
  const research = await researchMarketResilient({
    apiKey,
    topic: instruction,
    context: `[브랜드]\n${BRAND_CONTEXT[brand]}\n운영 채널: ${BRAND_CHANNELS[brand].join(', ')}`,
    focus: BRAND_RESEARCH_FOCUS[brand],
  })
  const report = research.report
  const hasFindings = report.findings.length > 0
  // 결과가 있을 때만 브레인 리포트로 저장한다(빈 리포트로 직전 자료를 덮지 않게).
  if (research.ok && hasFindings) {
    await supabaseInsert('brain_reports', {
      id: makeId(),
      brand,
      topic: instruction,
      findings: report.findings,
      summary: report.summary,
      recommendations: report.recommendations,
      created_at: new Date().toISOString(),
    })
  }
  const detailHtml = hasFindings
    ? `<b>발견 사항</b><br/>${report.findings
        .map((f) => `- [${f.source}] ${f.insight}`)
        .join('<br/>')}<br/><br/><b>요약</b><br/>${report.summary}`
    : research.note
  await writeWorkLog({
    logId: body.logId,
    agent: 'brain',
    brand,
    kind: '수동 지시(팀 채팅)',
    status: research.ok && hasFindings ? 'done' : 'attention',
    statusLabel: research.ok && hasFindings ? '완료' : '보류',
    startedAt,
    ended: true,
    note: research.ok ? `발견 ${report.findings.length}건` : research.note,
    detailHtml,
  })
  return research.ok ? `발견 ${report.findings.length}건` : research.note
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendText(res, 405, 'POST만 지원합니다.')
    return
  }
  const configuredPassword = process.env.VITE_APP_PASSWORD
  if (configuredPassword && req.headers['x-app-password'] !== configuredPassword) {
    sendText(res, 401, '인증 실패')
    return
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  let body: DispatchBody
  try {
    body = JSON.parse(await readBody(req)) as DispatchBody
  } catch {
    sendText(res, 400, '잘못된 요청 본문입니다.')
    return
  }
  if (!VALID_AGENTS.includes(body.agent) || !BRANDS.includes(body.brand) || !body.logId) {
    sendText(res, 400, 'agent·brand·logId가 올바르지 않습니다.')
    return
  }
  if (typeof body.instruction !== 'string' || body.instruction.trim().length === 0) {
    sendText(res, 400, '지시 내용(instruction)이 비어 있습니다.')
    return
  }

  // 예산 가드 — 프록시와 동일. 초과면 시작조차 하지 않는다.
  try {
    if ((await getTodaySpendUsd()) >= DAILY_BUDGET_USD) {
      sendJson(res, 429, { error: `오늘 예산 한도($${DAILY_BUDGET_USD})를 초과했습니다. 내일 다시 시도해주세요.` })
      return
    }
  } catch {
    // 예산 조회 실패는 best-effort — 서비스는 계속.
  }

  const startedAt = new Date().toISOString()
  const date = kstDateKey(kstNow())

  // 브라우저의 임시 'running' 버블과 같은 id로 서버에도 'running'을 남긴다 —
  // 혹시 완료 응답이 브라우저에 도달하지 못해도(탭이 닫힘) 나중에 완료 행이
  // 같은 id로 덮어써져 결재함에 정상 표시된다.
  try {
    await writeWorkLog({
      logId: body.logId,
      agent: body.agent,
      brand: body.brand,
      kind: '수동 지시(팀 채팅)',
      status: 'running',
      statusLabel: '진행중',
      startedAt,
      note: body.instruction.trim().slice(0, 120),
      detailHtml: '',
    })
  } catch {
    // running 기록 실패해도 본 작업은 계속 — 완료 시 다시 upsert한다.
  }

  try {
    let summary: string
    if (body.agent === 'writer') summary = await runWriter(apiKey, body, startedAt, date)
    else if (body.agent === 'buzz') summary = await runBuzz(apiKey, body, startedAt, date)
    else if (body.agent === 'remix') summary = await runRemixJob(apiKey, body, startedAt, date)
    else summary = await runBrainJob(apiKey, body, startedAt)
    sendJson(res, 200, { ok: true, summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 실패해도 같은 id로 'error' 행을 남겨, 브라우저의 'running' 버블이 유령으로
    // 남지 않고 ❌로 정리되게 한다.
    try {
      await writeWorkLog({
        logId: body.logId,
        agent: body.agent,
        brand: body.brand,
        kind: '수동 지시(팀 채팅)',
        status: 'error',
        statusLabel: '오류',
        startedAt,
        ended: true,
        note: '실행 실패',
        detailHtml: message,
      })
    } catch {
      // 에러 기록 저장 실패는 무시.
    }
    sendJson(res, 500, { ok: false, error: message })
  }
}

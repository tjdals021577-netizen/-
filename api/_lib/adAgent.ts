// 애드 — 업메리 메타·당근 광고 운영 팀원(2026-10 대표님 요청). 목적: 결제당 비용을 낮추는 것.
// 흐름(매주 월요일 09시대 자동 + 팀채팅 수동, 함수 한 번 300초 안):
//   ① 코드로 [검증된 사실] 만들기 — 광고 대시보드 숫자(radar_snapshots meta_ads·daangn_ads) + leads + 메타 광고 세트·광고 상태
//   ② 분석(Sonnet medium): 끌 광고 / 늘릴 광고(세트 예산) / 새 소재 방향 → 코드 검사: 학습 중(최근 7일 이내 수정) 세트·그 안 광고는
//      제안에서 빼고, 예산은 ±20%로 자르고, 근거 숫자가 사실 밖이면 "확인 필요" 표시
//   ③ 문구(Sonnet high) 5세트 → 줄표 자동 수정 → 금지어 코드 검사 + 채점(Haiku medium, 5항목) → 걸리거나 85점 미만이면
//      1회 고쳐 쓰기(high) → 고쳐 써도 금지어가 남은 세트는 결재함에 올리지 않는다
//   ④ 결재함: 리포트 1건 + 실행 대기 항목(끄기·예산)마다 1건. 광고 변경은 대표님이 그 항목을 승인할 때만
//      api/dispatch.ts → executeAdAction이 메타 마케팅 API로 실행한다(자동 실행 없음).
// 근무기록엔 건수·요약만(리드 개인정보 없음).
import { callClaudeJson, CLAUDE_MODEL_CHEAP } from '../../src/lib/claude.js'
import { estimateCostUsd } from '../../src/lib/budgetGuard.js'
import { buildAdFunnelReport, type AdFunnel, type DaangnDailyRow, type FunnelStats, type MetaAdDailyRow, AD_CHANNEL_LABEL, costPer, roas } from '../../src/lib/adFunnel.js'
import {
  AD_COPY_RUBRIC,
  buildAdAnalysisSystem,
  buildAdAnalysisUser,
  buildAdCopyReviewSystem,
  buildAdCopySystem,
  buildAdCopyUser,
} from '../../src/agents/adPrompts.js'
import {
  autoFixCopySet,
  checkCopySet,
  isBlockingIssue,
  numbersIn,
  unverifiedNumbers,
  type AdCopyIssue,
  type AdCopySet,
} from '../../src/agents/adRuleCheck.js'
import { PASS_THRESHOLD } from '../../src/types/domain.js'
import type { LeadRow } from '../../src/types/lead.js'
import { supabaseInsert, supabaseSelect, supabaseUpdate } from './supabaseAdmin.js'
import {
  fetchMetaAd,
  fetchMetaAdset,
  fetchMetaAdStructure,
  pauseMetaAd,
  setMetaAdsetDailyBudget,
  type MetaAd,
  type MetaAdset,
} from './metaAds.js'

const BRAND = '업메리'
const AGENT = 'ad'
export const AD_WEEKLY_KIND = '애드 주간 리포트'
const LEARNING_MS = 7 * 24 * 60 * 60 * 1000
const MAX_BUDGET_CHANGE_PCT = 20
const ACTION_MARKER = 'ADACTION:'
const ACTION_DONE_MARKER = 'ADACTION-DONE'
const ACTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function kstDate(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : ''
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const won = (v: number | null) => (v === null ? '없음' : `${Math.round(v).toLocaleString('ko-KR')}원`)
const pct = (v: number | null) => (v === null ? '없음' : `${Math.round(v * 100)}%`)

// ── ① 데이터 ──

async function latestAdRows<T>(source: string): Promise<T[]> {
  try {
    const rows = await supabaseSelect<{ traffic_sources: unknown }>(
      'radar_snapshots',
      `brand=eq.${encodeURIComponent(BRAND)}&source=eq.${source}&order=created_at.desc&limit=1&select=traffic_sources`,
    )
    return Array.isArray(rows[0]?.traffic_sources) ? (rows[0].traffic_sources as T[]) : []
  } catch {
    return []
  }
}

async function loadLeads(): Promise<LeadRow[]> {
  try {
    const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
    return await supabaseSelect<LeadRow>('leads', `created_at=gte.${encodeURIComponent(since)}&select=*&order=created_at.desc&limit=2000`)
  } catch {
    return [] // 테이블 없음(SQL 전) — 신청 0으로 본다.
  }
}

export function adsetLockReason(a: MetaAdset, now = Date.now()): string | null {
  for (const [label, t] of [['수정', a.updatedTime], ['생성', a.createdTime]] as const) {
    const ms = Date.parse(t)
    if (Number.isFinite(ms) && now - ms < LEARNING_MS) return `학습 중(최근 7일 이내 ${label} ${kstDate(t)})`
  }
  if (a.learningStatus === 'LEARNING') return '학습 중(메타 학습 단계)'
  return null
}

function isActive(status: string, effective: string): boolean {
  return status === 'ACTIVE' && (!effective || effective === 'ACTIVE')
}

export interface AdContext {
  facts: string
  factNumbers: Set<string>
  structure: { adsets: MetaAdset[]; ads: MetaAd[] } | null
  structureNote: string | null
  ads7: AdFunnel[]
  hasMetaData: boolean
}

function statLine(s: FunnelStats): string {
  return (
    `노출 ${s.impressions === null ? '없음' : s.impressions.toLocaleString('ko-KR')}, 클릭 ${s.clicks === null ? '없음' : s.clicks.toLocaleString('ko-KR')}, ` +
    `비용 ${won(s.spend)}, 신청 ${s.leads}, 통화 ${s.calls}, 결제 ${s.purchases}, ` +
    `신청당 비용 ${won(costPer(s.spend, s.leads))}, 결제당 비용 ${won(costPer(s.spend, s.purchases))}, ROAS ${pct(roas(s.revenue, s.spend))}`
  )
}

// 순수 함수(테스트용 export) — 분석 AI가 볼 [검증된 사실]. 숫자는 전부 여기서만 나온다.
export function buildAdFacts(params: {
  leads: LeadRow[]
  metaRows: MetaAdDailyRow[]
  daangnRows: DaangnDailyRow[]
  structure: { adsets: MetaAdset[]; ads: MetaAd[] } | null
  todayKst: string
  now?: number
}): Omit<AdContext, 'structureNote'> {
  const { leads, metaRows, daangnRows, structure, todayKst } = params
  const now = params.now ?? Date.now()
  const r7 = buildAdFunnelReport({ leads, metaRows, daangnRows, days: 7, todayKst })
  const r30 = buildAdFunnelReport({ leads, metaRows, daangnRows, days: 30, todayKst })
  const lines: string[] = ['[검증된 사실 — 광고 대시보드 숫자와 리드(leads) 테이블. 이 밖의 숫자는 쓰지 않는다]']
  lines.push(`기간: 최근 7일 ${r7.from}~${r7.to} / 최근 30일 ${r30.from}~${r30.to} (둘 다 어제까지)`)
  lines.push('', '[채널별 — 최근 7일]')
  for (const c of r7.channels) lines.push(`- ${AD_CHANNEL_LABEL[c.channel]}: ${statLine(c)}`)
  lines.push('', '[채널별 — 최근 30일]')
  for (const c of r30.channels) lines.push(`- ${AD_CHANNEL_LABEL[c.channel]}: ${statLine(c)}`)

  const adsById = new Map(structure?.ads.map((a) => [a.id, a]) ?? [])
  const adsetById = new Map(structure?.adsets.map((a) => [a.id, a]) ?? [])
  const ads30 = new Map(r30.ads.map((a) => [a.adId, a]))
  const allAdIds = [...new Set([...r30.ads.map((a) => a.adId), ...(structure?.ads.map((a) => a.id) ?? [])])]
  lines.push('', '[메타 광고별 — 상태 · 광고 세트 · 최근 7일 / 최근 30일]')
  if (allAdIds.length === 0) lines.push('- (메타 광고 데이터 없음)')
  for (const id of allAdIds) {
    const live = adsById.get(id)
    const a7 = r7.ads.find((a) => a.adId === id)
    const a30 = ads30.get(id)
    const name = live?.name || a30?.adName || id
    const status = live ? `${live.status}${live.effectiveStatus && live.effectiveStatus !== live.status ? `/${live.effectiveStatus}` : ''}` : '상태 확인 불가'
    const set = live ? adsetById.get(live.adsetId) : undefined
    lines.push(
      `- 광고 ${id} "${name}" | 상태 ${status} | 광고 세트 ${live?.adsetId || '알 수 없음'}${set ? ` "${set.name}"` : ''}` +
        ` | 7일: ${a7 ? statLine(a7) : '집행 없음'} | 30일: ${a30 ? statLine(a30) : '집행 없음'}` +
        (a7 ? ` | 메타 집계 리드 7일 ${a7.metaLeads ?? 0}` : ''),
    )
  }
  lines.push('', '[광고 세트 — 예산·학습 상태]')
  if (!structure) lines.push('- (광고 세트 정보를 불러오지 못함 — 끄기·예산 제안 불가)')
  for (const s of structure?.adsets ?? []) {
    const lock = adsetLockReason(s, now)
    const budget = s.dailyBudget !== null ? `일 예산 ${won(s.dailyBudget)}` : s.lifetimeBudget !== null ? '기간 예산(일 예산 변경 불가)' : '캠페인 예산(CBO — 세트 예산 변경 불가)'
    lines.push(`- 세트 ${s.id} "${s.name}" | 상태 ${s.status} | ${budget} | ${lock ? `${lock} → 끄기·예산 변경 제안 금지` : '변경 가능'}`)
  }
  const recent = leads.filter((l) => kstDate(l.created_at) >= r30.from && kstDate(l.created_at) <= r30.to)
  lines.push('', '[리드(leads) — 최근 30일 전체]')
  lines.push(
    `- 신청 ${recent.length}, 통화 ${recent.filter((l) => l.called_at || l.paid_at).length}, 결제 ${recent.filter((l) => l.paid_at).length}, ` +
      `결제 금액 합계 ${won(recent.reduce((s, l) => s + (l.paid_at ? (l.paid_amount ?? 0) : 0), 0))}, 광고 특정 못 한 메타 신청 ${r30.unmatchedMetaLeads}`,
  )
  lines.push('', '[규칙 숫자] 예산 변경 한도 ±20%, 학습 판단 기준 최근 7일')
  const facts = lines.join('\n')
  return { facts, factNumbers: new Set(numbersIn(facts)), structure, ads7: r7.ads, hasMetaData: metaRows.length > 0 }
}

async function gatherContext(): Promise<AdContext> {
  const [leads, metaRows, daangnRows] = await Promise.all([
    loadLeads(),
    latestAdRows<MetaAdDailyRow>('meta_ads'),
    latestAdRows<DaangnDailyRow>('daangn_ads'),
  ])
  const account = process.env.META_AD_ACCOUNT_ID?.trim()
  const token = process.env.META_ACCESS_TOKEN?.trim()
  let structure: AdContext['structure'] = null
  let structureNote: string | null = null
  if (account && token) {
    try {
      structure = await fetchMetaAdStructure({ accountId: account, accessToken: token })
    } catch (err) {
      structureNote = `메타 광고 세트 정보를 못 불러와 끄기·예산 제안은 만들지 않았어요(${err instanceof Error ? err.message : String(err)}).`
    }
  } else {
    structureNote = '메타 광고 계정이 연결 전(META_AD_ACCOUNT_ID·META_ACCESS_TOKEN)이라 끄기·예산 제안은 만들지 않았어요.'
  }
  return { ...buildAdFacts({ leads, metaRows, daangnRows, structure, todayKst: kstToday() }), structureNote }
}

// ── ② 분석 ──

export interface PauseProposal {
  adId: string
  adName: string
  adsetId: string
  reason: string
  unverified: string[]
}

export interface ScaleProposal {
  adsetId: string
  adsetName: string
  changePct: number
  fromBudget: number
  toBudget: number
  reason: string
  unverified: string[]
}

export interface AdAnalysis {
  headline: string
  dataNote: string
  pauses: PauseProposal[]
  scales: ScaleProposal[]
  directions: { direction: string; reason: string; unverified: string[] }[]
  dropped: string[]
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

// 예산은 100원 단위로, 변경 폭이 ±20%를 넘지 않게 현재 예산 쪽으로 내림·올림한다.
export function nextBudget(from: number, changePct: number): number {
  const raw = from * (1 + changePct / 100)
  const rounded = changePct > 0 ? Math.floor(raw / 100) * 100 : Math.ceil(raw / 100) * 100
  return Math.max(100, rounded)
}

// 순수 함수(테스트용 export) — AI 제안을 코드 규칙으로 거른다.
export function guardAnalysis(raw: unknown, ctx: Pick<AdContext, 'structure' | 'factNumbers'>, now = Date.now()): AdAnalysis {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const dropped: string[] = []
  const adsById = new Map(ctx.structure?.ads.map((a) => [a.id, a]) ?? [])
  const adsetById = new Map(ctx.structure?.adsets.map((a) => [a.id, a]) ?? [])

  const pauses: PauseProposal[] = []
  for (const p of arr(rec.pause)) {
    const adId = str(p.adId)
    const reason = str(p.reason)
    const ad = adsById.get(adId)
    if (!ad) {
      dropped.push(`끄기 제안(광고 ${adId || '?'}) — 지금 광고 목록에 없어 뺐어요`)
      continue
    }
    if (!isActive(ad.status, ad.effectiveStatus)) {
      dropped.push(`끄기 제안 "${ad.name}" — 이미 켜져 있지 않아 뺐어요`)
      continue
    }
    const set = adsetById.get(ad.adsetId)
    const lock = set ? adsetLockReason(set, now) : '광고 세트 확인 불가'
    if (lock) {
      dropped.push(`끄기 제안 "${ad.name}" — 광고 세트가 ${lock}이라 뺐어요`)
      continue
    }
    if (pauses.some((x) => x.adId === adId)) continue
    pauses.push({ adId, adName: ad.name, adsetId: ad.adsetId, reason, unverified: unverifiedNumbers(reason, ctx.factNumbers) })
  }

  const scales: ScaleProposal[] = []
  for (const s of arr(rec.scale)) {
    const adsetId = str(s.adsetId)
    const reason = str(s.reason)
    const set = adsetById.get(adsetId)
    let change = Math.round(Number(s.changePct))
    if (!set) {
      dropped.push(`예산 제안(세트 ${adsetId || '?'}) — 광고 세트 목록에 없어 뺐어요`)
      continue
    }
    const lock = adsetLockReason(set, now)
    if (lock) {
      dropped.push(`예산 제안 "${set.name}" — ${lock}이라 뺐어요`)
      continue
    }
    if (set.dailyBudget === null) {
      dropped.push(`예산 제안 "${set.name}" — 일 예산이 아닌 세트(캠페인·기간 예산)라 뺐어요`)
      continue
    }
    if (!Number.isFinite(change) || change === 0) {
      dropped.push(`예산 제안 "${set.name}" — 변경 폭이 없어 뺐어요`)
      continue
    }
    if (Math.abs(change) > MAX_BUDGET_CHANGE_PCT) {
      dropped.push(`예산 제안 "${set.name}" ${change > 0 ? '+' : ''}${change}% → 한 번에 ±20% 규칙으로 ${change > 0 ? '+' : '-'}20%로 줄였어요`)
      change = change > 0 ? MAX_BUDGET_CHANGE_PCT : -MAX_BUDGET_CHANGE_PCT
    }
    if (scales.some((x) => x.adsetId === adsetId)) continue
    scales.push({
      adsetId,
      adsetName: set.name,
      changePct: change,
      fromBudget: set.dailyBudget,
      toBudget: nextBudget(set.dailyBudget, change),
      reason,
      unverified: unverifiedNumbers(reason, ctx.factNumbers),
    })
  }

  const directions = arr(rec.newDirections)
    .map((d) => ({ direction: str(d.direction), reason: str(d.reason) }))
    .filter((d) => d.direction)
    .slice(0, 3)
    .map((d) => ({ ...d, unverified: unverifiedNumbers(d.reason, ctx.factNumbers) }))

  return { headline: str(rec.headline), dataNote: str(rec.dataNote), pauses, scales, directions, dropped }
}

// ── ③ 문구 ──

interface ScoredSet {
  set: AdCopySet
  issues: AdCopyIssue[]
  score: { total: number; comment: string; parts: Record<string, number> } | null
  rewritten: boolean
}

function parseCopySets(raw: unknown): AdCopySet[] {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as { sets?: unknown }
  if (!Array.isArray(rec.sets)) return []
  return (rec.sets as Record<string, unknown>[])
    .map((s) => ({
      angle: str(s.angle),
      headline: str(s.headline),
      lines: Array.isArray(s.lines) ? (s.lines as unknown[]).map(str).filter(Boolean) : [],
    }))
    .filter((s) => s.headline || s.lines.length > 0)
}

function issuesText(issues: AdCopyIssue[]): string {
  return issues.map((i) => `${i.rule}: "${i.quote}" — ${i.reason}`).join(' / ')
}

// ── 실행 ──

export interface AdRunResult {
  summary: string
  reportHtml: string
  actionCount: number
  costUsd: number
}

type Usage = { input_tokens: number; output_tokens: number }

export async function runAdAgent(params: {
  apiKey: string
  instruction?: string
  deadline: number
  logId: string
  startedAt: string
  kind: string
}): Promise<AdRunResult> {
  const { apiKey, instruction, deadline, logId, startedAt, kind } = params
  let costUsd = 0
  const onUsage = (u: Usage) => {
    costUsd += estimateCostUsd(u)
  }
  const onCheapUsage = (u: Usage) => {
    // 싼 모델 단가는 대략 10분의 1 — 근무기록 비용 표시용 추정.
    costUsd += estimateCostUsd(u) / 10
  }
  const left = () => deadline - Date.now()
  const autoFixed: string[] = []
  const unresolved: string[] = []

  const ctx = await gatherContext()

  // 분석(medium) — JSON 실패 시 시간이 되면 1회 재시도.
  let analysisRaw: unknown = null
  for (let attempt = 0; attempt < 2 && analysisRaw === null; attempt++) {
    if (left() < 150_000 && attempt > 0) break
    try {
      analysisRaw = await callClaudeJson({
        apiKey,
        system: buildAdAnalysisSystem(),
        user: buildAdAnalysisUser({ facts: ctx.facts, instruction }) + (attempt > 0 ? '\n\n반드시 JSON 객체 하나만 출력하세요.' : ''),
        maxTokens: 8192,
        effort: 'medium',
        timeoutMs: Math.max(30_000, Math.min(90_000, left() - 170_000)),
        onUsage,
      })
    } catch (err) {
      if (attempt === 1) unresolved.push(`분석 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const analysis = guardAnalysis(analysisRaw ?? {}, ctx)
  if (ctx.structureNote) unresolved.push(ctx.structureNote)
  for (const d of analysis.dropped) autoFixed.push(d)
  for (const p of analysis.pauses) if (p.unverified.length) unresolved.push(`끄기 근거 "${p.adName}"에 대시보드에 없는 숫자(${p.unverified.join(', ')}) — 확인 필요`)
  for (const s of analysis.scales) if (s.unverified.length) unresolved.push(`예산 근거 "${s.adsetName}"에 대시보드에 없는 숫자(${s.unverified.join(', ')}) — 확인 필요`)
  for (const d of analysis.directions) if (d.unverified.length) unresolved.push(`소재 방향 근거에 대시보드에 없는 숫자(${d.unverified.join(', ')}) — 확인 필요`)

  // 문구(high).
  let sets: ScoredSet[] = []
  try {
    const raw = await callClaudeJson({
      apiKey,
      system: buildAdCopySystem(),
      user: buildAdCopyUser({ directions: analysis.directions.map((d) => d.direction), instruction }),
      maxTokens: 16000,
      effort: 'high',
      timeoutMs: Math.max(40_000, Math.min(130_000, left() - 60_000)),
      onUsage,
    })
    sets = parseCopySets(raw).slice(0, 5).map((set) => {
      const fixed = autoFixCopySet(set)
      if (fixed.fixed) autoFixed.push(`문구 "${fixed.set.headline}" 줄표(—)를 쉼표로`)
      return { set: fixed.set, issues: checkCopySet(fixed.set), score: null, rewritten: false }
    })
  } catch (err) {
    unresolved.push(`광고 문구 생성 실패: ${err instanceof Error ? err.message : String(err)}`)
  }

  const scoreSets = async (targets: ScoredSet[]): Promise<boolean> => {
    if (targets.length === 0 || left() < 25_000) return false
    try {
      const raw = await callClaudeJson({
        apiKey,
        model: CLAUDE_MODEL_CHEAP,
        system: buildAdCopyReviewSystem(),
        user:
          targets
            .map(
              (t, i) =>
                `#${i + 1}\n헤드라인: ${t.set.headline}\n본문:\n${t.set.lines.join('\n')}\n[코드 검사] ${t.issues.length ? issuesText(t.issues) : '걸린 것 없음'}`,
            )
            .join('\n\n') + '\n\n세트마다 채점해 JSON으로만 답하세요.',
        maxTokens: 8192,
        effort: 'medium',
        timeoutMs: Math.min(40_000, left() - 10_000),
        onUsage: onCheapUsage,
      })
      const rows = ((raw && typeof raw === 'object' ? (raw as { sets?: unknown }).sets : null) ?? []) as Record<string, unknown>[]
      for (const r of rows) {
        const idx = Number(r.index) - 1
        const t = targets[idx]
        const sc = (r.scores && typeof r.scores === 'object' ? r.scores : {}) as Record<string, unknown>
        if (!t) continue
        const parts: Record<string, number> = {}
        for (const c of AD_COPY_RUBRIC) parts[c.id] = Math.max(0, Math.min(20, Math.round(Number(sc[c.id]) || 0)))
        // 코드 검사에서 금지어가 걸린 세트는 심사 안전성 13점 이하로 맞춘다(AI가 놓쳐도).
        if (t.issues.some(isBlockingIssue)) parts.safety = Math.min(parts.safety, 13)
        t.score = { total: Object.values(parts).reduce((a, b) => a + b, 0), comment: str(r.comment), parts }
      }
      return true
    } catch {
      return false
    }
  }

  if (sets.length > 0 && !(await scoreSets(sets))) unresolved.push('문구 채점 실패 — 채점 없이 올려요(코드 금지어 검사는 했어요)')

  // 고쳐 쓰기 1회 — 금지어·형식·AI 티가 걸렸거나 85점 미만인 세트만.
  const needs = sets.filter((s) => s.issues.length > 0 || (s.score !== null && s.score.total < PASS_THRESHOLD))
  if (needs.length > 0) {
    if (left() < 100_000) {
      unresolved.push(`시간이 부족해 고쳐 쓰기를 못 했어요(대상 ${needs.length}세트)`)
    } else {
      try {
        const raw = await callClaudeJson({
          apiKey,
          system: buildAdCopySystem(),
          user: buildAdCopyUser({
            directions: analysis.directions.map((d) => d.direction),
            instruction,
            rewrite: {
              sets: needs.map((s, i) => ({
                index: i + 1,
                headline: s.set.headline,
                lines: s.set.lines,
                feedback:
                  [s.issues.length ? `코드 검사: ${issuesText(s.issues)}` : '', s.score && s.score.total < PASS_THRESHOLD ? `채점 ${s.score.total}점: ${s.score.comment}` : '']
                    .filter(Boolean)
                    .join(' / ') || '더 자연스럽게',
              })),
            },
          }),
          maxTokens: 16000,
          effort: 'high',
          timeoutMs: Math.max(40_000, Math.min(110_000, left() - 40_000)),
          onUsage,
        })
        const replacements = parseCopySets(raw)
        const candidates: ScoredSet[] = needs.map((old, i) => {
          const rep = replacements[i]
          if (!rep) return old
          const fixed = autoFixCopySet({ ...rep, angle: rep.angle || old.set.angle })
          return { set: fixed.set, issues: checkCopySet(fixed.set), score: null, rewritten: true }
        })
        const fresh = candidates.filter((c) => c.rewritten)
        await scoreSets(fresh)
        needs.forEach((old, i) => {
          const cand = candidates[i]
          if (!cand.rewritten) return
          const oldBlocking = old.issues.some(isBlockingIssue)
          const newBlocking = cand.issues.some(isBlockingIssue)
          const better =
            (oldBlocking && !newBlocking) ||
            (!newBlocking && (old.score === null || cand.score === null || cand.score.total >= old.score.total))
          if (better) {
            sets[sets.indexOf(old)] = cand
            autoFixed.push(`문구 "${old.set.headline}" 고쳐 씀${old.score ? ` (${old.score.total}점 → ${cand.score?.total ?? '채점 없음'})` : ''}`)
          }
        })
      } catch (err) {
        unresolved.push(`문구 고쳐 쓰기 실패: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // 고쳐 써도 금지어가 남은 세트는 올리지 않는다.
  const kept = sets.filter((s) => !s.issues.some(isBlockingIssue))
  for (const s of sets.filter((x) => x.issues.some(isBlockingIssue))) {
    unresolved.push(`문구 "${s.set.headline}" — 금지 표현이 남아 결재함에서 뺐어요(${issuesText(s.issues.filter(isBlockingIssue))})`)
  }
  for (const s of kept) {
    const soft = s.issues.filter((i) => !isBlockingIssue(i))
    if (soft.length) unresolved.push(`문구 "${s.set.headline}" — ${issuesText(soft)}`)
  }

  // ④ 결재함 — 리포트 1건 + 실행 대기 항목.
  const nowIso = new Date().toISOString()
  const scored = kept.filter((s) => s.score)
  const avg = scored.length ? Math.round(scored.reduce((a, s) => a + (s.score?.total ?? 0), 0) / scored.length) : null
  const passed = kept.length > 0 && scored.length === kept.length && kept.every((s) => (s.score?.total ?? 0) >= PASS_THRESHOLD)
  const reportHtml = buildAdReportHtml({ analysis, sets: kept, autoFixed, unresolved, hasMetaData: ctx.hasMetaData })
  const scoreLabel = avg === null ? (kept.length ? '채점 없음 · 문구 정상' : '문구 없음') : `문구 평균 ${avg}점`
  const mmdd = kstToday().slice(5).replace('-', '/')

  for (const p of analysis.pauses) {
    await insertActionItem({
      logId,
      title: `[실행 대기] 광고 끄기 · ${p.adName}`,
      action: { type: 'pause', adId: p.adId, adName: p.adName },
      bodyHtml: `<p><b>광고 끄기</b> — ${esc(p.adName)} <span style="color:#888">(광고 ${esc(p.adId)})</span></p><p>근거: ${esc(p.reason)}</p>${unverifiedWarning(p.unverified)}`,
      createdAt: nowIso,
    })
  }
  for (const s of analysis.scales) {
    const sign = s.changePct > 0 ? '+' : ''
    await insertActionItem({
      logId,
      title: `[실행 대기] 예산 ${sign}${s.changePct}% · ${s.adsetName} (${won(s.fromBudget)} → ${won(s.toBudget)})`,
      action: { type: 'budget', adsetId: s.adsetId, adsetName: s.adsetName, changePct: s.changePct },
      bodyHtml: `<p><b>광고 세트 일 예산 ${sign}${s.changePct}%</b> — ${esc(s.adsetName)}: ${won(s.fromBudget)} → ${won(s.toBudget)}</p><p>근거: ${esc(s.reason)}</p>${unverifiedWarning(s.unverified)}`,
      createdAt: nowIso,
    })
  }
  await supabaseInsert('approval_queue', {
    id: makeId(),
    agent: AGENT,
    brand: BRAND,
    title: `애드 주간 광고 리포트 (${mmdd})`,
    content_html: reportHtml,
    passed,
    score_label: scoreLabel,
    created_at: nowIso,
    status: 'pending',
    source_work_log_id: logId,
  })
  const actionCount = analysis.pauses.length + analysis.scales.length
  const summary =
    `${analysis.headline || '이번 주 광고 리포트'} · 끄기 ${analysis.pauses.length} · 예산 ${analysis.scales.length} · 문구 ${kept.length}세트` +
    (avg !== null ? `(평균 ${avg}점)` : '')
  await supabaseInsert('work_log', {
    id: logId,
    agent: AGENT,
    brand: BRAND,
    kind,
    status: passed && unresolved.length === 0 ? 'done' : 'attention',
    status_label: passed && unresolved.length === 0 ? '완료' : '확인 필요',
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    note: summary,
    detail_html: reportHtml,
    cost_usd: Number(costUsd.toFixed(4)),
  })
  return { summary, reportHtml, actionCount, costUsd }
}

// ── 결재함 HTML ──

function buildAdReportHtml(params: {
  analysis: AdAnalysis
  sets: ScoredSet[]
  autoFixed: string[]
  unresolved: string[]
  hasMetaData: boolean
}): string {
  const { analysis, sets, autoFixed, unresolved, hasMetaData } = params
  const li = (items: string[]) => (items.length ? `<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p style="color:#888">없음</p>')
  const pauseItems = analysis.pauses.map((p) => `<b>${esc(p.adName)}</b> — ${esc(p.reason)}`)
  const scaleItems = analysis.scales.map(
    (s) => `<b>${esc(s.adsetName)}</b> 일 예산 ${s.changePct > 0 ? '+' : ''}${s.changePct}% (${won(s.fromBudget)} → ${won(s.toBudget)}) — ${esc(s.reason)}`,
  )
  const dirItems = analysis.directions.map((d) => `<b>${esc(d.direction)}</b> — ${esc(d.reason)}`)
  const copy = sets
    .map(
      (s, i) =>
        `<div style="margin:8px 0;padding:10px 12px;border:1px solid #eee;border-radius:10px">` +
        `<p style="margin:0 0 4px;font-size:12px;color:#888">${i + 1}. ${esc(s.set.angle || '소재')}${s.score ? ` · ${s.score.total}점` : ''}</p>` +
        `<p style="margin:0 0 4px;font-weight:700">${esc(s.set.headline)}</p>` +
        s.set.lines.map((l) => `<p style="margin:0">${esc(l)}</p>`).join('') +
        `</div>`,
    )
    .join('')
  return (
    `<div>` +
    `<p style="font-size:15px;font-weight:700">${esc(analysis.headline || '이번 주 광고 리포트')}</p>` +
    (analysis.dataNote ? `<p style="color:#888">${esc(analysis.dataNote)}</p>` : '') +
    (!hasMetaData ? '<p style="color:#888">아직 메타 광고 숫자가 없어요(레이더가 매일 07:50에 수집).</p>' : '') +
    `<h4>끌 광고</h4>${li(pauseItems)}` +
    `<h4>늘릴 광고 (광고 세트 예산)</h4>${li(scaleItems)}` +
    `<h4>새로 만들 소재 방향</h4>${li(dirItems)}` +
    (pauseItems.length + scaleItems.length > 0
      ? '<p style="padding:8px 10px;background:#fff4ec;border-radius:8px">끄기·예산 변경은 결재함의 <b>[실행 대기]</b> 항목을 승인할 때만 메타에 반영돼요. 이 리포트를 승인해도 광고는 바뀌지 않아요.</p>'
      : '') +
    `<h4>광고 문구 (${sets.length}세트)</h4>${copy || '<p style="color:#888">이번엔 올릴 문구가 없어요.</p>'}` +
    `<div style="margin-top:12px;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:13px">` +
    `<p style="margin:0 0 4px;font-weight:700">발행 전 점검</p>` +
    `<p style="margin:0">자동으로 고친 것</p>${li(autoFixed.map(esc))}` +
    `<p style="margin:0">못 고친 것 · 확인 필요</p>${li(unresolved.map(esc))}` +
    `</div></div>`
  )
}

// ── 실행 대기 항목 + 승인 시 실행 ──

function unverifiedWarning(nums: string[]): string {
  return nums.length
    ? `<p style="color:#d6336c">⚠ 근거의 숫자(${esc(nums.join(', '))})가 광고 대시보드에 없어요 — 대시보드 광고 카드와 맞는지 확인하고 승인해 주세요.</p>`
    : ''
}

type AdAction =
  | { type: 'pause'; adId: string; adName: string }
  | { type: 'budget'; adsetId: string; adsetName: string; changePct: number }

function encodeAction(a: AdAction): string {
  return `<!--${ACTION_MARKER}${Buffer.from(JSON.stringify(a), 'utf8').toString('base64')}-->`
}

export function decodeAction(html: string): AdAction | null {
  const m = html.match(/<!--ADACTION:([A-Za-z0-9+/=]+)-->/)
  if (!m) return null
  try {
    const a = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) as AdAction
    return a.type === 'pause' || a.type === 'budget' ? a : null
  } catch {
    return null
  }
}

async function insertActionItem(p: { logId: string; title: string; action: AdAction; bodyHtml: string; createdAt: string }): Promise<void> {
  await supabaseInsert('approval_queue', {
    id: makeId(),
    agent: AGENT,
    brand: BRAND,
    title: p.title,
    content_html:
      `<div>${p.bodyHtml}<p style="color:#888;font-size:12px">승인하면 그 순간 메타에 반영돼요(실행 직전에 학습 중 여부와 현재 예산을 다시 확인). 반려하면 아무것도 바뀌지 않아요. 7일이 지나면 실행하지 않아요.</p></div>` +
      encodeAction(p.action),
    passed: true,
    score_label: '실행 대기',
    created_at: p.createdAt,
    status: 'pending',
    source_work_log_id: p.logId,
  })
}

export async function executeAdAction(approvalId: string): Promise<{ ok: boolean; message: string; contentHtml?: string }> {
  const rows = await supabaseSelect<{ id: string; status: string; content_html: string; created_at: string; title: string }>(
    'approval_queue',
    `id=eq.${encodeURIComponent(approvalId)}&select=id,status,content_html,created_at,title&limit=1`,
  )
  const row = rows[0]
  if (!row) return { ok: false, message: '결재함 항목을 찾지 못했어요.' }
  if (row.content_html.includes(ACTION_DONE_MARKER)) return { ok: true, message: '이미 실행된 항목이에요.', contentHtml: row.content_html }
  if (row.status !== 'pending') return { ok: false, message: '대기 중인 항목만 실행할 수 있어요.' }
  const action = decodeAction(row.content_html)
  if (!action) return { ok: false, message: '실행할 광고 변경 정보가 없는 항목이에요.' }
  if (Date.now() - Date.parse(row.created_at) > ACTION_MAX_AGE_MS) {
    return { ok: false, message: '7일이 지난 제안이라 실행하지 않았어요. 다음 주 리포트를 기다려 주세요.' }
  }
  const token = process.env.META_ACCESS_TOKEN?.trim()
  if (!token) return { ok: false, message: 'META_ACCESS_TOKEN이 없어 실행할 수 없어요.' }

  let result: string
  try {
    if (action.type === 'pause') {
      const ad = await fetchMetaAd(action.adId, token)
      const set = ad.adsetId ? await fetchMetaAdset(ad.adsetId, token) : null
      const lock = set ? adsetLockReason(set) : null
      if (lock) return { ok: false, message: `광고 세트가 ${lock}이라 지금은 끄지 않았어요.` }
      if (ad.status === 'PAUSED') result = `"${ad.name || action.adName}"은 이미 꺼져 있었어요.`
      else {
        await pauseMetaAd(action.adId, token)
        result = `"${ad.name || action.adName}" 광고를 껐어요.`
      }
    } else {
      const set = await fetchMetaAdset(action.adsetId, token)
      const lock = adsetLockReason(set)
      if (lock) return { ok: false, message: `광고 세트가 ${lock}이라 지금은 예산을 바꾸지 않았어요.` }
      if (set.dailyBudget === null) return { ok: false, message: '일 예산이 아닌 세트라 예산을 바꿀 수 없어요.' }
      const change = Math.max(-MAX_BUDGET_CHANGE_PCT, Math.min(MAX_BUDGET_CHANGE_PCT, action.changePct))
      const to = nextBudget(set.dailyBudget, change)
      await setMetaAdsetDailyBudget(action.adsetId, to, token)
      result = `"${set.name || action.adsetName}" 일 예산을 ${won(set.dailyBudget)} → ${won(to)}(${change > 0 ? '+' : ''}${change}%)로 바꿨어요.`
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabaseInsert('work_log', {
      id: makeId(),
      agent: AGENT,
      brand: BRAND,
      kind: '광고 변경 실행',
      status: 'error',
      status_label: '오류',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      note: `실행 실패 — ${row.title}`,
      detail_html: esc(message),
    }).catch(() => undefined)
    return { ok: false, message: `메타 반영 실패: ${message}` }
  }

  const nowIso = new Date().toISOString()
  const contentHtml =
    row.content_html +
    `<p style="padding:8px 10px;background:#e6f6ec;border-radius:8px">✅ ${esc(result)} (${kstDate(nowIso)} 실행)</p><!--${ACTION_DONE_MARKER}-->`
  await supabaseUpdate('approval_queue', `id=eq.${encodeURIComponent(approvalId)}`, {
    status: 'approved',
    reviewed_at: nowIso,
    content_html: contentHtml,
  })
  await supabaseInsert('work_log', {
    id: makeId(),
    agent: AGENT,
    brand: BRAND,
    kind: '광고 변경 실행',
    status: 'done',
    status_label: '완료',
    started_at: nowIso,
    ended_at: nowIso,
    note: result,
    detail_html: esc(row.title),
  }).catch(() => undefined)
  return { ok: true, message: result, contentHtml }
}

// ── 매주 월요일 자동(주 1회) ──

function thisMondayKst(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const day = d.getUTCDay() // 0=일
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export async function runAdWeeklyOnce(apiKey: string, startedMs: number): Promise<string> {
  const monday = thisMondayKst()
  try {
    const done = await supabaseSelect<{ id: string }>(
      'work_log',
      `agent=eq.${AGENT}&kind=eq.${encodeURIComponent(AD_WEEKLY_KIND)}&started_at=gte.${monday}T00:00:00%2B09:00&select=id&limit=1`,
    )
    if (done.length > 0) return '애드: 이번 주 리포트 이미 있음 — 건너뜀'
  } catch {
    // 확인 실패해도 진행(주 1회 크론이라 중복 위험 낮음).
  }
  const logId = makeId()
  const startedAt = new Date(startedMs).toISOString()
  try {
    const r = await runAdAgent({ apiKey, deadline: startedMs + 280_000, logId, startedAt, kind: AD_WEEKLY_KIND })
    return `애드: ${r.summary}`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabaseInsert('work_log', {
      id: logId,
      agent: AGENT,
      brand: BRAND,
      kind: AD_WEEKLY_KIND,
      status: 'error',
      status_label: '오류',
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      note: '주간 리포트 실패',
      detail_html: esc(message),
    }).catch(() => undefined)
    return `애드: 실패 (${message})`
  }
}

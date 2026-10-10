import type { IncomingMessage, ServerResponse } from 'node:http'
import { estimateCostUsd } from '../../src/lib/budgetGuard.js'
import { researchMarketResilient } from '../../src/agents/runBrain.js'
import { analyzeBlogBrain } from '../../src/agents/runMajalnamBlog.js'
import { MAJALNAM_CORE_KEYWORDS } from '../../src/agents/majalnamBlogPrompts.js'
import { BRAND_CONTEXT, BRAND_CHANNELS, BRAND_RESEARCH_FOCUS, type Brand } from '../../src/types/brand.js'
import { kstNow, kstDateKey, YOUTUBE_ACTIVE } from '../../src/lib/weeklySchedule.js'
import { supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, haltIfPaused, sendText, sendJson } from '../_lib/cronHandler.js'
import { collectBlogBrainData } from '../_lib/naverBlogData.js'
import {
  blogBrainWeekStatus,
  contentBrainWeekStatus,
  countBrainRunsThisWeek,
  getLatestBlogBrain,
  getRecentMainKeywords,
  insertBrainReport,
  kstIsoWeekKey,
  saveBlogBrainReport,
} from '../_lib/blogStore.js'

// 웹서치를 포함한 리서치는 오래 걸린다 — 스트리밍 호출 + Fluid compute 최대치 800초.
// blog-brain은 DEADLINE_MS(760초) 안에서 남은 시간을 보며 재시도한다(수집 → 측정 → 분석).
// content-brain은 웹서치 최대 560초 + 폴백 60초. 둘은 병렬이라 800초 안에 끝난다.
export const maxDuration = 800
const DEADLINE_MS = 760_000

// 재설계 지시서(2026-10): 브레인을 2개로 분리하되, Vercel Hobby 함수 12개 한도 때문에
// 새 함수를 만들지 않고 이 크론 하나에서 둘 다 돌린다(대표님 결정: "1번 OK, 문제없게만").
//   · blog-brain   — 네이버 블로그 상위노출 분석 전용. 마잘남만(대표님 결정).
//   · content-brain — 유튜브·스레드 소재 전용(블로그 로직 조사 제거). 마잘남만 — 업메리는
//                     블로그만 운영해 유튜브·스레드 소재가 필요 없다.
//
// ★ 실패해도 그 주 안에 끝나게(대표님: "실패하지 말라고 해야지") — 이 크론은 "매일" 09:00 KST
// (00:00 UTC)에 깨어나서, 이번 주 분석이 아직 없을 때만 일한다. 월요일에 실패하면 화요일,
// 화요일도 실패하면 수요일… 성공할 때까지 매일 다시 시도하고, 이미 있으면 확인만 하고
// 끝낸다(Claude 호출 0 = 비용 0). 테이블이 아직 없어(SQL 실행 전) 확인이 안 되면 월요일에만
// 돈다(확인 없이 매일 돌면 비용만 7배).
const BLOG_BRAIN_BRANDS: Brand[] = ['마잘남']

function isKstMonday(): boolean {
  return kstNow().getUTCDay() === 1
}

// 주당 시도 상한(대표님 결정: 최악의 경우 비용도 묶어둔다) — 성공·실패 무관하게 실제로 돈
// 횟수가 이만큼 차면 그 주는 더 시도하지 않고 지난주 리서치를 유지, 다음 주 월요일에 다시 시작.
// 정상 1회 + 재시도 최대 2회 → 최악의 추가 비용 약 $0.5/주.
const MAX_RUNS_PER_WEEK = 3
const BLOG_BRAIN_KIND = 'blog-brain 주간 분석(자동)'
const CONTENT_BRAIN_KIND = 'content-brain 주간 리서치(자동)'

// 이번 주에 더 돌려도 되는지 — 횟수를 못 세면(근무기록 조회 실패) 비용 안전을 위해 월요일에만.
async function underWeeklyCap(brand: Brand, kind: string): Promise<{ ok: boolean; runs: number | null }> {
  const runs = await countBrainRunsThisWeek(brand, kind)
  if (runs === null) return { ok: isKstMonday(), runs }
  return { ok: runs < MAX_RUNS_PER_WEEK, runs }
}
// content-brain은 유튜브 소재 전용이라 유튜브 일시정지(YOUTUBE_ACTIVE=false) 동안은 돌지 않는다.
const CONTENT_BRAIN_BRANDS: Brand[] = YOUTUBE_ACTIVE ? ['마잘남'] : []

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function logBrain(row: {
  brand: Brand
  kind: string
  ok: boolean
  costUsd: number
  note: string
  detailHtml: string
}): Promise<void> {
  const nowIso = new Date().toISOString()
  await supabaseInsert('work_log', {
    id: makeId(),
    agent: 'brain',
    brand: row.brand,
    kind: row.kind,
    // 하드 에러가 아니라 결과가 없으면 '보류'로만 — 아침에 빨간 "오류"를 안 보게(무중단 원칙).
    status: row.ok ? 'done' : 'attention',
    status_label: row.ok ? '완료' : '보류',
    started_at: nowIso,
    ended_at: nowIso,
    cost_usd: row.costUsd,
    note: row.note,
    detail_html: row.detailHtml,
  })
}

// ── blog-brain: 수집 코드 → 3번 분석 → research_block 저장 ──
async function runBlogBrain(apiKey: string, brand: Brand, startedAt: number): Promise<string> {
  let costUsd = 0
  const onUsage = (usage: { input_tokens: number; output_tokens: number }) => {
    costUsd += estimateCostUsd(usage)
  }
  const week = kstIsoWeekKey()
  const deadline = startedAt + DEADLINE_MS
  try {
    // 이번 주 것이 이미 있으면 확인만 하고 끝(비용 0). 확인 불가(테이블 없음)면 월요일에만.
    const status = await blogBrainWeekStatus(brand, week)
    if (status === 'done') return `${brand} blog-brain: ${week} 이미 완료 — 건너뜀`
    if (status === 'unknown' && !isKstMonday()) return `${brand} blog-brain: 저장 테이블 확인 불가 — 월요일에만 실행`
    const cap = await underWeeklyCap(brand, BLOG_BRAIN_KIND)
    if (!cap.ok) {
      return `${brand} blog-brain: 이번 주 시도 ${cap.runs ?? '?'}/${MAX_RUNS_PER_WEEK}회 소진 — 지난주 리서치 유지, 다음 주 월요일 재개`
    }
    const tryNo = (cap.runs ?? 0) + 1
    const retryNote = ` · 이번 주 ${tryNo}/${MAX_RUNS_PER_WEEK}번째 시도${
      tryNo < MAX_RUNS_PER_WEEK ? '' : '(마지막 — 실패하면 다음 주 월요일 재개)'
    }`

    // 타깃 키워드 = 최근 4주 메인 키워드 + 고정 핵심 키워드(중복 제거, 최근 것 우선).
    const [recent, lastWeek] = await Promise.all([getRecentMainKeywords(brand), getLatestBlogBrain(brand, week)])
    const keywords = [...new Set([...recent, ...MAJALNAM_CORE_KEYWORDS])]
    const collected = await collectBlogBrainData({
      apiKey,
      keywords,
      todayKst: kstDateKey(kstNow()),
      onUsage,
      // 분석에 최소 3분을 남기고 수집·측정을 끝낸다.
      deadline: deadline - 180_000,
      fallbackPosts: lastWeek?.raw_metrics?.posts?.map((p) => ({ keyword: p.keyword, rank: p.rank, title: p.title, url: p.url })),
    })

    // 수집 실패(상위글·공지 둘 다 없음) → 분석하지 않고 지난주 research_block 유지(지시서 7번),
    // 저장을 안 했으니 내일 09:00에 자동으로 다시 시도한다.
    if (collected.posts.length === 0 && collected.notices.length === 0) {
      await logBrain({
        brand,
        kind: BLOG_BRAIN_KIND,
        ok: false,
        costUsd,
        note: `수집 실패 — 지난주 리서치 유지, 내일 자동 재시도 · ${collected.note}${retryNote}`,
        detailHtml: collected.note,
      })
      return `${brand} blog-brain: 수집 실패(지난주 유지, 내일 재시도)`
    }

    const result = await analyzeBlogBrain({
      apiKey,
      notices: collected.notices,
      posts: collected.posts,
      lastWeekResult: lastWeek?.result ? JSON.stringify(lastWeek.result) : undefined,
      onUsage,
      deadline,
    })
    if (!result) {
      await logBrain({
        brand,
        kind: BLOG_BRAIN_KIND,
        ok: false,
        costUsd,
        note: `분석 실패 — 지난주 리서치 유지, 내일 자동 재시도 · ${collected.note}${retryNote}`,
        detailHtml: collected.note,
      })
      return `${brand} blog-brain: 분석 실패(지난주 유지, 내일 재시도)`
    }

    const saved = await saveBlogBrainReport({
      week,
      brand,
      rawMetrics: { mode: collected.mode, note: collected.note, notices: collected.notices, posts: collected.posts },
      result,
    })
    const overrideHtml = result.ruleOverrides.length
      ? result.ruleOverrides.map((o) => `- [${o.basis}] ${o.rule}: ${o.current} → ${o.new}`).join('<br/>')
      : '없음'
    await logBrain({
      brand,
      kind: BLOG_BRAIN_KIND,
      ok: saved,
      costUsd,
      note: `${week} · ${collected.note}${saved ? '' : ' · ⚠️저장 실패(blog_brain_reports 테이블 확인 필요)'}`,
      detailHtml:
        `<b>리서치 블록(글쓰기에 자동 삽입)</b><br/>${result.researchBlock.replace(/\n/g, '<br/>')}` +
        `<br/><br/><b>규칙 변경</b><br/>${overrideHtml}` +
        `<br/><br/><b>상위글 수치</b> 글자 ${result.metrics.chars.median}(${result.metrics.chars.range}) · ` +
        `사진 ${result.metrics.photos.median}(${result.metrics.photos.range}) · ` +
        `소제목 ${result.metrics.headings.median}(${result.metrics.headings.range})`,
    })
    return `${brand} blog-brain: ${saved ? '저장' : '저장 실패'} · ${collected.note}`
  } catch (err) {
    // 안전망 — 크론 전체를 500으로 죽이지 않는다. 예외로 끝나도 "1회 시도"로 근무기록에 남겨
    // 주당 상한이 우회되지 않게 한다(기록 자체가 실패해도 크론은 계속).
    const message = err instanceof Error ? err.message : String(err)
    await logBrain({
      brand,
      kind: BLOG_BRAIN_KIND,
      ok: false,
      costUsd,
      note: `예외로 중단 — 지난주 리서치 유지 · ${message}`,
      detailHtml: message,
    }).catch(() => undefined)
    return `${brand} blog-brain: 실패 (${message})`
  }
}

// ── content-brain: 유튜브·스레드 소재(작업 각도·반박·레퍼런스) ──
async function runContentBrain(apiKey: string, brand: Brand): Promise<string> {
  const topic = `이번 주 ${brand} 유튜브·스레드 소재(작업물 공개형)`
  // 주 1회만 — 이번 주(월요일 이후) 자동 리서치가 이미 있으면 건너뛴다(매일 깨어나도 비용 0).
  const status = await contentBrainWeekStatus(brand)
  if (status === 'done') return `${brand} content-brain: 이번 주 이미 완료 — 건너뜀`
  if (status === 'unknown' && !isKstMonday()) return `${brand} content-brain: 확인 불가 — 월요일에만 실행`
  const cap = await underWeeklyCap(brand, CONTENT_BRAIN_KIND)
  if (!cap.ok) return `${brand} content-brain: 이번 주 시도 ${cap.runs ?? '?'}/${MAX_RUNS_PER_WEEK}회 소진 — 다음 주 월요일 재개`
  try {
    let costUsd = 0
    // researchMarketResilient는 예외를 던지지 않는다(웹서치 실패 → 지식 기반 → 빈 리포트).
    const research = await researchMarketResilient({
      apiKey,
      topic,
      context: `[브랜드]\n${BRAND_CONTEXT[brand]}\n운영 채널: ${BRAND_CHANNELS[brand].join(', ')}`,
      focus: BRAND_RESEARCH_FOCUS[brand],
      maxSearches: 8,
      onUsage: (usage) => {
        costUsd += estimateCostUsd(usage)
      },
    })
    const report = research.report
    const counts = {
      findings: report.findings.length,
      angles: report.workAngles?.length ?? 0,
      rebuttals: report.rebuttals?.length ?? 0,
      refs: report.references?.length ?? 0,
    }
    // "빈 리포트 금지" 규칙은 지시서 7번으로 삭제 — 대신 아무것도 없으면 저장하지 않고
    // 직전 리포트를 그대로 둔다(빈 값으로 덮지 않게).
    const hasAny = counts.findings + counts.angles + counts.rebuttals + counts.refs > 0
    const summaryNote = `발견 ${counts.findings} · 작업각도 ${counts.angles} · 반박 ${counts.rebuttals} · 레퍼런스 ${counts.refs} · ${
      research.usedWebSearch ? '✅웹검색' : '⚠️검색실패→지식기반'
    }`
    const list = (title: string, items: string[]) => (items.length ? `<b>${title}</b><br/>${items.join('<br/>')}<br/><br/>` : '')
    await logBrain({
      brand,
      kind: CONTENT_BRAIN_KIND,
      ok: research.ok && hasAny,
      costUsd,
      note: research.ok ? summaryNote : research.note,
      detailHtml: hasAny
        ? list('작업 영상 각도', (report.workAngles ?? []).map((w) => `- ${w.problem} → ${w.showInVideo}`)) +
          list('반박형 소재', (report.rebuttals ?? []).map((r) => `- ${r.myth} → ${r.counterDirection}`)) +
          list(
            '레퍼런스 구조',
            (report.references ?? []).map((r) => `- ${r.titleType} / ${r.thumbnailPattern} / ${r.hookPattern} (${r.source})`),
          ) +
          list('발견 사항', report.findings.map((f) => `- [${f.source}] ${f.insight}`)) +
          `<b>요약</b><br/>${report.summary}`
        : research.note,
    })
    if (research.ok && hasAny) {
      await insertBrainReport({
        brand,
        topic,
        findings: report.findings,
        summary: report.summary,
        recommendations: report.recommendations,
        extras: { workAngles: report.workAngles, rebuttals: report.rebuttals, references: report.references },
      })
    }
    return `${brand} content-brain: ${research.ok ? summaryNote : '일시 실패(다음 주기 재시도)'}`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 예외로 끝나도 1회 시도로 기록(주당 상한 우회 방지).
    await logBrain({ brand, kind: CONTENT_BRAIN_KIND, ok: false, costUsd: 0, note: `예외로 중단 · ${message}`, detailHtml: message }).catch(
      () => undefined,
    )
    return `${brand} content-brain: 저장 실패 (${message})`
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  if (haltIfPaused(res)) return
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }
  // 둘은 서로 의존이 없어 병렬(순차면 크론 시간 한도를 넘긴다).
  const startedAt = Date.now()
  const results = await Promise.all([
    ...BLOG_BRAIN_BRANDS.map((b) => runBlogBrain(apiKey, b, startedAt)),
    ...CONTENT_BRAIN_BRANDS.map((b) => runContentBrain(apiKey, b)),
  ])
  sendJson(res, 200, { ok: true, results })
}

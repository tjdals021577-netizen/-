import type { IncomingMessage, ServerResponse } from 'node:http'
import { estimateCostUsd } from '../../src/lib/budgetGuard.js'
import { researchMarketResilient } from '../../src/agents/runBrain.js'
import { analyzeBlogBrain } from '../../src/agents/runMajalnamBlog.js'
import { MAJALNAM_CORE_KEYWORDS } from '../../src/agents/majalnamBlogPrompts.js'
import { BRAND_CONTEXT, BRAND_CHANNELS, BRAND_RESEARCH_FOCUS, type Brand } from '../../src/types/brand.js'
import { kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'
import { supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, haltIfPaused, sendText, sendJson } from '../_lib/cronHandler.js'
import { collectBlogBrainData } from '../_lib/naverBlogData.js'
import {
  getLatestBlogBrain,
  getRecentMainKeywords,
  insertBrainReport,
  kstIsoWeekKey,
  saveBlogBrainReport,
} from '../_lib/blogStore.js'

// 웹서치를 포함한 리서치는 오래 걸린다 — 스트리밍 호출 + Fluid compute 최대치 800초.
// blog-brain·content-brain을 병렬로 돌리므로 벽시계는 더 긴 쪽 하나(content-brain
// 웹서치 최대 560초 + 폴백 / blog-brain 수집 300초 + 측정 + 분석 180초)라 800초 안에 끝난다.
export const maxDuration = 800

// 재설계 지시서(2026-10): 브레인을 2개로 분리하되, Vercel Hobby 함수 12개 한도 때문에
// 새 함수를 만들지 않고 이 크론 하나에서 둘 다 돌린다(대표님 결정: "1번 OK, 문제없게만").
//   · blog-brain   — 네이버 블로그 상위노출 분석 전용. 마잘남만(대표님 결정).
//   · content-brain — 유튜브·스레드 소재 전용(블로그 로직 조사 제거). 마잘남만 — 업메리는
//                     블로그만 운영해 유튜브·스레드 소재가 필요 없다.
// 매주 월요일 09:00 KST(월 00:00 UTC) — vercel.json.
const BLOG_BRAIN_BRANDS: Brand[] = ['마잘남']
const CONTENT_BRAIN_BRANDS: Brand[] = ['마잘남']

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
async function runBlogBrain(apiKey: string, brand: Brand): Promise<string> {
  let costUsd = 0
  const onUsage = (usage: { input_tokens: number; output_tokens: number }) => {
    costUsd += estimateCostUsd(usage)
  }
  const week = kstIsoWeekKey()
  try {
    // 타깃 키워드 = 최근 4주 메인 키워드 + 고정 핵심 키워드(중복 제거, 최근 것 우선).
    const recent = await getRecentMainKeywords(brand)
    const keywords = [...new Set([...recent, ...MAJALNAM_CORE_KEYWORDS])]
    const collected = await collectBlogBrainData({
      apiKey,
      keywords,
      todayKst: kstDateKey(kstNow()),
      onUsage,
    })

    // 수집 실패(상위글·공지 둘 다 없음) → 분석하지 않고 지난주 research_block 유지(지시서 7번).
    if (collected.posts.length === 0 && collected.notices.length === 0) {
      await logBrain({
        brand,
        kind: 'blog-brain 주간 분석(자동)',
        ok: false,
        costUsd,
        note: `수집 실패 — 지난주 리서치 유지 · ${collected.note}`,
        detailHtml: collected.note,
      })
      return `${brand} blog-brain: 수집 실패(지난주 유지)`
    }

    const lastWeek = await getLatestBlogBrain(brand, week)
    const result = await analyzeBlogBrain({
      apiKey,
      notices: collected.notices,
      posts: collected.posts,
      lastWeekResult: lastWeek?.result ? JSON.stringify(lastWeek.result) : undefined,
      onUsage,
    })
    if (!result) {
      await logBrain({
        brand,
        kind: 'blog-brain 주간 분석(자동)',
        ok: false,
        costUsd,
        note: `분석 실패 — 지난주 리서치 유지 · ${collected.note}`,
        detailHtml: collected.note,
      })
      return `${brand} blog-brain: 분석 실패(지난주 유지)`
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
      kind: 'blog-brain 주간 분석(자동)',
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
    // 안전망 — 크론 전체를 500으로 죽이지 않는다.
    return `${brand} blog-brain: 실패 (${err instanceof Error ? err.message : String(err)})`
  }
}

// ── content-brain: 유튜브·스레드 소재(작업 각도·반박·레퍼런스) ──
async function runContentBrain(apiKey: string, brand: Brand): Promise<string> {
  const topic = `이번 주 ${brand} 유튜브·스레드 소재(작업물 공개형)`
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
      kind: 'content-brain 주간 리서치(자동)',
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
    return `${brand} content-brain: 저장 실패 (${err instanceof Error ? err.message : String(err)})`
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
  const results = await Promise.all([
    ...BLOG_BRAIN_BRANDS.map((b) => runBlogBrain(apiKey, b)),
    ...CONTENT_BRAIN_BRANDS.map((b) => runContentBrain(apiKey, b)),
  ])
  sendJson(res, 200, { ok: true, results })
}

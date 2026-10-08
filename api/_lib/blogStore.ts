// 마잘남 블로그 재설계용 Supabase 읽기/쓰기 + 브레인 리포트 공용 헬퍼 — 서버 전용.
//
// ★ 새 테이블(blog_keywords·blog_brain_reports)과 brain_reports.extras 컬럼은
// 대표님이 SQL을 실행해야 생긴다. 그 전에도 크론·팀채팅이 절대 깨지지 않게, 모든
// 접근을 try/catch로 감싸 "없으면 빈 값"으로 동작한다(쓰기는 조용히 건너뜀).
import { supabaseSelect, supabaseInsert } from './supabaseAdmin.js'
import { kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'
import { READER_STAGES, type BlogBrainResult, type BlogKeywordResult, type ReaderStage } from '../../src/types/blogBrain.js'
import type { Brand } from '../../src/types/brand.js'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── 날짜(KST) ──

// kstNow()는 +9h 시프트된 Date라 UTC 게터로 읽어야 KST 값이 된다(weeklySchedule 규칙).
export function kstDaysAgoKey(days: number): string {
  return kstDateKey(new Date(kstNow().getTime() - days * 86_400_000))
}

export function kstMondayKey(): string {
  const now = kstNow()
  const sinceMonday = (now.getUTCDay() + 6) % 7
  return kstDateKey(new Date(now.getTime() - sinceMonday * 86_400_000))
}

// ISO 주차 키(예: 2026-W41) — blog_brain_reports 1주 1행.
export function kstIsoWeekKey(): string {
  const now = kstNow()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3) // 그 주의 목요일
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    )
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// ── blog_keywords ──

export async function getRecentMainKeywords(brand: Brand, days = 28): Promise<string[]> {
  try {
    const rows = await supabaseSelect<{ main_keyword: string | null }>(
      'blog_keywords',
      `brand=eq.${encodeURIComponent(brand)}&date=gte.${kstDaysAgoKey(days)}&order=date.desc&select=main_keyword`,
    )
    return [...new Set(rows.map((r) => (r.main_keyword ?? '').trim()).filter(Boolean))]
  } catch {
    return []
  }
}

export async function getWeekStageCounts(brand: Brand): Promise<Record<ReaderStage, number>> {
  const counts: Record<ReaderStage, number> = { '①': 0, '②': 0, '③': 0, '④': 0 }
  try {
    const rows = await supabaseSelect<{ reader_stage: string | null }>(
      'blog_keywords',
      `brand=eq.${encodeURIComponent(brand)}&date=gte.${kstMondayKey()}&select=reader_stage`,
    )
    for (const r of rows) {
      const s = (r.reader_stage ?? '') as ReaderStage
      if (READER_STAGES.includes(s)) counts[s] += 1
    }
  } catch {
    // 테이블 없음 → 전부 0.
  }
  return counts
}

export async function saveBlogKeyword(params: { date: string; brand: Brand; keyword: BlogKeywordResult }): Promise<void> {
  const { date, brand, keyword } = params
  const base = {
    id: makeId(),
    date,
    brand,
    main_keyword: keyword.mainKeyword,
    sub_keywords: keyword.subKeywords,
    reader_stage: keyword.readerStage,
    search_volume: keyword.searchVolume,
    created_at: new Date().toISOString(),
  }
  try {
    await supabaseInsert('blog_keywords', { ...base, reason: keyword.reason })
  } catch {
    // reason 컬럼 없이 만든 테이블이면 그것만 빼고 한 번 더 — 그래도 실패하면
    // (SQL 실행 전) 조용히 건너뜀(글쓰기는 계속).
    try {
      await supabaseInsert('blog_keywords', base)
    } catch {
      // 테이블 없음.
    }
  }
}

// ── blog_brain_reports ──

export interface BlogBrainRow {
  week: string
  result: BlogBrainResult | null
  research_block: string | null
  // 수집 원자료 — 이번 주 수집이 전부 실패하면 지난주 상위글 URL을 다시 측정하는 데 쓴다.
  raw_metrics?: { posts?: { keyword: string; rank: number; title: string; url: string }[] } | null
}

// 가장 최근 리포트(글쓰기용) — excludeWeek를 주면 그 주를 뺀 최신(=지난주 리포트용).
export async function getLatestBlogBrain(brand: Brand, excludeWeek?: string): Promise<BlogBrainRow | undefined> {
  try {
    const rows = await supabaseSelect<BlogBrainRow>(
      'blog_brain_reports',
      `brand=eq.${encodeURIComponent(brand)}&order=created_at.desc&limit=3&select=week,result,research_block,raw_metrics`,
    )
    return rows.find((r) => !excludeWeek || r.week !== excludeWeek)
  } catch {
    return undefined
  }
}

// 이번 주 분석이 이미 끝났는지 — 브레인 크론은 매일 09:00에 깨어나서 이번 주 것이
// 없을 때만 일한다(월요일에 실패해도 화~일에 자동 재시도, 이미 있으면 비용 0으로 건너뜀).
// 'unknown' = 테이블이 아직 없어(SQL 실행 전) 확인 불가 → 호출부가 월요일에만 돌린다
// (확인이 안 되는데 매일 돌리면 비용만 7배가 되므로).
export type WeekStatus = 'done' | 'missing' | 'unknown'

export async function blogBrainWeekStatus(brand: Brand, week: string): Promise<WeekStatus> {
  try {
    const rows = await supabaseSelect<{ id: string }>(
      'blog_brain_reports',
      `brand=eq.${encodeURIComponent(brand)}&week=eq.${encodeURIComponent(week)}&select=id&limit=1`,
    )
    return rows.length > 0 ? 'done' : 'missing'
  } catch {
    return 'unknown'
  }
}

// content-brain(유튜브 소재)도 같은 방식 — 이번 주 월요일 이후 자동 리서치 행이 있으면 끝난 것.
export async function contentBrainWeekStatus(brand: Brand): Promise<WeekStatus> {
  try {
    const rows = await supabaseSelect<{ id: string }>(
      'brain_reports',
      `brand=eq.${encodeURIComponent(brand)}&created_at=gte.${kstMondayKey()}T00:00:00%2B09:00` +
        `&topic=like.${encodeURIComponent('이번 주*')}&select=id&limit=1`,
    )
    return rows.length > 0 ? 'done' : 'missing'
  } catch {
    return 'unknown'
  }
}

export async function saveBlogBrainReport(params: {
  week: string
  brand: Brand
  rawMetrics: unknown
  result: BlogBrainResult
}): Promise<boolean> {
  const { week, brand, rawMetrics, result } = params
  try {
    // 같은 주에 다시 돌려도 1주 1행(id 고정 + merge-duplicates upsert).
    await supabaseInsert('blog_brain_reports', {
      id: `${week}-${brand}`,
      week,
      brand,
      raw_metrics: rawMetrics,
      result,
      research_block: result.researchBlock,
      created_at: new Date().toISOString(),
    })
    return true
  } catch {
    return false
  }
}

// ── brain_reports(content-brain) — extras(workAngles 등) 컬럼 유무 방어 ──

export interface BrainExtras {
  workAngles?: { problem: string; showInVideo: string }[]
  rebuttals?: { myth: string; counterDirection: string }[]
  references?: { titleType: string; thumbnailPattern: string; hookPattern: string; source: string }[]
}

export interface BrainReportRow {
  topic: string
  summary: string
  recommendations: string[]
  findings: { source: string; insight: string }[]
  extras?: BrainExtras | null
}

const BRAIN_COLS = 'topic,summary,recommendations,findings'

export async function fetchLatestBrainReport(brand: Brand): Promise<BrainReportRow | undefined> {
  const q = (cols: string) => `brand=eq.${encodeURIComponent(brand)}&order=created_at.desc&limit=1&select=${cols}`
  try {
    return (await supabaseSelect<BrainReportRow>('brain_reports', q(`${BRAIN_COLS},extras`)))[0]
  } catch {
    // extras 컬럼이 아직 없으면(SQL 실행 전) 예전 컬럼만으로.
    try {
      return (await supabaseSelect<BrainReportRow>('brain_reports', q(BRAIN_COLS)))[0]
    } catch {
      return undefined
    }
  }
}

export async function insertBrainReport(row: {
  brand: Brand
  topic: string
  findings: { source: string; insight: string }[]
  summary: string
  recommendations: string[]
  extras: BrainExtras
}): Promise<void> {
  const base = {
    id: makeId(),
    brand: row.brand,
    topic: row.topic,
    findings: row.findings,
    summary: row.summary,
    recommendations: row.recommendations,
    created_at: new Date().toISOString(),
  }
  try {
    await supabaseInsert('brain_reports', { ...base, extras: row.extras })
  } catch {
    // extras 컬럼이 없으면 그것만 빼고 저장 — 리포트 자체를 잃지 않게.
    await supabaseInsert('brain_reports', base)
  }
}

// 라이터(업메리)·리믹서·버즈가 참고할 프롬프트 텍스트. extras가 있으면 유튜브
// "작업물 공개형" 소재(작업 각도·반박 소재·레퍼런스 구조)를 함께 붙인다.
export function formatBrainFindings(report: BrainReportRow | undefined): string | undefined {
  if (!report) return undefined
  const findingsText = (report.findings ?? [])
    .slice(0, 8)
    .map((f) => `- [${f.source}] ${f.insight.slice(0, 240)}`)
    .join('\n')
  const recoText = (report.recommendations ?? []).slice(0, 5).join(' / ')
  const ex = report.extras ?? {}
  const sections: string[] = []
  if (ex.workAngles?.length) {
    sections.push(`이번 주 작업 영상 각도(사업자들이 막히는 문제 → 영상에서 보여줄 수정 포인트):\n${ex.workAngles
      .map((w) => `- ${w.problem} → ${w.showInVideo}`)
      .join('\n')}`)
  }
  if (ex.rebuttals?.length) {
    sections.push(`반박형 소재(유행 통념 → 반박 방향):\n${ex.rebuttals.map((r) => `- ${r.myth} → ${r.counterDirection}`).join('\n')}`)
  }
  if (ex.references?.length) {
    sections.push(`레퍼런스 구조(제목 유형 / 썸네일 구성 / 첫 10초 후킹 — 구조만, 원문 복사 금지):\n${ex.references
      .map((r) => `- ${r.titleType} / ${r.thumbnailPattern} / ${r.hookPattern}${r.source ? ` (${r.source})` : ''}`)
      .join('\n')}`)
  }
  return `주제: ${report.topic}\n요약: ${(report.summary ?? '').slice(0, 400)}\n${findingsText}${
    recoText ? `\n추천 액션: ${recoText}` : ''
  }${sections.length ? `\n\n${sections.join('\n\n')}` : ''}`
}

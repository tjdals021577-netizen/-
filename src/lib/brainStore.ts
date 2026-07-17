import type { Brand } from '../types/brand.js'
import { syncToSupabase } from './remoteSync.js'

export interface BrainFinding {
  source: string
  insight: string
}

export interface BrainReportRecord {
  id: string
  brand: Brand
  topic: string
  findings: BrainFinding[]
  summary: string
  recommendations: string[]
  createdAt: string
}

const STORAGE_KEY = 'ai-ops:brain-reports'
const MAX_PER_BRAND = 10

function readAll(): BrainReportRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(records: BrainReportRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // localStorage 사용 불가 시 조용히 무시 — best-effort 로컬 저장
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 브레인이 조사한 결과를 라이터·버즈·리믹서가 다시 찾아 쓸 수 있게 구조화해서
// 저장한다(work_log의 detailHtml은 사람이 읽기용 HTML이라 재활용하기 어려움).
export function saveBrainReport(params: {
  brand: Brand
  topic: string
  findings: BrainFinding[]
  summary: string
  recommendations: string[]
}): BrainReportRecord {
  const record: BrainReportRecord = {
    id: makeId(),
    ...params,
    createdAt: new Date().toISOString(),
  }
  const all = readAll()
  const sameBrand = all.filter((r) => r.brand === params.brand)
  const otherBrand = all.filter((r) => r.brand !== params.brand)
  writeAll([record, ...sameBrand.slice(0, MAX_PER_BRAND - 1), ...otherBrand])
  syncToSupabase('brain_reports', record)
  return record
}

export function getLatestBrainReport(brand: Brand): BrainReportRecord | undefined {
  return readAll()
    .filter((r) => r.brand === brand)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
}

// 프롬프트에 그대로 넣을 수 있는 텍스트 블록으로 변환.
export function formatBrainFindingsForPrompt(report: BrainReportRecord | undefined): string | undefined {
  if (!report) return undefined
  // 브레인 리서치가 많고 길면(특히 마잘남 — 스레드·브랜딩·마케팅·블로그 로직까지
  // 조사) 프롬프트가 비대해져 응답이 잘리는 원인이 됐다. 상위 8건, 각 항목
  // 240자 이내로 잘라 넣는다(방향성 참고엔 충분).
  const findingsText = report.findings
    .slice(0, 8)
    .map((f) => `- [${f.source}] ${f.insight.slice(0, 240)}`)
    .join('\n')
  return `리서치 주제: ${report.topic}
${findingsText || '(발견 사항 없음)'}
요약: ${report.summary.slice(0, 400)}
추천 액션: ${report.recommendations.slice(0, 5).join(' / ') || '(없음)'}`
}

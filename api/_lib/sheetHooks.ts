// 구글시트를 "웹에 게시(CSV)"한 공개 URL에서 후킹·CTA 레퍼런스를 읽어온다.
// (샌드박스는 docs.google.com 접속이 막혀 있어 로컬 검증엔 못 쓰지만, 배포된
// Vercel 함수는 공개 CSV를 그대로 가져올 수 있다.)

import { supabaseSelect } from './supabaseAdmin.js'
import { formatHookReference } from '../../src/agents/hookReference.js'
import type { ReferenceHook } from '../../src/types/hook.js'

export interface ParsedHook {
  hook: string
  industry?: string
  structure?: string
  cta?: string
}

// 크론(스레드·대행 생성)이 Supabase reference_hooks를 읽어 프롬프트용 후킹 레퍼런스
// 블록으로 만들어준다. 후킹이 없거나 조회 실패면 빈 문자열(그냥 진행).
export async function fetchHookReferenceBlock(count = 15): Promise<string> {
  try {
    const rows = await supabaseSelect<Record<string, unknown>>('reference_hooks', 'select=*&limit=500')
    const hooks: ReferenceHook[] = rows
      .map((r) => ({
        id: String(r.id ?? ''),
        hook: String(r.hook ?? ''),
        industry: typeof r.industry === 'string' ? r.industry : undefined,
        structure: typeof r.structure === 'string' ? r.structure : undefined,
        cta: typeof r.cta === 'string' ? r.cta : undefined,
        createdAt: String(r.updated_at ?? ''),
      }))
      .filter((h) => h.hook)
    return formatHookReference(hooks, count)
  } catch {
    return ''
  }
}

// 따옴표·쉼표·줄바꿈이 섞인 CSV를 안전하게 파싱한다(외부 라이브러리 없이).
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  // 마지막 필드/행 마무리
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// 헤더 이름으로 열을 찾되(후킹/업종/구조/CTA), 못 찾으면 위치로 폴백한다
// (0=후킹, 1=업종, 2=구조, 3=CTA). 어떤 시트 레이아웃이 와도 최소한 첫 열은
// 후킹으로 취급한다.
function findColumn(header: string[], keywords: string[]): number {
  for (let i = 0; i < header.length; i++) {
    const h = header[i].trim().toLowerCase()
    if (keywords.some((k) => h.includes(k))) return i
  }
  return -1
}

function mapRows(rows: string[][]): ParsedHook[] {
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  const looksLikeHeader = header.some((h) =>
    /후킹|hook|업종|industry|구조|cta|왜/i.test(h),
  )
  const hookIdx = looksLikeHeader ? findColumn(header, ['후킹', 'hook', '문장', '제목']) : -1
  const industryIdx = looksLikeHeader ? findColumn(header, ['업종', 'industry', '분야', '카테고리']) : -1
  const structIdx = looksLikeHeader ? findColumn(header, ['구조', '왜', 'structure', '유형', '분석']) : -1
  const ctaIdx = looksLikeHeader ? findColumn(header, ['cta', '행동', '유도']) : -1

  const dataRows = looksLikeHeader ? rows.slice(1) : rows
  const hooks: ParsedHook[] = []
  for (const r of dataRows) {
    const get = (idx: number, fallback: number): string | undefined => {
      const v = (idx >= 0 ? r[idx] : r[fallback])?.trim()
      return v || undefined
    }
    const hook = get(hookIdx, 0)
    if (!hook) continue // 빈 행 건너뜀
    hooks.push({
      hook,
      industry: get(industryIdx, 1),
      structure: get(structIdx, 2),
      cta: get(ctaIdx, 3),
    })
  }
  return hooks
}

export interface SheetFetchResult {
  hooks: ParsedHook[]
  // 시트별 진단 — 문제 원인(탭 하나만 내보냄·열 위치 오인 등)을 바로 파악하려고.
  perSheet: { httpOk: boolean; status: number; rawRows: number; parsed: number }[]
}

export async function fetchHooksFromCsvUrls(urls: string[]): Promise<SheetFetchResult> {
  const all: ParsedHook[] = []
  const perSheet: SheetFetchResult['perSheet'] = []
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        perSheet.push({ httpOk: false, status: res.status, rawRows: 0, parsed: 0 })
        continue
      }
      const text = await res.text()
      const rows = parseCsv(text)
      const parsed = mapRows(rows)
      all.push(...parsed)
      perSheet.push({ httpOk: true, status: res.status, rawRows: rows.length, parsed: parsed.length })
    } catch {
      perSheet.push({ httpOk: false, status: 0, rawRows: 0, parsed: 0 })
    }
  }
  return { hooks: all, perSheet }
}

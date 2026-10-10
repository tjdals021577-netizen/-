import type { Brand } from '../types/brand.js'
import type { CalendarChannel } from '../types/calendar.js'
import { syncToSupabase } from './remoteSync.js'

// 코치가 분석한 "지난 콘텐츠 성과 피드백"을 저장해뒀다가, 다음 글 기획 때
// 프롬프트에 주입하기 위한 저장소. 블로그(네이버 통계 캡처 분석)가 대표적이며,
// 채널을 구분해 저장하므로 유튜브 등 다른 채널로도 재사용할 수 있다.
export interface ContentFeedback {
  id: string
  brand: Brand
  channel: CalendarChannel
  context: string
  summary: string
  nextSteps: string[]
  createdAt: string
}

const STORAGE_KEY = 'ai-ops:content-feedback'
const MAX_ENTRIES = 60

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}
const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

function readAll(): ContentFeedback[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries: ContentFeedback[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // localStorage 사용 불가 시 조용히 무시 — best-effort 저장
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function saveContentFeedback(params: {
  brand: Brand
  channel: CalendarChannel
  context: string
  summary: string
  nextSteps: string[]
}): ContentFeedback {
  const entry: ContentFeedback = {
    id: makeId(),
    brand: params.brand,
    channel: params.channel,
    context: params.context,
    summary: params.summary,
    nextSteps: params.nextSteps,
    createdAt: new Date().toISOString(),
  }
  const entries = readAll()
  entries.unshift(entry)
  writeAll(entries)
  syncToSupabase('content_feedback', entry)
  return entry
}

// 브라우저(작가 화면)에서 다음 글 기획에 넣을 최근 피드백을 텍스트로 만든다.
// 최근 것 위주 2건까지만 — 너무 많이 넣으면 토큰만 늘고 방향이 흐려진다.
export function formatRecentFeedbackForPrompt(
  brand: Brand,
  channel: CalendarChannel,
  limit = 2,
): string | undefined {
  const recent = readAll()
    .filter((e) => e.brand === brand && e.channel === channel)
    .slice(0, limit)
  if (recent.length === 0) return undefined
  return recent
    .map((e) => {
      const steps = e.nextSteps.length > 0 ? `\n다음 액션: ${e.nextSteps.join(' / ')}` : ''
      const when = e.createdAt.slice(0, 10)
      return `- (${when}${e.context ? ` · ${e.context}` : ''}) ${e.summary}${steps}`
    })
    .join('\n')
}

function fromSupabaseRow(row: Record<string, unknown>): ContentFeedback {
  return {
    id: String(row.id ?? ''),
    brand: (row.brand as Brand) ?? '마잘남',
    channel: (row.channel as CalendarChannel) ?? 'blog',
    context: String(row.context ?? ''),
    summary: String(row.summary ?? ''),
    nextSteps: Array.isArray(row.next_steps)
      ? (row.next_steps as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }
}

// 다른 기기/크론이 저장한 피드백까지 함께 보려고 화면 진입 시 당겨온다.
export async function syncContentFeedbackFromSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/content_feedback?select=*&order=created_at.desc&limit=${MAX_ENTRIES}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return
    const rows = (await res.json()) as Record<string, unknown>[]
    if (rows.length === 0) return
    const remote = rows.map(fromSupabaseRow)
    const remoteIds = new Set(remote.map((e) => e.id))
    const localOnly = readAll().filter((e) => !remoteIds.has(e.id))
    writeAll([...remote, ...localOnly])
  } catch {
    // 네트워크 실패는 조용히 무시
  }
}

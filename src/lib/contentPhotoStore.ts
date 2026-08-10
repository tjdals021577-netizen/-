import type { ContentPhoto } from '../types/contentPhoto.js'
import type { Brand } from '../types/brand.js'
import { syncToSupabase } from './remoteSync.js'
import { getScheduledSlots, kstNow, kstDateKey, addDaysKst } from './weeklySchedule.js'

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}

const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

const STORAGE_KEY = 'ai-ops:content-photos'
const MAX_ITEMS = 60

function readAll(): ContentPhoto[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: ContentPhoto[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 용량 초과 등으로 저장 실패해도 조용히 무시 — best-effort 로컬 저장
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function listContentPhotos(): ContentPhoto[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getContentPhotos(date: string, brand: Brand): ContentPhoto[] {
  return readAll().filter((p) => p.date === date && p.brand === brand)
}

export function addContentPhoto(params: {
  date: string
  brand: Brand
  label: string
  imageBase64: string
  mediaType: ContentPhoto['mediaType']
}): ContentPhoto {
  const item: ContentPhoto = {
    id: makeId(),
    date: params.date,
    brand: params.brand,
    channel: 'blog',
    label: params.label,
    imageBase64: params.imageBase64,
    mediaType: params.mediaType,
    createdAt: new Date().toISOString(),
  }
  writeAll([item, ...readAll()].slice(0, MAX_ITEMS))
  syncToSupabase('content_photos', item)
  return item
}

export function deleteContentPhoto(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id))
}

function fromSupabaseRow(row: Record<string, unknown>): ContentPhoto {
  return {
    id: String(row.id ?? ''),
    date: String(row.date ?? ''),
    brand: (row.brand as Brand) ?? '마잘남',
    channel: 'blog',
    label: String(row.label ?? ''),
    imageBase64: String(row.image_base64 ?? ''),
    mediaType: (row.media_type as ContentPhoto['mediaType']) ?? 'image/jpeg',
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }
}

export async function syncContentPhotosFromSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/content_photos?select=*&order=created_at.desc&limit=200`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return
    const rows = (await res.json()) as Record<string, unknown>[]
    if (rows.length === 0) return
    const remote = rows.map(fromSupabaseRow)
    const remoteIds = new Set(remote.map((p) => p.id))
    const localOnly = readAll().filter((p) => !remoteIds.has(p.id))
    writeAll([...remote, ...localOnly])
  } catch {
    // 네트워크 실패는 조용히 무시 — 로컬 데이터로 계속 동작
  }
}

export interface UpcomingBlogSlot {
  date: string
  brand: Brand
  hasPhotos: boolean
}

// 블로그 탭의 사진 업로드 섹션에 "앞으로 며칠간 블로그 예정일 중 사진이 아직
// 없는 것"을 보여주기 위한 헬퍼 — 요일 고정 스케줄(주간 스케줄 크론과 동일
// 로직)을 그대로 재사용한다.
export function getUpcomingBlogSlots(daysAhead = 7): UpcomingBlogSlot[] {
  const photos = readAll()
  const slots: UpcomingBlogSlot[] = []
  let cursor = kstNow()
  for (let i = 0; i < daysAhead; i++) {
    const dateKey = kstDateKey(cursor)
    for (const slot of getScheduledSlots(cursor)) {
      if (slot.channel !== 'blog') continue
      const hasPhotos = photos.some((p) => p.date === dateKey && p.brand === slot.brand)
      slots.push({ date: dateKey, brand: slot.brand, hasPhotos })
    }
    cursor = addDaysKst(cursor, 1)
  }
  return slots
}

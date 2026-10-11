import type { ReferenceImage, ReferenceMediaType } from '../types/reference.js'
import { syncToSupabase } from './remoteSync.js'

const STORAGE_KEY = 'ai-ops:reference-library'
// base64 이미지는 용량이 커서 localStorage(5~10MB)엔 몇 장밖에 못 들어간다.
// 그래서 "원본"은 Supabase(reference_images)에 두고, 브라우저는 세션 메모리
// 캐시(memCache)로 들고 있는다 — 20~40장을 넣어도 localStorage 용량 초과로
// 사라지지 않는다(실제로 겪은 문제). localStorage는 오프라인용 best-effort 캐시.
const MAX_ITEMS = 500

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}
const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

// Supabase에서 당겨온 세션 메모리 캐시. null이면 아직 안 불러온 상태(그땐 localStorage).
let memCache: ReferenceImage[] | null = null

function readLocal(): ReferenceImage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocal(items: ReferenceImage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 용량 초과 등으로 저장 실패해도 무시 — 원본은 Supabase에 있고 memCache가 읽기를 담당.
  }
}

function readAll(): ReferenceImage[] {
  return memCache ?? readLocal()
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function listReferences(): ReferenceImage[] {
  return [...readAll()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function addReference(params: {
  label: string
  imageBase64: string
  mediaType: ReferenceMediaType
}): ReferenceImage {
  const item: ReferenceImage = {
    id: makeId(),
    label: params.label,
    imageBase64: params.imageBase64,
    mediaType: params.mediaType,
    createdAt: new Date().toISOString(),
  }
  const next = [item, ...readAll()].slice(0, MAX_ITEMS)
  memCache = next // 메모리 캐시에 즉시 반영(용량 무제한)
  writeLocal(next) // best-effort 로컬 캐시(초과하면 조용히 실패)
  syncToSupabase('reference_images', item) // 원본은 Supabase에 저장
  return item
}

export function deleteReference(id: string): void {
  const next = readAll().filter((r) => r.id !== id)
  memCache = next
  writeLocal(next)
}

export function getReferencesByIds(ids: string[]): ReferenceImage[] {
  const idSet = new Set(ids)
  return readAll().filter((r) => idSet.has(r.id))
}

function fromRow(row: Record<string, unknown>): ReferenceImage {
  const mt = String(row.media_type ?? 'image/png')
  const mediaType: ReferenceMediaType =
    mt === 'image/jpeg' || mt === 'image/webp' ? (mt as ReferenceMediaType) : 'image/png'
  return {
    id: String(row.id ?? ''),
    label: String(row.label ?? ''),
    imageBase64: String(row.image_base64 ?? ''),
    mediaType,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }
}

// Supabase에 저장된 레퍼런스 이미지를 세션 메모리로 당겨온다 — localStorage 용량을
// 넘겨 로컬엔 저장 못 한 이미지(수십 장)도 여기서 되살아난다. 화면 진입 시 1회 호출.
export async function syncReferencesFromSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reference_images?select=*&order=created_at.desc&limit=${MAX_ITEMS}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return
    const rows = (await res.json()) as Record<string, unknown>[]
    const remote = rows.map(fromRow).filter((r) => r.id && r.imageBase64)
    // 원격에 없고 로컬에만 있는(아직 동기화 전) 항목은 유지해서 합친다.
    const remoteIds = new Set(remote.map((r) => r.id))
    const localOnly = readLocal().filter((r) => !remoteIds.has(r.id))
    memCache = [...remote, ...localOnly].slice(0, MAX_ITEMS)
    writeLocal(memCache)
  } catch {
    // 네트워크 실패는 무시 — 기존 캐시로 계속 동작
  }
}

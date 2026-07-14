import type { ReferenceImage, ReferenceMediaType } from '../types/reference.js'
import { syncToSupabase } from './remoteSync.js'

const STORAGE_KEY = 'ai-ops:reference-library'
// base64 이미지는 용량이 크다 — localStorage 5~10MB 한도를 넘기지 않도록
// 개수를 제한한다. Supabase 연결 시엔 전체가 서버에도 남지만, 이 앱은
// 아직 로컬을 원본으로 쓰는 구조라 브라우저별 한도가 실질적인 상한이다.
const MAX_ITEMS = 40

function readAll(): ReferenceImage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: ReferenceImage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 용량 초과 등으로 저장 실패해도 조용히 무시 — 레퍼런스는 best-effort 로컬 저장
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function listReferences(): ReferenceImage[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
  writeAll([item, ...readAll()].slice(0, MAX_ITEMS))
  syncToSupabase('reference_images', item)
  return item
}

export function deleteReference(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id))
}

export function getReferencesByIds(ids: string[]): ReferenceImage[] {
  const idSet = new Set(ids)
  return readAll().filter((r) => idSet.has(r.id))
}

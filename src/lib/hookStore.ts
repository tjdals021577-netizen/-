import type { ReferenceHook } from '../types/hook.js'

// 크론(api/cron/hooks.ts)이 구글시트 CSV → Supabase reference_hooks에 저장한 것을
// 브라우저에서 읽어온다(anon 키, 읽기 전용). 화면 진입 시 한 번 당겨와 캐시하고,
// 스레드 위원회(버즈)·대행이 글 쓸 때 이 후킹 레퍼런스를 프롬프트에 주입한다.
const CACHE_KEY = 'ai-ops:reference-hooks'

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}
const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

function readCache(): ReferenceHook[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function getReferenceHooks(): ReferenceHook[] {
  return readCache()
}

function fromRow(row: Record<string, unknown>): ReferenceHook {
  return {
    id: String(row.id ?? ''),
    hook: String(row.hook ?? ''),
    industry: typeof row.industry === 'string' ? row.industry : undefined,
    structure: typeof row.structure === 'string' ? row.structure : undefined,
    cta: typeof row.cta === 'string' ? row.cta : undefined,
    createdAt: String(row.updated_at ?? new Date().toISOString()),
  }
}

// 설정 화면의 "지금 시트에서 후킹 불러오기" 버튼용 — 서버 함수(api/cron/hooks)를
// 앱 비밀번호로 호출해 즉시 구글시트 → Supabase 동기화를 돌리고, 그 결과를
// 브라우저 캐시에도 반영한다. (샌드박스와 달리 배포된 서버는 구글에 접속 가능)
export async function triggerHookSyncNow(): Promise<{ ok: boolean; message: string }> {
  const password = import.meta.env.VITE_APP_PASSWORD
  try {
    const res = await fetch('/api/cron/hooks', {
      method: 'GET',
      headers: password ? { 'X-App-Password': password } : {},
    })
    // 401 등은 본문이 JSON이 아닌 평문("Unauthorized")이라 먼저 텍스트로 읽는다.
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, message: `실패 (상태 ${res.status}) ${text.slice(0, 200)}` }
    }
    let data: { ok?: boolean; saved?: number; sheets?: number; note?: string; error?: string }
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, message: `응답을 이해하지 못했어요: ${text.slice(0, 200)}` }
    }
    if (data.note) return { ok: true, message: data.note }
    if (data.error) return { ok: false, message: data.error }
    // 서버에 저장됐으면 브라우저 캐시도 새로고침한다.
    await syncReferenceHooksFromSupabase()
    return { ok: true, message: `시트 ${data.sheets ?? 0}개에서 후킹 ${data.saved ?? 0}건을 불러왔어요.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function syncReferenceHooksFromSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reference_hooks?select=*&limit=500`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
    if (!res.ok) return
    const rows = (await res.json()) as Record<string, unknown>[]
    const hooks = rows.map(fromRow).filter((h) => h.hook)
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(hooks))
    } catch {
      // 용량 초과 등은 조용히 무시 — best-effort 캐시
    }
  } catch {
    // 네트워크 실패는 조용히 무시 — 기존 캐시로 계속 동작
  }
}

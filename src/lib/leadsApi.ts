// 대시보드 → /api/radar-refresh(앱 비밀번호) 리드 호출 공용 — 리드 카드(LeadsPanel)·광고 카드(AdsPanel)가 같이 쓴다.
// leads 테이블은 공개 키로 읽기 금지라 반드시 서버를 거친다. 리드는 화면 상태로만 들고 브라우저 저장소에 남기지 않는다.
import type { LeadRow } from '../types/lead'

export type LeadListResponse =
  | { ok: true; leads: LeadRow[]; pixelId: string | null; capiConfigured: boolean }
  | { ok: false; tableMissing: true; pixelId: string | null; capiConfigured: boolean }

export async function callLeadsApi<T>(body: object): Promise<T> {
  const password = import.meta.env.VITE_APP_PASSWORD
  const res = await fetch('/api/radar-refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(password ? { 'X-App-Password': password } : {}) },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error || `서버 오류 (${res.status})`)
  return data as T
}

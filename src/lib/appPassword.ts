// 배포 전 최소한의 접근 제한 — 진짜 로그인/인증이 아니라 "링크를 아는
// 사람만" 걸러내는 수준의 장치다(비밀번호는 프론트엔드 번들에 그대로
// 보이므로 진짜 보안이 필요하면 Phase 4 백엔드에서 다시 처리해야 한다).
// VITE_APP_PASSWORD가 설정 안 돼 있으면 게이트 자체가 꺼진 채로
// 동작한다 — 로컬 개발/테스트 중에는 아무 영향이 없다.
const CONFIGURED_PASSWORD: string | undefined = import.meta.env.VITE_APP_PASSWORD
const UNLOCK_KEY = 'ai-ops:unlocked'

export function isPasswordGateEnabled(): boolean {
  return !!CONFIGURED_PASSWORD
}

export function isUnlocked(): boolean {
  if (!isPasswordGateEnabled()) return true
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1'
  } catch {
    return false
  }
}

export function tryUnlock(password: string): boolean {
  if (password !== CONFIGURED_PASSWORD) return false
  try {
    sessionStorage.setItem(UNLOCK_KEY, '1')
  } catch {
    // 세션스토리지 사용 불가 시에도 이번 렌더링에서는 통과시킨다(best-effort)
  }
  return true
}

// Vercel의 Node.js 런타임은 서버리스 함수를 Web 표준 Request/Response가 아니라
// Node 고전 방식 (req: IncomingMessage, res: ServerResponse)로 호출한다(실제로 겪은
// 문제 — req.headers.get이 함수가 아니라는 에러로 크론이 전부 500 났었음). 그래서
// 크론 4개가 공통으로 쓰는 인증 체크 + 응답 전송을 여기 한 곳에 모아둔다.
import type { IncomingMessage, ServerResponse } from 'node:http'

export function requireCronAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401
    res.end('Unauthorized')
    return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────
// 멈춤 / 진행 스위치 (대표님용)
// 대표님이 앱을 안 쓰는 동안 자동 크론이 API를 태우지 않게 "멈춤"으로 둔다.
// 멈춤이면 자동 크론(블로그·스레드·대행·브레인·모닝·레이더)이 인증 직후 즉시
// 종료돼 Claude·외부 API를 전혀 호출하지 않는다(=비용 거의 0). "진행"하면
// 원래대로 매일 자동 실행된다.
//
// 켜고 끄는 방법(둘 중 편한 것):
//  ① 코드: 아래 PAUSED_DEFAULT를 false로 바꿔 푸시(배포) → 다시 자동 실행.
//  ② Vercel 환경변수 AUTOMATION_PAUSED = "1"(멈춤) / "0"(진행) → 코드 기본값보다
//     우선한다(재배포 없이 다음 크론 실행부터 반영).
const PAUSED_DEFAULT = true

export function isAutomationPaused(): boolean {
  const env = process.env.AUTOMATION_PAUSED
  if (env === '1' || env === 'true') return true
  if (env === '0' || env === 'false') return false
  return PAUSED_DEFAULT
}

// 크론 핸들러에서 requireCronAuth 직후 호출한다 — 멈춤이면 아무 일도 하지 않고
// 200으로 담백하게 끝낸다(Vercel 크론 로그에 실패가 아니라 "건너뜀"으로 남게).
export function haltIfPaused(res: ServerResponse): boolean {
  if (isAutomationPaused()) {
    sendJson(res, 200, { ok: true, paused: true, note: '자동화 멈춤 상태 — 건너뜀(API 호출 안 함)' })
    return true
  }
  return false
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status
  res.end(text)
}

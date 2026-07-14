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

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status
  res.end(text)
}

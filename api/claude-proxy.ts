// 브라우저가 더 이상 Anthropic API 키를 직접 갖고 있지 않게 하기 위한 중계
// 엔드포인트(2026-07-14부터) — 예전에는 각자 브라우저에 BYOK 키를 저장했는데,
// 사파리 프라이빗 모드/저장공간 자동 삭제 등으로 "들어갈 때마다 키가 없어진다"는
// 문제가 반복됐다(실제로 겪은 문제). 이제 서버에 이미 있는 ANTHROPIC_API_KEY로
// 이 함수가 대신 호출해준다 — 프론트는 Anthropic SDK 요청 바디를 그대로 여기로
// 보내기만 하면 된다(src/lib/claude.ts의 createMessage가 브라우저에서 자동으로
// 이 경로를 탄다).
//
// 이 앱은 진짜 로그인이 없고 PasswordGate도 프론트엔드 번들에 비밀번호가 그대로
// 보이는 수준의 약한 게이트라(appPassword.ts 주석 참고), 완전한 인증은 아니지만
// 같은 비밀번호를 헤더로 요구해서 최소한의 필터링은 해둔다. 그리고 진짜 방어선은
// 아래 일일 예산 캡 — 누가 URL을 알아내서 마구 호출해도 하루 $5를 넘기면 자동으로
// 막힌다(budgetGuard.ts와 동일한 한도, 서버에서 Supabase work_log 합계로 재확인).
import type { IncomingMessage, ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'
import { supabaseSelect } from './_lib/supabaseAdmin.js'
import { sendJson, sendText } from './_lib/cronHandler.js'

// 웹서치·긴 채점 등 280초까지 걸리는 호출이 플랫폼 기본 시간제한에 잘리지 않게,
// 이 함수의 최대 실행 시간을 Vercel 상한(300초)으로 명시한다.
export const maxDuration = 300

const DAILY_BUDGET_USD = 5
// 처음엔 170초였는데, 브라우저 쪽(src/lib/claude.ts)은 기본 260초까지 기다리는
// 반면 프록시가 먼저 170초에 끊어버려서 — 웹서치 블로그 생성·긴 채점처럼
// 170초를 넘는 호출이 전부 504로 실패하는 문제가 실제로 있었다(팀채팅 수동
// 지시 라이터가 반복적으로 오류났던 원인). Vercel 함수 자체 제한(300초)보다
// 약간 짧은 280초로 늘려서, 끊는 주체가 프록시가 아니라 클라이언트(260초)가
// 되도록 한다.
const REQUEST_TIMEOUT_MS = 280_000

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function getTodaySpendUsd(): Promise<number> {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const todayKey = kstNow.toISOString().slice(0, 10)
  const rows = await supabaseSelect<{ cost_usd: number | null }>(
    'work_log',
    `started_at=gte.${todayKey}T00:00:00%2B09:00&select=cost_usd`,
  )
  return rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendText(res, 405, 'POST만 지원합니다.')
    return
  }

  const configuredPassword = process.env.VITE_APP_PASSWORD
  if (configuredPassword && req.headers['x-app-password'] !== configuredPassword) {
    sendText(res, 401, '인증 실패')
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  let parsed: { body: MessageCreateParamsNonStreaming }
  try {
    parsed = JSON.parse(await readBody(req))
  } catch {
    sendText(res, 400, '잘못된 요청 본문입니다.')
    return
  }

  try {
    const spendSoFar = await getTodaySpendUsd()
    if (spendSoFar >= DAILY_BUDGET_USD) {
      sendJson(res, 429, {
        error: `오늘 예산 한도($${DAILY_BUDGET_USD})를 초과했습니다. 내일 다시 시도해주세요.`,
      })
      return
    }
  } catch {
    // Supabase 조회 실패 시에도 호출 자체를 막지는 않는다(예산 체크는
    // best-effort — 안전장치가 일시적으로 안 되더라도 서비스는 계속되게 함).
  }

  const client = new Anthropic({ apiKey, maxRetries: 0 })
  try {
    const response = await client.messages.create(parsed.body, { timeout: REQUEST_TIMEOUT_MS })
    // stop_reason도 함께 넘긴다 — 응답 텍스트가 비어 있을 때 브라우저에서
    // "왜 비었는지"(max_tokens/refusal 등)를 구분해 안내하기 위함.
    sendJson(res, 200, { content: response.content, usage: response.usage, stop_reason: response.stop_reason })
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      sendJson(res, 504, { error: '응답 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.' })
      return
    }
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

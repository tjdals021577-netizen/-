import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'

export const CLAUDE_MODEL = 'claude-sonnet-5'

// 호출 1건이 걸려서 무한정 응답을 기다리는 상황을 막기 위한 기본 타임아웃.
// 원래 120초 → 200초로 늘렸는데도 웹서치 검색을 많이 도는 경우 200초를
// 넘기는 사례가 실제로 있었다(content-schedule 크론에서 반복 확인) — 크론
// 함수 자체 제한(300초) 안에서 최대한 여유를 주려고 260초로 다시 늘렸다.
// 대신 호출 개수/순서를 줄이는 쪽(심사위원 병렬 처리, 검색 횟수 축소)도
// 같이 적용해서 실제 소요 시간 자체를 줄였다 — 타임아웃만 늘리는 건
// 근본 해결이 아니라서 두 가지를 같이 함.
const DEFAULT_TIMEOUT_MS = 260_000

export class ClaudeCallError extends Error {}

export type UsageCallback = (usage: {
  input_tokens: number
  output_tokens: number
}) => void

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new ClaudeCallError('모델 응답에서 JSON을 찾지 못했습니다.')
  }
  return candidate.slice(start, end + 1)
}

// 브라우저에서는 진짜 Anthropic 키를 절대 갖고 있지 않는다(2026-07-14부터) —
// 대신 서버의 api/claude-proxy.ts가 대신 호출해준다. 이전엔 각자 브라우저에
// BYOK 키를 localStorage로 저장했는데, 사파리 프라이빗 모드나 저장공간 자동
// 삭제 때문에 "들어갈 때마다 키가 없어진다"는 문제가 반복돼서 없앴다. apiKey
// 파라미터는 서버(크론)에서 호출할 때만 실제로 쓰인다.
type ProxyResponse = {
  content: { type: string; text?: string }[]
  usage: { input_tokens: number; output_tokens: number }
}

async function createMessageViaProxy(
  body: MessageCreateParamsNonStreaming,
  timeoutMs: number,
): Promise<ProxyResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const password = import.meta.env.VITE_APP_PASSWORD
    const res = await fetch('/api/claude-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(password ? { 'X-App-Password': password } : {}),
      },
      body: JSON.stringify({ body }),
      signal: controller.signal,
    })
    const data = await res.json()
    if (!res.ok) {
      throw new ClaudeCallError(typeof data.error === 'string' ? data.error : `서버 오류 (${res.status})`)
    }
    return data as ProxyResponse
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ClaudeCallError(
        `${Math.round(timeoutMs / 1000)}초 안에 응답이 없어 중단했습니다. 잠시 후 다시 시도해주세요.`,
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function createMessage(
  apiKey: string,
  body: MessageCreateParamsNonStreaming,
  timeoutMs: number,
) {
  if (typeof window !== 'undefined') {
    return createMessageViaProxy(body, timeoutMs)
  }
  if (!apiKey) {
    throw new ClaudeCallError('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
  }
  // maxRetries: 0 — SDK 기본값(최대 2회 자동 재시도)을 끈다. 재시도가 켜져
  // 있으면 타임아웃 1건마다 timeoutMs를 최대 3번(최초 시도 + 재시도 2회)
  // 반복해서 크론의 300초 실행 제한을 넘기는 문제가 실제로 있었다(브레인
  // 크론이 병렬화해도 계속 타임아웃 났던 원인) — 재시도가 필요하면 각
  // 호출부에서 사람이 다시 누르거나 크론이 다음 스케줄에 다시 시도한다.
  const client = new Anthropic({ apiKey, maxRetries: 0 })
  try {
    return await client.messages.create(body, { timeout: timeoutMs })
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ClaudeCallError(
        `${Math.round(timeoutMs / 1000)}초 안에 응답이 없어 중단했습니다. 잠시 후 다시 시도해주세요.`,
      )
    }
    throw err
  }
}

// 웹서치 등 서버사이드 도구를 쓰면 응답에 tool_use/tool_result 블록이 텍스트 블록
// 사이에 섞여 나올 수 있어, "마지막" 텍스트 블록을 최종 답으로 취급한다.
function lastTextBlock(content: { type: string; text?: string }[]): string {
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]
    if (block.type === 'text' && typeof block.text === 'string') {
      return block.text
    }
  }
  throw new ClaudeCallError('모델 응답에 텍스트가 없습니다.')
}

function parseJsonResponse(text: string): unknown {
  const jsonText = extractJson(text)
  try {
    return JSON.parse(jsonText)
  } catch {
    throw new ClaudeCallError('모델 응답 JSON 파싱에 실패했습니다.')
  }
}

export async function callClaudeJson(params: {
  apiKey: string
  system: string
  user: string
  maxTokens?: number
  timeoutMs?: number
  onUsage?: UsageCallback
}): Promise<unknown> {
  const {
    apiKey,
    system,
    user,
    maxTokens = 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onUsage,
  } = params

  const response = await createMessage(
    apiKey,
    {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    },
    timeoutMs,
  )

  onUsage?.({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  })

  return parseJsonResponse(lastTextBlock(response.content))
}

// 브레인처럼 최신 정보를 리서치해야 하는 에이전트용 — Claude의 서버사이드
// 웹서치 도구를 붙여서 호출한다(클라이언트에서 별도 검색 루프를 구현할 필요 없음).
export async function callClaudeJsonWithWebSearch(params: {
  apiKey: string
  system: string
  user: string
  maxTokens?: number
  maxSearches?: number
  timeoutMs?: number
  onUsage?: UsageCallback
}): Promise<unknown> {
  const {
    apiKey,
    system,
    user,
    maxTokens = 4096,
    maxSearches = 5,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onUsage,
  } = params

  const response = await createMessage(
    apiKey,
    {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [
        {
          name: 'web_search',
          type: 'web_search_20260318',
          max_uses: maxSearches,
        },
      ],
    },
    timeoutMs,
  )

  onUsage?.({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  })

  return parseJsonResponse(lastTextBlock(response.content))
}

export interface VisionImageInput {
  imageBase64: string
  imageMediaType: 'image/png' | 'image/jpeg' | 'image/webp'
}

// 코치의 네이버 통계 스크린샷 분석, 레퍼런스 이미지 기반 카피라이팅처럼
// 이미지를 읽어야 하는 호출용. 이미지 여러 장을 한 번에 참고시킬 수 있다.
export async function callClaudeVisionJson(params: {
  apiKey: string
  system: string
  user: string
  images: VisionImageInput[]
  maxTokens?: number
  timeoutMs?: number
  onUsage?: UsageCallback
}): Promise<unknown> {
  const {
    apiKey,
    system,
    user,
    images,
    maxTokens = 2048,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onUsage,
  } = params

  const response = await createMessage(
    apiKey,
    {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.imageMediaType,
                data: img.imageBase64,
              },
            })),
            { type: 'text' as const, text: user },
          ],
        },
      ],
    },
    timeoutMs,
  )

  onUsage?.({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  })

  return parseJsonResponse(lastTextBlock(response.content))
}

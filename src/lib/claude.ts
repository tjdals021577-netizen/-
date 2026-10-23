import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'

export const CLAUDE_MODEL = 'claude-sonnet-5'
// 채점·판단처럼 "생성"이 아니라 "평가"만 하는 작업은 더 싼 모델로 돌린다
// (대표님 결정: 비용 절감). 생성 품질은 Sonnet 그대로 두고 채점만 Haiku로.
// 2026-10 대표님 결정(비용 절감 B): Haiku 4.5($1/$5) → Haiku 5.5($0.10/$0.50, 최신·10분의 1 가격).
// Haiku 5.5는 생각(thinking)이 기본으로 켜져 있어 생각 토큰도 max_tokens에 포함된다 —
// 채점·키워드 호출은 effort 'low'로 보내 생각을 짧게 하고, max_tokens도 여유 있게 둔다.
export const CLAUDE_MODEL_CHEAP = 'claude-haiku-5-5'

// 생각 깊이(effort) — 2026-10 비용 절감 A. 설정하지 않으면 모델 기본값(Sonnet 5 = high)으로
// 깊게 생각하고, 그 생각 토큰도 출력 요금으로 과금된다. 품질이 핵심인 블로그 글쓰기만
// 기본값(high)을 유지하고, 단순 작업은 'low', 기획·분석은 'medium'으로 낮춘다.
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// 응답 길이 한도 최소치 보장 — 현재 모델은 "생각" 토큰도 max_tokens에 포함된다. 호출부가
// 예전 기준(생각 없던 시절)으로 낮게 잡은 한도 때문에 JSON이 중간에 잘려 실패한 일이
// 2026-10 실사용에서 두 번 났다(블로그 글쓰기 8192, 채점 4096). 한도는 "상한"일 뿐 안 쓰면
// 과금되지 않으므로, 모든 호출에 여유를 보장한다. 깊게 생각하는(기본 high 이상) 생성 호출은
// 16k, 그 외(싼 모델·low/medium)는 8k. SDK 비스트리밍 상한(≈21k) 안쪽인 20k로 상한.
function safeMaxTokens(requested: number, model: string, effort?: Effort): number {
  const deep = model !== CLAUDE_MODEL_CHEAP && (!effort || effort === 'high' || effort === 'xhigh' || effort === 'max')
  return Math.min(20_000, Math.max(requested, deep ? 16_000 : 8192))
}

// 호출 1건이 걸려서 무한정 응답을 기다리는 상황을 막기 위한 기본 타임아웃.
// 원래 120초 → 200초로 늘렸는데도 웹서치 검색을 많이 도는 경우 200초를
// 넘기는 사례가 실제로 있었다(content-schedule 크론에서 반복 확인) — 크론
// 함수 자체 제한(300초) 안에서 최대한 여유를 주려고 260초로 다시 늘렸다.
// 대신 호출 개수/순서를 줄이는 쪽(심사위원 병렬 처리, 검색 횟수 축소)도
// 같이 적용해서 실제 소요 시간 자체를 줄였다 — 타임아웃만 늘리는 건
// 근본 해결이 아니라서 두 가지를 같이 함.
const DEFAULT_TIMEOUT_MS = 260_000

export class ClaudeCallError extends Error {}

// Anthropic 계정 쪽 문제(크레딧 소진)는 코드로 못 고친다 — 원문 영어 JSON 대신 대표님이 바로 할 일을 알려준다
// (2026-10 실제로 "credit balance is too low" 400이 업메리 블로그·라이터 오류로 그대로 떴다).
export const CREDIT_EMPTY_MESSAGE =
  'Anthropic API 크레딧이 부족해 멈췄어요(코드 오류 아님). console.anthropic.com → Settings → Billing에서 충전하면 다음 실행부터 다시 돌아요.'

function friendlyApiError(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (/credit balance is too low/i.test(msg)) return new ClaudeCallError(CREDIT_EMPTY_MESSAGE)
  return err
}

// 대표님이 팀채팅에서 "취소"를 눌렀을 때 던지는 전용 오류 — 일반 실패(오류)와
// 구분해서, 근무기록에 "오류"가 아니라 "취소됨"으로 남기고 사용자에게도 겁주는
// 에러 문구 대신 담백한 안내를 보여주기 위함.
export class ClaudeCancelledError extends ClaudeCallError {}

// 진행 중인 모든 브라우저 → 프록시 호출을 한 번에 끊기 위한 공용 컨트롤러.
// 팀채팅에서 잘못 지시했을 때 "취소" 버튼으로 중단할 수 있게 한다. 크론(Node)
// 경로는 SDK로 직접 호출해서 이 컨트롤러를 쓰지 않으므로 영향받지 않는다.
let activeCancelController = new AbortController()

// 취소 버튼이 호출한다 — 지금 떠 있는 요청들을 전부 중단(abort)시키고, 다음
// 요청은 깨끗한 새 컨트롤러로 시작하도록 교체한다.
export function cancelActiveClaudeCalls(): void {
  activeCancelController.abort()
  activeCancelController = new AbortController()
}

export type UsageCallback = (usage: {
  input_tokens: number
  output_tokens: number
}) => void

// ── 프롬프트 캐싱 ──────────────────────────────────────────────────────────
// 전자책·유튜브 지식·페르소나 프롬프트처럼 "호출마다 똑같은 거대한 앞부분"은
// 매번 전체 입력 토큰으로 과금된다. cache_control을 붙이면 그 앞부분을 앤트로픽
// 서버가 5분간 캐시해서, 다음 호출(같은 앞부분)은 그 부분을 ~10% 값(90% 할인)으로
// 읽는다. 특히 대행 크론(클라이언트 3~5명을 연달아 도는)·채점 배치·UI에서 짧은
// 시간에 같은 프롬프트를 여러 번 부를 때 크게 아낀다.
//
// 캐시는 "앞부분이 토큰 단위로 완전히 같을 때"만 적중하므로, 변하는 값(브랜드
// 목소리·최근 글·클라이언트 정보·시장 리서치)은 반드시 캐시 블록 "뒤"로 빼야 한다.
export type SystemBlock = {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}
export type SystemPrompt = string | SystemBlock[]

// staticText: 호출마다 100% 동일한 부분 → 캐시 대상(앞).
// dynamicText: 호출마다 바뀌는 부분 → 캐시 안 됨(뒤). 없으면 생략.
export function cachedSystem(staticText: string, dynamicText?: string): SystemBlock[] {
  const blocks: SystemBlock[] = [
    { type: 'text', text: staticText, cache_control: { type: 'ephemeral' } },
  ]
  const dyn = dynamicText?.trim()
  if (dyn) blocks.push({ type: 'text', text: dyn })
  return blocks
}

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
  // 응답이 왜 끝났는지 — 'end_turn'(정상) · 'max_tokens'(길이 초과로 잘림) ·
  // 'refusal'(모델 거부) 등. 텍스트가 비어 있을 때 원인을 알려주는 데 쓴다.
  stop_reason?: string | null
}

async function createMessageViaProxy(
  body: MessageCreateParamsNonStreaming,
  timeoutMs: number,
): Promise<ProxyResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // 타임아웃과는 별개로, 사용자가 "취소"를 누르면 activeCancelController가
  // abort되고 → 이 요청도 같이 끊는다. 두 신호를 하나의 controller로 합친다.
  const cancelSignal = activeCancelController.signal
  const onCancel = () => controller.abort()
  if (cancelSignal.aborted) controller.abort()
  else cancelSignal.addEventListener('abort', onCancel, { once: true })
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
      throw friendlyApiError(new ClaudeCallError(typeof data.error === 'string' ? data.error : `서버 오류 (${res.status})`))
    }
    return data as ProxyResponse
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // 사용자가 취소해서 끊긴 건지, 단순 타임아웃인지 구분해서 알려준다.
      if (cancelSignal.aborted) {
        throw new ClaudeCancelledError('대표님이 작업을 취소했습니다.')
      }
      throw new ClaudeCallError(
        `${Math.round(timeoutMs / 1000)}초 안에 응답이 없어 중단했습니다. 잠시 후 다시 시도해주세요.`,
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
    cancelSignal.removeEventListener('abort', onCancel)
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
    throw friendlyApiError(err)
  }
}

// 웹서치처럼 오래 걸리는 서버(크론) 호출용 — 비스트리밍(messages.create)은 전체
// 응답이 올 때까지 한 번에 기다리는데, 웹서치는 검색+생성에 수 분이 걸려 그
// 방식으론 계속 타임아웃이 났다(실측: 검색 1회도 210초 초과). 스트리밍은 연결을
// 살아있게 유지하며 부분 응답을 받다가 마지막에 완성본을 돌려줘, 장시간 호출을
// 안정적으로 끝낼 수 있다(Anthropic 권장). 서버 전용(브라우저는 프록시가 비스트리밍
// 이라 이 경로를 타지 않는다).
async function createMessageStreamingDirect(
  apiKey: string,
  body: MessageCreateParamsNonStreaming,
  timeoutMs: number,
): Promise<ProxyResponse> {
  if (!apiKey) {
    throw new ClaudeCallError('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
  }
  const client = new Anthropic({ apiKey, maxRetries: 0 })
  try {
    const stream = client.messages.stream(body, { timeout: timeoutMs })
    const message = await stream.finalMessage()
    return { content: message.content, usage: message.usage, stop_reason: message.stop_reason }
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ClaudeCallError(
        `${Math.round(timeoutMs / 1000)}초 안에 응답이 없어 중단했습니다. 잠시 후 다시 시도해주세요.`,
      )
    }
    throw friendlyApiError(err)
  }
}

// 웹서치 등 서버사이드 도구를 쓰면 응답에 tool_use/tool_result 블록이 텍스트 블록
// 사이에 섞여 나올 수 있어, "마지막(비어있지 않은)" 텍스트 블록을 최종 답으로 취급한다.
// 텍스트가 아예 없으면 stop_reason으로 "왜 비었는지"를 함께 알려준다 —
// max_tokens(길이 초과로 잘림)·refusal(모델 거부)를 구분해야 대응이 달라진다.
function lastTextBlock(response: {
  content: { type: string; text?: string }[]
  stop_reason?: string | null
}): string {
  const { content, stop_reason } = response
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
      return block.text
    }
  }
  const hint =
    stop_reason === 'max_tokens'
      ? ' (응답이 최대 길이에 도달해 잘렸습니다 — 조금 더 짧게 요청하거나 다시 시도해 주세요)'
      : stop_reason === 'refusal'
        ? ' (모델이 요청을 거부했습니다 — 표현을 바꿔 다시 시도해 주세요)'
        : stop_reason
          ? ` (종료 사유: ${stop_reason})`
          : ''
  throw new ClaudeCallError(`모델 응답에 텍스트가 없습니다.${hint}`)
}

// 길이 한도(max_tokens)에 걸려 JSON이 중간에 잘린 경우 — 일반 "JSON 못 찾음"과 구분해야
// 호출부가 "한도를 늘리거나 생각을 줄여" 다시 시도할 수 있다(생각 토큰도 한도에 포함됨).
export class ClaudeTruncatedError extends ClaudeCallError {}

// 맨 뒤의 쉼표를 떼어낸다 — {"a":1,} 처럼 모델이 흔히 흘리는 깨짐.
function dropTrailingComma(s: string): string {
  const t = s.replace(/\s+$/, '')
  return t.endsWith(',') ? t.slice(0, -1) : s
}

// 객체가 잘렸을 때 값 없이 남은 키 조각을 떼어낸다.
// 예: {"title":"가","body"  /  {"title":"가","body":   → {"title":"가"}
function dropDanglingKey(s: string): string {
  let t = dropTrailingComma(s).replace(/\s+$/, '')
  // 콜론에서 끊긴 경우({"a":1,"b":)는 값이 아예 없다 — 콜론을 떼고 키까지 지운다.
  if (t.endsWith(':')) t = t.slice(0, -1).replace(/\s+$/, '')
  let depth = 0
  let inStr = false
  for (let i = t.length - 1; i >= 0; i--) {
    const ch = t[i]
    if (inStr) {
      // 역방향이라 \" 인지 보려면 앞의 역슬래시 개수를 센다(짝수면 진짜 따옴표).
      if (ch === '"') {
        let back = 0
        while (i - 1 - back >= 0 && t[i - 1 - back] === '\\') back++
        if (back % 2 === 0) inStr = false
      }
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '}' || ch === ']') { depth++; continue }
    if (ch === '{' || ch === '[') { if (depth === 0) return t.slice(0, i + 1); depth--; continue }
    if (ch === ',' && depth === 0) return t.slice(0, i)
    if (ch === ':' && depth === 0) return t          // 키:값 쌍이 온전하다
  }
  return t
}

// 모델이 낸 JSON이 조금 깨졌을 때 되살린다. 실제로 겪은 깨짐만 고친다:
//   ① 문자열 "안"에 진짜 줄바꿈·탭이 들어옴 — 블로그 본문처럼 긴 글에서 특히 잦다.
//      JSON 문자열 안에는 제어문자를 그대로 넣을 수 없어 JSON.parse가 통째로 실패한다.
//   ② 본문 속 따옴표를 이스케이프하지 않음 — 예: "그가 "진짜"라고 했다"
//      닫는 따옴표 뒤에 , : } ] 가 오지 않으면 본문용 따옴표로 보고 \" 로 바꾼다.
//   ③ 응답이 잘려 문자열·괄호가 안 닫힘 — 그 자리에서 닫아준다
//      (잘린 글이라도 통째로 버리는 것보다 제목·본문을 건지는 편이 낫다).
//   ④ 맨 뒤 쉼표.
// ⚠️ 멀쩡한 JSON에는 쓰지 않는다 — JSON.parse가 실패했을 때만 부른다.
export function repairJson(src: string): string {
  let out = ''
  let inStr = false
  let esc = false
  const stack: string[] = []
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (esc) { out += ch; esc = false; continue }
      if (ch === '\\') { out += ch; esc = true; continue }
      if (ch === '"') {
        // 뒤에 , : } ] 또는 끝이 오면 진짜 닫는 따옴표, 아니면 본문 속 따옴표.
        const rest = src.slice(i + 1).replace(/^\s+/, '')
        if (rest === '' || ',:}]'.includes(rest[0])) { out += ch; inStr = false }
        else out += '\\"'
        continue
      }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      if (ch < ' ') continue                      // 그 밖의 제어문자는 버린다
      out += ch
      continue
    }
    if (ch === '"') { out += ch; inStr = true; continue }
    if (ch === '{' || ch === '[') { stack.push(ch); out += ch; continue }
    if (ch === '}' || ch === ']') {
      out = dropTrailingComma(out)
      stack.pop()
      out += ch
      continue
    }
    out += ch
  }
  if (inStr) out += '"'                            // 잘린 문자열을 닫는다
  while (stack.length) {
    const open = stack.pop()
    out = open === '{' ? dropDanglingKey(out) : dropTrailingComma(out)
    out += open === '{' ? '}' : ']'
  }
  return out
}

function parseJsonResponse(text: string, stopReason?: string | null): unknown {
  const truncated = () =>
    new ClaudeTruncatedError('응답이 최대 길이에 도달해 JSON이 중간에 잘렸습니다.')
  let jsonText: string | null = null
  try {
    jsonText = extractJson(text)
    return JSON.parse(jsonText)
  } catch {
    // 여기서 바로 포기하면 긴 블로그 본문이 줄바꿈 하나 때문에 통째로 버려진다
    // (대표님 보고 2026-10-20: "업메리 라이터 — 모델 응답 JSON 파싱에 실패했습니다").
    // 흔한 깨짐을 고쳐 한 번 더 시도한다.
    if (jsonText !== null) {
      try {
        return JSON.parse(repairJson(jsonText))
      } catch { /* 아래 2차 시도 */ }
    }
    // extractJson은 "마지막 }"까지만 잘라온다 — 응답이 중간에 잘렸다면 그 }가
    // 본문 속 괄호일 수 있다. 첫 { 부터 끝까지를 통째로 복구해본다.
    const start = text.indexOf('{')
    if (start !== -1) {
      try {
        return JSON.parse(repairJson(text.slice(start)))
      } catch { /* 아래에서 실패 처리 */ }
    }
    throw stopReason === 'max_tokens'
      ? truncated()
      : new ClaudeCallError('모델 응답 JSON 파싱에 실패했습니다.')
  }
}

export async function callClaudeJson(params: {
  apiKey: string
  system: SystemPrompt
  user: string
  maxTokens?: number
  timeoutMs?: number
  onUsage?: UsageCallback
  model?: string
  // 응답 첫 부분을 미리 채워(assistant prefill) 모델이 그 뒤를 "이어서" 쓰게
  // 강제한다. '{'를 넣으면 모델이 인사·설명·줄글 없이 곧바로 JSON 본문을
  // 이어 쓸 수밖에 없어, "모델 응답에서 JSON을 찾지 못했습니다" 실패를
  // 원천 차단한다(특히 '이 글 고쳐줘' 재수정에서 모델이 줄글로 새던 문제).
  assistantPrefill?: string
  effort?: Effort
}): Promise<unknown> {
  const {
    apiKey,
    system,
    user,
    maxTokens = 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onUsage,
    model = CLAUDE_MODEL,
    assistantPrefill,
    effort,
  } = params

  // ⚠️ assistant prefill 미사용 — 현재 우리가 쓰는 모델(claude-sonnet-5 등)은
  // "assistant message prefill"을 지원하지 않아, prefill을 넣으면 400
  // ("The conversation must end with a user message")로 통째로 실패한다(실사용
  // 확인). 예전엔 생성기가 이 400을 재시도로 넘겨 "prefill 없는 시도"로만 성공했고,
  // chatDecide는 모든 시도를 prefill로 해 완전히 막혔다. 그래서 prefill을 아예
  // 보내지 않는다 — JSON 강제는 시스템 프롬프트의 "JSON만 출력" 지시 + extractJson
  // (앞의 잡글을 걷어내고 첫 {~마지막 } 추출)로 처리한다. assistantPrefill 인자는
  // 하위호환으로 남기되 무시한다.
  void assistantPrefill
  const messages: MessageCreateParamsNonStreaming['messages'] = [{ role: 'user', content: user }]

  const response = await createMessage(
    apiKey,
    {
      model,
      max_tokens: safeMaxTokens(maxTokens, model, effort),
      system,
      messages,
      ...(effort ? { output_config: { effort } } : {}),
    },
    timeoutMs,
  )

  onUsage?.({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  })

  return parseJsonResponse(lastTextBlock(response), response.stop_reason)
}

// 브레인처럼 최신 정보를 리서치해야 하는 에이전트용 — Claude의 서버사이드
// 웹서치 도구를 붙여서 호출한다(클라이언트에서 별도 검색 루프를 구현할 필요 없음).
export async function callClaudeJsonWithWebSearch(params: {
  apiKey: string
  system: SystemPrompt
  user: string
  maxTokens?: number
  maxSearches?: number
  timeoutMs?: number
  onUsage?: UsageCallback
  effort?: Effort
}): Promise<unknown> {
  const {
    apiKey,
    system,
    user,
    maxTokens = 4096,
    maxSearches = 3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onUsage,
    effort,
  } = params

  const body: MessageCreateParamsNonStreaming = {
    model: CLAUDE_MODEL,
    max_tokens: safeMaxTokens(maxTokens, CLAUDE_MODEL, effort),
    system,
    messages: [{ role: 'user', content: user }],
    ...(effort ? { output_config: { effort } } : {}),
    tools: [
      {
        // web_search_20260209 — 현재 API가 지원하는 웹서치 도구 버전
        // (Opus 4.8/4.7/4.6·Sonnet 5·Sonnet 4.6). 예전엔 20260318로 적혀
        // 있었으나 그 버전은 존재하지 않아 400으로 거절 → 브레인이 검색 없이
        // "검색 도구 제한" 폴백으로 빠지던 원인이었다. 계정 설정 필요 없음
        // (서버 도구라 API로 자동 사용 가능, 사용량만큼 과금).
        name: 'web_search',
        type: 'web_search_20260209',
        max_uses: maxSearches,
      },
    ],
  }

  // 서버(크론): 스트리밍으로 장시간 웹서치를 안정적으로 완료.
  // 브라우저: 프록시(비스트리밍) 경로 — 프록시가 SSE 중계를 안 하므로 그대로 둔다.
  const response =
    typeof window === 'undefined'
      ? await createMessageStreamingDirect(apiKey, body, timeoutMs)
      : await createMessage(apiKey, body, timeoutMs)

  onUsage?.({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  })

  return parseJsonResponse(lastTextBlock(response), response.stop_reason)
}

export interface VisionImageInput {
  imageBase64: string
  imageMediaType: 'image/png' | 'image/jpeg' | 'image/webp'
}

// PDF 문서 입력 — 대행 온보딩에서 구글폼·레퍼런스를 PDF 한 개로 대체할 때 쓴다.
// Claude는 PDF를 document 블록으로 받아 텍스트·이미지(페이지)를 함께 읽는다.
export interface VisionDocInput {
  dataBase64: string
  mediaType: 'application/pdf'
}

// 코치의 네이버 통계 스크린샷 분석, 레퍼런스 이미지 기반 카피라이팅처럼
// 이미지를 읽어야 하는 호출용. 이미지 여러 장 + PDF 문서를 한 번에 참고시킬 수 있다.
export async function callClaudeVisionJson(params: {
  apiKey: string
  system: SystemPrompt
  user: string
  images: VisionImageInput[]
  documents?: VisionDocInput[]
  maxTokens?: number
  timeoutMs?: number
  onUsage?: UsageCallback
  // callClaudeJson과 동일 — 응답을 '{'로 시작하도록 강제해 JSON 실패를 막는다.
  assistantPrefill?: string
  effort?: Effort
}): Promise<unknown> {
  const {
    apiKey,
    system,
    user,
    images,
    documents = [],
    maxTokens = 2048,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onUsage,
    assistantPrefill,
    effort,
  } = params

  const messages: MessageCreateParamsNonStreaming['messages'] = [
    {
      role: 'user',
      content: [
        ...documents.map((doc) => ({
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: doc.mediaType,
            data: doc.dataBase64,
          },
        })),
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
  ]
  // assistant prefill 미사용 — callClaudeJson과 동일한 이유(모델 미지원 400).
  // 하위호환으로 인자는 남기되 무시하고, JSON은 지시+extractJson으로 처리한다.
  void assistantPrefill

  const response = await createMessage(
    apiKey,
    {
      model: CLAUDE_MODEL,
      max_tokens: safeMaxTokens(maxTokens, CLAUDE_MODEL, effort),
      system,
      messages,
      ...(effort ? { output_config: { effort } } : {}),
    },
    timeoutMs,
  )

  onUsage?.({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  })

  return parseJsonResponse(lastTextBlock(response), response.stop_reason)
}

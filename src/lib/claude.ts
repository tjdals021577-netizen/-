import Anthropic from '@anthropic-ai/sdk'

export const CLAUDE_MODEL = 'claude-sonnet-5'

export class ClaudeCallError extends Error {}

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

export async function callClaudeJson(params: {
  apiKey: string
  system: string
  user: string
  maxTokens?: number
  onUsage?: (usage: { input_tokens: number; output_tokens: number }) => void
}): Promise<unknown> {
  const { apiKey, system, user, maxTokens = 4096, onUsage } = params
  if (!apiKey) {
    throw new ClaudeCallError('Anthropic API 키가 설정되지 않았습니다.')
  }

  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  })

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  })

  onUsage?.({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new ClaudeCallError('모델 응답에 텍스트가 없습니다.')
  }

  const jsonText = extractJson(textBlock.text)
  try {
    return JSON.parse(jsonText)
  } catch {
    throw new ClaudeCallError('모델 응답 JSON 파싱에 실패했습니다.')
  }
}

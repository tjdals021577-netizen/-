import { callClaudeJson } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import type { AgentChatMessage } from '../types/agentChat.js'
import type { DispatchableAgent } from './dispatch.js'

const AGENT_ROLE_KO: Record<DispatchableAgent, string> = {
  writer: '블로그 글을 쓰는 라이터',
  buzz: '스레드 글을 쓰는 버즈',
  remix: '유튜브 기획을 하는 리믹서',
  brain: '시장·레퍼런스를 조사하는 브레인',
}

export interface ChatDecision {
  kind: 'question' | 'act' | 'reply'
  text: string
  cleanInstruction?: string
  memoryFacts: string[]
}

function parseDecision(raw: unknown): ChatDecision {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const kind = rec.kind === 'question' || rec.kind === 'act' ? rec.kind : 'reply'
  return {
    kind,
    text: typeof rec.text === 'string' ? rec.text : '',
    cleanInstruction: typeof rec.cleanInstruction === 'string' ? rec.cleanInstruction : undefined,
    memoryFacts: Array.isArray(rec.memoryFacts)
      ? rec.memoryFacts.filter((f): f is string => typeof f === 'string')
      : [],
  }
}

// 대화창에 메시지가 오면, 실제 작업(초안 생성 등)을 바로 돌리기 전에 먼저
// "이 지시가 바로 실행해도 될 만큼 충분한가"를 판단한다 — 애매하면 되묻고,
// 이미 충분하면 바로 실행하고, 그냥 잡담·피드백이면 작업 없이 대화로만
// 응답한다. 대화 중 드러난 취향/스타일은 memoryFacts로 뽑아서 다음 작업에
// 계속 참고할 수 있게 저장한다.
export async function decideNextStep(params: {
  apiKey: string
  agent: DispatchableAgent
  brandContext: string
  userMessage: string
  history: AgentChatMessage[]
  memory: string[]
}): Promise<ChatDecision> {
  const { apiKey, agent, brandContext, userMessage, history, memory } = params

  const historyText = history
    .slice(-10)
    .map((m) => `${m.role === 'user' ? '대표님' : '나'}: ${m.content}`)
    .join('\n')
  const memoryText = memory.length > 0 ? memory.map((f) => `- ${f}`).join('\n') : '(아직 없음)'

  const system = `너는 ${AGENT_ROLE_KO[agent]} 에이전트다. 브랜드 정보: ${brandContext}

대표님과 실시간으로 대화하면서 일을 받는다. 아래 세 가지 중 하나로 판단해서 응답한다:

1. "question" — 지시가 애매해서 뭘 만들어야 할지 확신이 안 설 때(예: 주제가 없음, 방향이 여러 개일 때).
   이때는 실제 작업을 실행하지 말고, 짧고 구체적인 되묻는 질문을 한다.
2. "act" — 지시가 충분히 구체적이거나, 이전 대화까지 합치면 뭘 만들지 명확할 때.
   이때는 실제 작업을 시작하겠다는 짧은 안내 문구(text)와 함께, 지금까지 대화 전체를 종합한
   깔끔한 지시문(cleanInstruction, 실제 생성기가 바로 쓸 수 있는 주제/지시 문장 하나)을 만든다.
3. "reply" — 새로운 작업 요청이 아니라 그냥 대화/질문/이미 만든 결과물에 대한 감상일 때.
   작업 없이 대화로만 답한다(예: 감사 인사, 잡담, "왜 이렇게 만들었어?" 같은 질문).

지금까지 대표님한테서 파악한 특징(항상 참고할 것):
${memoryText}

이번 대화에서 새롭게 알게 된 대표님의 취향·스타일·선호가 있으면 memoryFacts에 짧은 문장으로
적는다(없으면 빈 배열). 예: "제목은 궁금증 유발형을 선호함", "너무 뻔한 설명 지양".

JSON으로만 답한다: {"kind": "question"|"act"|"reply", "text": "...", "cleanInstruction": "...(act일 때만)", "memoryFacts": ["..."]}`

  const user = `[최근 대화]\n${historyText || '(대화 시작)'}\n\n[대표님의 새 메시지]\n${userMessage}`

  const raw = await callClaudeJson({
    apiKey,
    system,
    user,
    maxTokens: 1024,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseDecision(raw)
}

import type { Brand } from './brand.js'

// 대화 중 "이 사람은 이런 걸 선호하는구나"를 파악해서 쌓아두는 짧은 사실들.
// 에이전트·브랜드별로 따로 쌓인다(라이터의 기억과 버즈의 기억은 분리).
export interface AgentMemoryFact {
  id: string
  agent: string
  brand: Brand
  fact: string
  createdAt: string
}

// 실제 대화 한 턴. 작업 실행 결과(work_log/결재함)와는 별개로, "말"만 오간
// 기록이다 — 되묻는 질문, 사람의 답, 가벼운 피드백 같은 것들이 여기 쌓인다.
export interface AgentChatMessage {
  id: string
  agent: string
  brand: Brand
  role: 'user' | 'agent'
  content: string
  isQuestion: boolean
  createdAt: string
}

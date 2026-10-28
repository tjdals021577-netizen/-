import type { AgentChatMessage, AgentMemoryFact } from '../types/agentChat.js'
import type { Brand } from '../types/brand.js'
import { syncToSupabase } from './remoteSync.js'

const MESSAGES_KEY = 'ai-ops:agent-chat-messages'
const MEMORY_KEY = 'ai-ops:agent-memory'
const LAST_OUTPUT_KEY = 'ai-ops:agent-last-output'
const MAX_MEMORY_PER_AGENT = 20

// 에이전트가 방금 만든 결과물(초안/기획안)을 에이전트·브랜드별로 딱 하나(최신)
// 기억해둔다 — 대표님이 "방금 만든 거 이렇게 고쳐줘"라고 하면 이걸 꺼내
// 수정보완한다. 채팅 기록(짧은 안내 문구)엔 결과물 전문이 없어서 따로 저장한다.
export interface AgentLastOutput {
  agent: string
  brand: Brand
  title: string
  content: string
  createdAt: string
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readAll<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // 용량 초과 등으로 저장 실패해도 조용히 무시 — best-effort 로컬 저장
  }
}

export function getMessages(agent: string, brand: Brand): AgentChatMessage[] {
  return readAll<AgentChatMessage>(MESSAGES_KEY)
    .filter((m) => m.agent === agent && m.brand === brand)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function addMessage(params: {
  agent: string
  brand: Brand
  role: 'user' | 'agent'
  content: string
  isQuestion?: boolean
  batchId?: string
}): AgentChatMessage {
  const message: AgentChatMessage = {
    id: makeId(),
    agent: params.agent,
    brand: params.brand,
    role: params.role,
    content: params.content,
    isQuestion: params.isQuestion ?? false,
    createdAt: new Date().toISOString(),
    batchId: params.batchId,
  }
  const all = readAll<AgentChatMessage>(MESSAGES_KEY)
  all.push(message)
  writeAll(MESSAGES_KEY, all)
  syncToSupabase('agent_chat_messages', message)
  return message
}

export function getMemory(agent: string, brand: Brand): AgentMemoryFact[] {
  return readAll<AgentMemoryFact>(MEMORY_KEY)
    .filter((m) => m.agent === agent && m.brand === brand)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// 같은 내용을 중복으로 계속 안 쌓이게, 완전히 같은 문장이면 건너뛴다.
// 브랜드당 최대 개수를 넘으면 오래된 것부터 정리해서 무한정 커지지 않게 함.
export function addMemoryFacts(agent: string, brand: Brand, facts: string[]): void {
  if (facts.length === 0) return
  const all = readAll<AgentMemoryFact>(MEMORY_KEY)
  const existingForAgent = all.filter((m) => m.agent === agent && m.brand === brand)
  const existingTexts = new Set(existingForAgent.map((m) => m.fact))
  const newOnes: AgentMemoryFact[] = facts
    .filter((f) => f.trim().length > 0 && !existingTexts.has(f.trim()))
    .map((f) => ({
      id: makeId(),
      agent,
      brand,
      fact: f.trim(),
      createdAt: new Date().toISOString(),
    }))
  if (newOnes.length === 0) return
  const combined = [...existingForAgent, ...newOnes]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_MEMORY_PER_AGENT)
  const others = all.filter((m) => !(m.agent === agent && m.brand === brand))
  writeAll(MEMORY_KEY, [...others, ...combined])
  for (const fact of newOnes) {
    syncToSupabase('agent_memory', fact)
  }
}

export function deleteMemoryFact(id: string): void {
  writeAll(MEMORY_KEY, readAll<AgentMemoryFact>(MEMORY_KEY).filter((m) => m.id !== id))
}

export function setLastOutput(params: {
  agent: string
  brand: Brand
  title: string
  content: string
}): void {
  const entry: AgentLastOutput = {
    agent: params.agent,
    brand: params.brand,
    title: params.title,
    content: params.content,
    createdAt: new Date().toISOString(),
  }
  // 에이전트+브랜드당 최신 1개만 유지한다(직전 것을 덮어씀).
  const others = readAll<AgentLastOutput>(LAST_OUTPUT_KEY).filter(
    (o) => !(o.agent === params.agent && o.brand === params.brand),
  )
  writeAll(LAST_OUTPUT_KEY, [entry, ...others])
}

export function getLastOutput(agent: string, brand: Brand): AgentLastOutput | undefined {
  return readAll<AgentLastOutput>(LAST_OUTPUT_KEY).find(
    (o) => o.agent === agent && o.brand === brand,
  )
}

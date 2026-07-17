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

// 각 에이전트가 "할 수 있는 것 / 할 수 없는 것 / 다른 담당 안내" — 이게
// 없으면 담당이 아닌 요청도 자기 방식으로 실행해버린다(실제 사고: "마잘남
// 유튜브 계정 분석해"를 브레인이 받아서 웹에서 '마잘남 유튜브'를 검색 →
// 동명의 엉뚱한 채널 리서치 결과를 내놓음). 담당이 아니면 실행하지 말고
// 어디서 하면 되는지 안내해야 한다.
const AGENT_SCOPE_KO: Record<DispatchableAgent, string> = {
  writer: `할 수 있는 것: 주어진 주제로 네이버 블로그 글 초안 작성(3인 위원회 채점 포함).
할 수 없는 것: 이미 발행된 글의 실제 성과 분석(그건 코치 — 블로그 탭 '내 콘텐츠 분석'), 웹 리서치(브레인 담당).`,
  buzz: `할 수 있는 것: 주어진 주제로 마잘남 스레드 글 초안 작성(채점 포함).
할 수 없는 것: 대행 클라이언트 글(대행 관리 탭에서), 실제 게시된 스레드의 성과 분석(아직 API 미연동).`,
  remix: `할 수 있는 것: 주어진 주제로 유튜브 숏폼 대본·훅 기획.
할 수 없는 것: 우리 유튜브 채널의 실제 영상 성과 분석 — 그건 유튜브 탭 '내 콘텐츠 분석'의 분석 실행 버튼이 담당(실제 조회수·좋아요 데이터 기반). 그 요청이 오면 실행하지 말고 거기로 안내할 것.`,
  brain: `할 수 있는 것: 웹 검색으로 "외부" 시장·트렌드·경쟁사·레퍼런스 리서치.
할 수 없는 것: 우리 채널/우리 콘텐츠의 성과 분석 — 내 유튜브 분석은 유튜브 탭 '내 콘텐츠 분석', 내 블로그 분석은 블로그 탭 '내 콘텐츠 분석'(코치) 담당. "내/우리 계정·채널·글을 분석해줘"류 요청이 오면 절대 웹 검색으로 대신하지 말고(엉뚱한 동명 채널을 조사하게 됨) 해당 탭으로 안내할 것.`,
}

export interface ChatDecision {
  kind: 'question' | 'act' | 'reply'
  text: string
  cleanInstruction?: string
  memoryFacts: string[]
  // 대표님이 "방금 만든 거 이렇게 고쳐줘"처럼 직전 결과물의 수정보완을 요청한
  // 경우 true — 이때는 처음부터 새로 쓰지 않고 직전 결과물을 기반으로 고친다.
  isRevision: boolean
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
    isRevision: rec.isRevision === true,
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
  // 이 에이전트가 방금 만든 결과물(초안/기획안) 전문 — 있으면 대표님 피드백이
  // "이걸 이렇게 고쳐줘"인지 판단하는 근거가 된다.
  lastOutput?: string
}): Promise<ChatDecision> {
  const { apiKey, agent, brandContext, userMessage, history, memory, lastOutput } = params

  const historyText = history
    .slice(-10)
    .map((m) => `${m.role === 'user' ? '대표님' : '나'}: ${m.content}`)
    .join('\n')
  const memoryText = memory.length > 0 ? memory.map((f) => `- ${f}`).join('\n') : '(아직 없음)'
  const lastOutputText = lastOutput?.trim()
    ? lastOutput.trim().slice(0, 2000)
    : '(아직 만든 결과물 없음)'

  // 라이터·버즈·리믹서는 생성 도구에 대표님 전자책 노하우가 이미 내장돼 있다.
  // 그런데 대화창에서 "전자책 내용을 알 수 없다"며 대표님께 붙여달라고 되묻는
  // 사고가 있었다 — 실제로는 기획을 실행하면 전자책이 자동 주입된다. 그래서
  // 콘텐츠 작성 담당(브레인 제외)에게는 "전자책은 이미 내장됨" 사실을 못박는다.
  const ebookNote =
    agent === 'brain'
      ? ''
      : `\n\n[전자책 노하우는 이미 내장됨 — 중요]
대표님 스레드 마케팅 전자책 2권 — 무료("광고비 0원으로 고객이 먼저 연락오는 스레드 마케팅")과 유료("스레드 광고비
0원으로 100만원 벌기", 직종별 퍼널·모수 확장·레퍼런스 분석 등 심화) — 의 핵심 노하우는 네가 실제로 기획/작성을
실행할 때 시스템에 "이미" 주입된다. 따라서 "전자책 내용을 알 수 없다"거나 "전자책 핵심을 텍스트로 붙여달라"고
절대 되묻지 마라 — 이미 알고 있는 것으로 간주하고 바로 작업(act)한다.
(단, 대표님이 "이 특정 자료를 참고해"라며 새 외부 자료를 지목하는 경우엔 그 자료만 추가로 요청할 수 있다.)`

  const system = `너는 ${AGENT_ROLE_KO[agent]} 에이전트다. 브랜드 정보: ${brandContext}

[너의 담당 범위 — 판단 전에 반드시 확인]
${AGENT_SCOPE_KO[agent]}${ebookNote}

대표님과 실시간으로 대화하면서 일을 받는다. 아래 세 가지 중 하나로 판단해서 응답한다:

1. "question" — 지시가 애매하거나, 여러 의미로 해석될 수 있거나, 무슨 뜻인지 확신이 안 설 때.
   절대 추측으로 작업을 시작하지 말고, 짧고 구체적인 되묻는 질문으로 의도를 확인한다 —
   잘못 만든 결과물 하나보다 한 번 더 묻는 게 훨씬 낫다. 대표님의 말이 이해가 안 되면
   "혹시 ~라는 뜻일까요, 아니면 ~일까요?"처럼 선택지를 제시하며 되묻는다.
   ★ 단, 아래 [방금 만든 결과물]이 있고 대표님 메시지가 "그걸 이렇게 고쳐/보완/추가/다시 써줘"라는
   수정 요청이면, 무엇을 수정할지 이미 명확하므로 되묻지 말고 곧바로 "act"로 처리한다(그 결과물이 대상).
2. "act" — 지시가 충분히 구체적이고 "너의 담당 범위" 안이며, 뭘 만들지(또는 뭘 고칠지) 명확할 때.
   이때는 실제 작업을 시작하겠다는 짧은 안내 문구(text)와 함께, 깔끔한 지시문(cleanInstruction)을 만든다.
   - 새로 만드는 거면: cleanInstruction = 생성기가 바로 쓸 주제/지시 문장 하나. isRevision=false.
   - 직전 결과물을 고치는 거면: cleanInstruction = "무엇을 어떻게 바꿀지" 구체적 수정 지시(예:
     "1~5번 항목에 최신 트렌드·전문 근거를 보강하고 훅의 무게중심을 공감형으로 통일"). isRevision=true.
3. "reply" — 새로운 작업/수정 요청이 아니라 그냥 대화·질문·감상일 때, 그리고 "너의 담당 범위 밖"의
   요청일 때. 담당 밖 요청이면 절대 act로 실행하지 말고, 어디서 할 수 있는지 안내한다.

[방금 만든 결과물 — 대표님이 이걸 고치라고 하면 이 내용을 기준으로 수정]
${lastOutputText}

지금까지 대표님한테서 파악한 특징(항상 참고할 것):
${memoryText}

이번 대화에서 새롭게 알게 된 대표님의 취향·스타일·선호가 있으면 memoryFacts에 짧은 문장으로
적는다(없으면 빈 배열). 예: "제목은 궁금증 유발형을 선호함", "너무 뻔한 설명 지양".

JSON으로만 답한다: {"kind": "question"|"act"|"reply", "text": "...", "cleanInstruction": "...(act일 때만)", "isRevision": true|false, "memoryFacts": ["..."]}`

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

import { callClaudeJson, callClaudeVisionJson, type VisionImageInput } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import {
  buildAgencyDraftSystemPrompt,
  buildAgencyDraftUserPrompt,
  buildAgencyReferenceSystemPrompt,
  buildAgencyReferenceUserPrompt,
  buildAgencyFullFormatSystemPrompt,
  buildAgencyFullFormatUserPrompt,
} from './agencyPrompts.js'
import type { ThreadDraft, ThreadFormatDraft } from '../types/thread.js'

function parseDraft(raw: unknown): ThreadDraft {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 초안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return { text: typeof rec.text === 'string' ? rec.text : '' }
}

function parseFormatDraft(raw: unknown): ThreadFormatDraft {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return {
    format: typeof rec.format === 'string' ? rec.format : '',
    text: typeof rec.text === 'string' ? rec.text : '',
  }
}

// 대행 관리(클라이언트별 글) 전용 — "마잘남 – 글쓰기" 프롬프트를 쓴다.
// 스레드 위원회(runThreadReview.ts)와는 완전히 별개 함수라 서로 섞이지 않는다.
export async function generateAgencyDraft(params: {
  apiKey: string
  topic: string
  business: string
  persona: string
  recentPosts?: string[]
  previousDraft?: ThreadDraft
  feedback?: string
  referenceImages?: VisionImageInput[]
  marketFindings?: string
  hookReference?: string
}): Promise<ThreadDraft> {
  const { apiKey, topic, business, persona, recentPosts, previousDraft, feedback, referenceImages, marketFindings, hookReference } =
    params
  const system = buildAgencyDraftSystemPrompt({ business, persona, recentPosts, marketFindings, hookReference })
  const user = buildAgencyDraftUserPrompt({ topic, previousDraft, feedback })

  if (referenceImages && referenceImages.length > 0) {
    const raw = await callClaudeVisionJson({
      apiKey,
      system,
      user,
      images: referenceImages,
      maxTokens: 1536,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseDraft(raw)
  }
  const raw = await callClaudeJson({
    apiKey,
    system,
    user,
    maxTokens: 1536,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseDraft(raw)
}

// 하루 초안 N개를 "한 번의 호출"로 생성한다 — 예전엔 초안마다 따로 불러서
// (5개면 5번) 거대한 시스템 프롬프트와 레퍼런스 이미지 토큰이 매번 반복
// 과금됐다(대표님 결정: 비용 절감을 위해 묶음). 겹침 방지는 recentPosts를
// 프롬프트에 넣고 "서로+이력과 겹치지 말 것"을 지시하는 것으로 대체.
export async function generateAgencyDraftBatch(params: {
  apiKey: string
  topic: string
  business: string
  persona: string
  count: number
  recentPosts?: string[]
  referenceImages?: VisionImageInput[]
  hookReference?: string
}): Promise<ThreadDraft[]> {
  const { apiKey, topic, business, persona, count, recentPosts, referenceImages, hookReference } = params
  const system = buildAgencyReferenceSystemPrompt({ business, persona, variantCount: count, recentPosts, hookReference })
  const user = buildAgencyReferenceUserPrompt({ topic, variantCount: count })

  const raw =
    referenceImages && referenceImages.length > 0
      ? await callClaudeVisionJson({
          apiKey,
          system,
          user,
          images: referenceImages,
          maxTokens: 8192,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })
      : await callClaudeJson({
          apiKey,
          system,
          user,
          maxTokens: 8192,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  if (!Array.isArray(rec.drafts)) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  return rec.drafts.map((d) => parseDraft(d))
}

export async function generateAgencyVariantsWithReferences(params: {
  apiKey: string
  topic: string
  business: string
  persona: string
  referenceImages: VisionImageInput[]
  variantCount?: number
  note?: string
}): Promise<ThreadDraft[]> {
  const { apiKey, topic, business, persona, referenceImages, variantCount = 3, note } = params
  const raw = await callClaudeVisionJson({
    apiKey,
    system: buildAgencyReferenceSystemPrompt({ business, persona, variantCount }),
    user: buildAgencyReferenceUserPrompt({ topic, variantCount, note }),
    images: referenceImages,
    maxTokens: 2048,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  if (!Array.isArray(rec.drafts)) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  return rec.drafts.map((d) => parseDraft(d))
}

// 대표님 "마잘남 – 글쓰기" 프롬프트의 9가지 유형 전체 생성.
export async function generateAgencyFullFormatSet(params: {
  apiKey: string
  topic: string
  business: string
  persona: string
  referenceImages?: VisionImageInput[]
  note?: string
}): Promise<ThreadFormatDraft[]> {
  const { apiKey, topic, business, persona, referenceImages, note } = params
  const system = buildAgencyFullFormatSystemPrompt({ business, persona })
  const user = buildAgencyFullFormatUserPrompt({ topic, note })

  const raw =
    referenceImages && referenceImages.length > 0
      ? await callClaudeVisionJson({
          apiKey,
          system,
          user,
          images: referenceImages,
          maxTokens: 8192,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })
      : await callClaudeJson({
          apiKey,
          system,
          user,
          maxTokens: 8192,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  if (!Array.isArray(rec.drafts)) {
    throw new Error('스레드 시안 응답 형식이 올바르지 않습니다.')
  }
  return rec.drafts.map((d) => parseFormatDraft(d))
}

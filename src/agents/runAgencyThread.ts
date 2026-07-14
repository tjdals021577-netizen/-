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
}): Promise<ThreadDraft> {
  const { apiKey, topic, business, persona, recentPosts, previousDraft, feedback, referenceImages, marketFindings } =
    params
  const system = buildAgencyDraftSystemPrompt({ business, persona, recentPosts, marketFindings })
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
          maxTokens: 4096,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })
      : await callClaudeJson({
          apiKey,
          system,
          user,
          maxTokens: 4096,
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

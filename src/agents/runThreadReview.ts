import { callClaudeJson, callClaudeVisionJson, type VisionImageInput } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import {
  buildThreadDraftSystemPrompt,
  buildThreadDraftUserPrompt,
  buildThreadReferenceSystemPrompt,
  buildThreadReferenceUserPrompt,
  buildThreadReferenceTextSystemPrompt,
  buildThreadReferenceTextUserPrompt,
  buildThreadFullFormatSystemPrompt,
  buildThreadFullFormatUserPrompt,
  buildThreadReviewSystemPrompt,
  buildThreadReviewUserPrompt,
  buildThreadReviewBatchSystemPrompt,
  buildThreadReviewBatchUserPrompt,
} from './threadPrompts.js'
import { THREAD_RUBRIC } from './threadRubric.js'
import type { ThreadDraft, ThreadFormatDraft, ThreadReview } from '../types/thread.js'
import type { CriterionScore, FlagSeverity, RevisionFlag } from '../types/domain.js'

const FLAG_SEVERITIES: FlagSeverity[] = ['info', 'check', 'risk']

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseDraft(raw: unknown): ThreadDraft {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 초안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return { text: typeof rec.text === 'string' ? rec.text : '' }
}

function parseCriteriaScores(raw: unknown): CriterionScore[] {
  const validIds = new Set(THREAD_RUBRIC.map((c) => c.id))
  if (!Array.isArray(raw)) return []
  const out: CriterionScore[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const criterionId = String(rec.criterionId ?? '')
    if (!validIds.has(criterionId)) continue
    const score = Math.max(0, Math.min(25, toNumber(rec.score)))
    const comment = typeof rec.comment === 'string' ? rec.comment : ''
    out.push({ criterionId, score, comment })
  }
  return out
}

function parseFlags(raw: unknown): RevisionFlag[] {
  if (!Array.isArray(raw)) return []
  const out: RevisionFlag[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const severity = FLAG_SEVERITIES.includes(rec.severity as FlagSeverity)
      ? (rec.severity as FlagSeverity)
      : 'info'
    out.push({
      quote: typeof rec.quote === 'string' ? rec.quote : '',
      reason: typeof rec.reason === 'string' ? rec.reason : '',
      severity,
    })
  }
  return out
}

function parseThreadReview(raw: unknown): ThreadReview {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 채점 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const criteriaScores = parseCriteriaScores(rec.criteriaScores)
  const scoredSum = criteriaScores.reduce((s, c) => s + c.score, 0)
  const declaredTotal = toNumber(rec.totalScore, scoredSum)
  const totalScore =
    criteriaScores.length === THREAD_RUBRIC.length &&
    Math.abs(declaredTotal - scoredSum) > 5
      ? scoredSum
      : Math.max(0, Math.min(100, declaredTotal))

  return {
    totalScore,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    criteriaScores,
    flags: parseFlags(rec.flags),
  }
}

export async function generateThreadDraft(params: {
  apiKey: string
  topic: string
  brandVoice?: string
  recentPosts?: string[]
  previousDraft?: ThreadDraft
  feedback?: string
  referenceImages?: VisionImageInput[]
  marketFindings?: string
}): Promise<ThreadDraft> {
  const { apiKey, topic, brandVoice, recentPosts, previousDraft, feedback, referenceImages, marketFindings } =
    params
  // 클라이언트에 레퍼런스 이미지가 등록돼 있으면 비전 호출로 스타일을
  // 참고시킨다 — 없으면 기존과 동일한 텍스트 전용 호출.
  if (referenceImages && referenceImages.length > 0) {
    const raw = await callClaudeVisionJson({
      apiKey,
      system: buildThreadDraftSystemPrompt({ brandVoice, recentPosts, marketFindings }),
      user: buildThreadDraftUserPrompt({ topic, previousDraft, feedback }),
      images: referenceImages,
      maxTokens: 1536,
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    return parseDraft(raw)
  }
  const raw = await callClaudeJson({
    apiKey,
    system: buildThreadDraftSystemPrompt({ brandVoice, recentPosts, marketFindings }),
    user: buildThreadDraftUserPrompt({ topic, previousDraft, feedback }),
    maxTokens: 1536,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseDraft(raw)
}

// 클라이언트가 초안이 마음에 안 들 때, 새 레퍼런스 이미지를 넣고 "3개
// 시안"을 한 번에 받아보는 용도. 점수 매기기/자동 재생성 루프 없이 후보만
// 여러 개 제시해서 API를 반복 호출하지 않고 사람이 직접 고르게 한다.
export async function generateThreadVariantsWithReferences(params: {
  apiKey: string
  topic: string
  brandVoice?: string
  referenceImages: VisionImageInput[]
  variantCount?: number
  note?: string
}): Promise<ThreadDraft[]> {
  const { apiKey, topic, brandVoice, referenceImages, variantCount = 3, note } = params
  const raw = await callClaudeVisionJson({
    apiKey,
    system: buildThreadReferenceSystemPrompt({ brandVoice, variantCount }),
    user: buildThreadReferenceUserPrompt({ topic, variantCount, note }),
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

// 레퍼런스 "글 텍스트"를 붙여넣어 시안을 받는 버전. 이미지 비전 호출 대신
// 순수 텍스트 호출(callClaudeJson)이라 토큰이 훨씬 덜 든다(대표님 결정). 후킹·
// 구조만 따서 마잘남 목소리로 리라이팅, 점수 루프 없이 후보 여러 개만 제시한다.
export async function generateThreadVariantsFromText(params: {
  apiKey: string
  topic: string
  referenceText: string
  variantCount?: number
  note?: string
}): Promise<ThreadDraft[]> {
  const { apiKey, topic, referenceText, variantCount = 3, note } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildThreadReferenceTextSystemPrompt(variantCount),
    user: buildThreadReferenceTextUserPrompt({ topic, variantCount, referenceText, note }),
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

// 대표님이 실제 쓰던 마스터 프롬프트 그대로 — 7가지 형식 + 질문형 후킹
// 버전까지 총 8개를 한 번에 받는다. 오직 스레드 위원회(마잘남 본인 계정)
// 전용이라 브랜드 목소리를 따로 받지 않고 항상 MAJALNAM_THREAD_VOICE를 쓴다.
export async function generateThreadFullFormatSet(params: {
  apiKey: string
  topic: string
  referenceImages?: VisionImageInput[]
  note?: string
  formats?: string[]
}): Promise<ThreadFormatDraft[]> {
  const { apiKey, topic, referenceImages, note, formats } = params
  const system = buildThreadFullFormatSystemPrompt(formats)
  const user = buildThreadFullFormatUserPrompt({ topic, note, formatCount: formats?.length })

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

export async function runThreadReview(params: {
  apiKey: string
  draft: ThreadDraft
}): Promise<ThreadReview> {
  const { apiKey, draft } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildThreadReviewSystemPrompt(),
    user: buildThreadReviewUserPrompt(draft),
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseThreadReview(raw)
}

// 초안 여러 개를 한 번의 호출로 채점한다 — 대행처럼 하루 5개씩 뽑는 흐름에서
// 채점을 5번 따로 부르면 거대한 시스템 프롬프트가 5번 반복 과금되는 문제를
// 없앤다(API 비용 절감, 대표님 결정). 결과 배열은 입력 순서와 같고, 모델이
// 일부만 채점해서 개수가 모자라면 남는 초안엔 "채점 누락" 리뷰를 채운다.
export async function runThreadReviewBatch(params: {
  apiKey: string
  drafts: ThreadDraft[]
}): Promise<ThreadReview[]> {
  const { apiKey, drafts } = params
  if (drafts.length === 0) return []
  const raw = await callClaudeJson({
    apiKey,
    system: buildThreadReviewBatchSystemPrompt(drafts.length),
    user: buildThreadReviewBatchUserPrompt(drafts),
    maxTokens: 8192,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('스레드 일괄 채점 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const items = Array.isArray(rec.reviews) ? rec.reviews : []
  return drafts.map((_, i) =>
    items[i] !== undefined
      ? parseThreadReview(items[i])
      : { totalScore: 0, summary: '채점 누락 — 다시 시도해주세요.', criteriaScores: [], flags: [] },
  )
}

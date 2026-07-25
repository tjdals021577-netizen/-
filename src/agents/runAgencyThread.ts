import { callClaudeJson, callClaudeVisionJson, CLAUDE_MODEL_CHEAP, type VisionImageInput, type VisionDocInput } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import {
  buildAgencyReferenceSystemPrompt,
  buildAgencyReferenceUserPrompt,
  buildAgencyFullFormatSystemPrompt,
  buildAgencyFullFormatUserPrompt,
} from './agencyPrompts.js'
import type { ThreadDraft, ThreadFormatDraft } from '../types/thread.js'

const DIGEST_BATCH = 12

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// 이미지 한 묶음(+선택적 PDF)을 읽어 스타일 요약 텍스트 하나를 만든다(내부용).
async function digestBatch(
  apiKey: string,
  images: VisionImageInput[],
  documents: VisionDocInput[],
): Promise<string> {
  const system = `당신은 카피라이팅 스타일 분석가입니다. 첨부된 이미지/PDF는 한 클라이언트의 실제 스레드/카피
레퍼런스입니다. 여기서 공통으로 드러나는 "재사용 가능한 글쓰기 스타일"만 뽑아 텍스트 가이드로
정리하세요. 포함: 후킹(첫 문장) 패턴, 말투·톤, 문장 길이·리듬, 이모지/줄바꿈 습관, 자주 쓰는 표현·구성,
CTA 방식, 피해야 할 것. 구체적 문구·숫자·에피소드는 베끼지 말고 "스타일 규칙"만 요약합니다.
한국어 불릿 6~10개, 400자 내외. 아래 JSON만 출력: { "digest": string }`
  const raw = await callClaudeVisionJson({
    apiKey,
    system,
    user: '이 레퍼런스들의 카피 스타일을 재사용 가능한 규칙으로 요약해 JSON으로만 답하세요.',
    images,
    documents,
    maxTokens: 800,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  if (typeof raw !== 'object' || raw === null) return ''
  const digest = (raw as Record<string, unknown>).digest
  return typeof digest === 'string' ? digest : ''
}

// 클라이언트 레퍼런스(이미지 전부 + PDF)를 "한 번만" 읽어 재사용 가능한 텍스트 스타일
// 요약으로 뽑는다. 이후 매일 생성은 이 텍스트만 참고 → 이미지 비전 토큰을 매일 반복
// 과금하지 않는다(비용 95%+ 절감). 온보딩 시 1회, 또는 이미지가 바뀌었을 때만 호출.
// ⚠️ 수십 장을 한 호출에 다 넣으면 모델이 과부하로 응답이 부실해진다 → 12장씩 나눠
// 각각 요약하고(모든 이미지를 다 읽는다), 여러 요약을 하나의 일관된 가이드로 합친다.
export async function digestReferenceStyle(params: {
  apiKey: string
  referenceImages: VisionImageInput[]
  documents?: VisionDocInput[]
}): Promise<string> {
  const { apiKey, referenceImages, documents = [] } = params
  if (referenceImages.length === 0 && documents.length === 0) return ''

  // 이미지가 없고 PDF만 있으면 한 번만. 이미지가 있으면 12장씩 배치(PDF는 첫 배치에만).
  const batches = referenceImages.length > 0 ? chunk(referenceImages, DIGEST_BATCH) : [[]]
  const partials: string[] = []
  for (let i = 0; i < batches.length; i++) {
    const d = await digestBatch(apiKey, batches[i], i === 0 ? documents : [])
    if (d.trim()) partials.push(d.trim())
  }
  if (partials.length === 0) return ''
  if (partials.length === 1) return partials[0]

  // 여러 배치 요약을 하나의 일관된 스타일 가이드로 병합(텍스트만 — 이미지 없음, 저렴).
  const merged = await callClaudeJson({
    apiKey,
    model: CLAUDE_MODEL_CHEAP,
    system: `여러 묶음에서 각각 뽑은 "카피 스타일 요약"들을 받아, 중복을 제거하고 서로 보완해 하나의
일관된 스타일 가이드로 합치세요. 후킹 패턴·말투·문장 길이·이모지/줄바꿈·자주 쓰는 표현·CTA·피해야 할 것을
아우르되, 한국어 불릿 8~12개, 600자 내외로 압축. 아래 JSON만 출력: { "digest": string }`,
    user: partials.map((p, i) => `[요약 ${i + 1}]\n${p}`).join('\n\n'),
    maxTokens: 900,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  if (typeof merged !== 'object' || merged === null) return partials.join('\n')
  const digest = (merged as Record<string, unknown>).digest
  return typeof digest === 'string' && digest.trim() ? digest : partials.join('\n')
}

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
  styleDigest?: string
}): Promise<ThreadDraft[]> {
  const { apiKey, topic, business, persona, count, recentPosts, referenceImages, hookReference, styleDigest } = params
  const system = buildAgencyReferenceSystemPrompt({ business, persona, variantCount: count, recentPosts, hookReference, styleDigest })
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
  styleDigest?: string
}): Promise<ThreadFormatDraft[]> {
  const { apiKey, topic, business, persona, referenceImages, note, styleDigest } = params
  const system = buildAgencyFullFormatSystemPrompt({ business, persona, styleDigest })
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

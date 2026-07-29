import {
  callClaudeJson,
  callClaudeVisionJson,
  CLAUDE_MODEL_CHEAP,
  type VisionImageInput,
} from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import {
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildCombinedReviewSystemPrompt,
} from './blogPrompts.js'
import { BLOG_RUBRICS } from './blogRubric.js'
import type { BlogDraft, BlogReview, BlogRole } from '../types/blog.js'
import type {
  CriterionScore,
  FlagSeverity,
  RevisionFlag,
} from '../types/domain.js'

const FLAG_SEVERITIES: FlagSeverity[] = ['info', 'check', 'risk']

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseDraft(raw: unknown): BlogDraft {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('블로그 초안 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return {
    title: typeof rec.title === 'string' ? rec.title : '',
    body: typeof rec.body === 'string' ? rec.body : '',
    photoPlacements: Array.isArray(rec.photoPlacements)
      ? rec.photoPlacements.filter((p): p is string => typeof p === 'string')
      : [],
  }
}

function parseCriteriaScores(role: BlogRole, raw: unknown): CriterionScore[] {
  const validIds = new Set(BLOG_RUBRICS[role].map((c) => c.id))
  if (!Array.isArray(raw)) return []
  const out: CriterionScore[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const criterionId = String(rec.criterionId ?? '')
    if (!validIds.has(criterionId)) continue
    const score = Math.max(0, Math.min(20, toNumber(rec.score)))
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

function parseBlogReview(role: BlogRole, raw: unknown): BlogReview {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('블로그 채점 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const criteriaScores = parseCriteriaScores(role, rec.criteriaScores)
  const scoredSum = criteriaScores.reduce((s, c) => s + c.score, 0)
  const declaredTotal = toNumber(rec.totalScore, scoredSum)
  const totalScore =
    criteriaScores.length === BLOG_RUBRICS[role].length &&
    Math.abs(declaredTotal - scoredSum) > 5
      ? scoredSum
      : Math.max(0, Math.min(100, declaredTotal))

  return {
    role,
    totalScore,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    criteriaScores,
    flags: parseFlags(rec.flags),
  }
}

export async function generateBlogDraft(params: {
  apiKey: string
  topic: string
  keyPoints: string
  photoDescriptions: string
  brandContext?: string
  previousDraft?: BlogDraft
  feedback?: string
  marketFindings?: string
  pastFeedback?: string
  photoImages?: VisionImageInput[]
  blogVoice?: string
}): Promise<BlogDraft> {
  const {
    apiKey,
    topic,
    keyPoints,
    photoDescriptions,
    brandContext,
    previousDraft,
    feedback,
    marketFindings,
    pastFeedback,
    photoImages,
    blogVoice,
  } = params
  const user = buildDraftUserPrompt({
    topic,
    keyPoints,
    photoDescriptions,
    previousDraft,
    feedback,
  })
  const hasPhotos = !!(photoImages && photoImages.length > 0)

  // 본문 2,500~3,000자(한국어)면 4096 토큰으로는 JSON이 잘려 파싱 실패하던
  // 위험이 있었다 → 8192로 넉넉히. 그리고 응답이 잘리거나 안 나오는 일시적
  // 실패에 대비해 최대 3번까지 다시 시도한다(라이터 반복 오류 방지).
  //
  // 특히 "방금 글 이렇게 고쳐줘"(재수정) 요청은, 모델이 JSON 대신 고친 본문을
  // 줄글로 그냥 이어 써버려서 "모델 응답에서 JSON을 찾지 못했습니다"로 실패하는
  // 일이 잦았다(실제 발생) — 리믹서와 동일하게, 재시도할 땐 같은 프롬프트를
  // 그대로 다시 보내지 않고 "JSON만 내라"는 강한 지시를 덧붙여 다르게 시도한다.
  const strictReminder =
    '\n\n[매우 중요] 앞선 응답이 JSON 형식이 아니었습니다. 이번에는 설명·머리말·인사·' +
    '마크다운 코드블록(```) 없이, 지정된 스키마의 JSON 객체 "하나만" 출력하세요. ' +
    '첫 글자는 반드시 {, 마지막 글자는 반드시 } 여야 합니다. 본문(body)은 JSON 문자열 ' +
    '값 안에 넣고 줄바꿈은 \\n으로 이스케이프하세요.'

  // 두 가지 실패 모드를 각각 다른 방법으로 막는다:
  // ① 줄글로 새서 "JSON을 찾지 못함" → 응답을 '{'로 시작하게 강제(prefill)하면 해결.
  // ② prefill을 썼을 때 드물게 "텍스트가 없음"(빈 응답)이 나는 경우 → prefill을
  //    빼고 "JSON만 내라"는 강한 지시로 대체하면 해결.
  // 그래서 시도마다 prefill·강한지시 조합을 바꿔가며(둘을 서로 보완) 세 번까지
  // 시도한다 — 어느 한 조합이 막히면 다른 조합이 성공한다.
  async function once(strict: boolean, usePrefill: boolean): Promise<BlogDraft> {
    const effectiveUser = strict ? user + strictReminder : user
    // 실제 사진이 첨부되면 AI가 사진을 직접 보고 배치를 제안하도록 비전 호출로
    // 전환한다(이 경우 웹서치 도구는 같이 못 쓴다). 사진이 없으면 지식 베이스 기반.
    const raw = hasPhotos
      ? await callClaudeVisionJson({
          apiKey,
          system: buildDraftSystemPrompt(brandContext, marketFindings, true, pastFeedback, blogVoice),
          user: effectiveUser,
          images: photoImages as VisionImageInput[],
          maxTokens: 8192,
          assistantPrefill: usePrefill ? '{' : undefined,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })
      : await callClaudeJson({
          apiKey,
          system: buildDraftSystemPrompt(brandContext, marketFindings, false, pastFeedback, blogVoice),
          user: effectiveUser,
          maxTokens: 8192,
          timeoutMs: 120_000,
          assistantPrefill: usePrefill ? '{' : undefined,
          onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
        })
    return parseDraft(raw)
  }

  // [strict, usePrefill] 조합. 0번: prefill로 줄글 차단. 1번: prefill 빼고 강한
  // 지시(빈 응답 대비). 2번: 둘 다 켠 최후의 시도.
  const attempts: Array<[boolean, boolean]> = [
    [false, true],
    [true, false],
    [true, true],
  ]
  let lastErr: unknown
  for (const [strict, usePrefill] of attempts) {
    try {
      return await once(strict, usePrefill)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

export async function runBlogAgentReview(params: {
  apiKey: string
  role: BlogRole
  draft: BlogDraft
}): Promise<BlogReview> {
  const { apiKey, role, draft } = params
  const raw = await callClaudeJson({
    apiKey,
    // 채점은 판단만 하므로 더 싼 Haiku로(비용 절감). 이 경로는 블로그 직접
    // 작성 화면의 3인 실시간 표시용이라 3콜 구조를 유지한다(자동/팀채팅 경로는
    // runBlogReviewsResilient에서 1콜로 통합).
    model: CLAUDE_MODEL_CHEAP,
    system: buildReviewSystemPrompt(role),
    user: buildReviewUserPrompt(draft),
    // 채점은 검색 없는 단순 호출이라 보통 1분 안에 끝난다 — 기본값(260초)을
    // 그대로 두면 채점 하나가 걸렸을 때 260초를 통째로 기다리다가 크론
    // 함수 제한(300초)까지 같이 넘겨버리는 문제가 실제로 있었다("260초 안에
    // 응답이 없어 중단" 에러가 주간 자동 기획에서 확인됨). 120초면 충분.
    timeoutMs: 120_000,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseBlogReview(role, raw)
}

// 3인 위원회(SEO·카피·경험)를 각각 API 호출하면 글 전문을 3번 재전송해 비용이
// 컸다 — 한 번의 호출로 세 관점을 모두 채점한다(대표님 결정: 3콜 → 1콜).
// 게다가 채점은 "판단"만 하므로 더 싼 Haiku로 돌려 추가 절감. 채점 호출이
// 실패해도(응답 잘림 등) 빈 배열을 돌려줘 초안은 살린다(호출부에서 "채점 실패,
// 내용은 저장됨"으로 처리). roles 인자는 하위호환용으로 남기되 무시한다(항상 3역할).
export async function runBlogReviewsResilient(params: {
  apiKey: string
  roles: BlogRole[]
  draft: BlogDraft
}): Promise<BlogReview[]> {
  const { apiKey, draft } = params
  try {
    const raw = await callClaudeJson({
      apiKey,
      model: CLAUDE_MODEL_CHEAP,
      system: buildCombinedReviewSystemPrompt(),
      user: buildReviewUserPrompt(draft),
      maxTokens: 4096,
      timeoutMs: 120_000,
      // 채점 응답도 '{'로 시작하도록 강제 — "채점 실패"(JSON 못 찾음)를 줄인다.
      assistantPrefill: '{',
      onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
    })
    const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const reviewsRaw = Array.isArray(rec.reviews) ? rec.reviews : []
    const out: BlogReview[] = []
    for (const item of reviewsRaw) {
      if (typeof item !== 'object' || item === null) continue
      const r = item as Record<string, unknown>
      const role = r.role
      if (role !== 'seo' && role !== 'copywriting' && role !== 'experience') continue
      out.push(parseBlogReview(role, r))
    }
    return out
  } catch {
    // 채점 호출 전체 실패 시 빈 배열 — 초안은 살리고 "채점 실패"로 처리된다.
    return []
  }
}

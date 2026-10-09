// 마잘남 블로그 자동화 재설계 — 모델 호출부(키워드 생성 / 글쓰기 / blog-brain 분석).
// 프롬프트 본문은 majalnamBlogPrompts.ts(대표님 원문 그대로). 여기선 호출·파싱·폴백만.
import { callClaudeJson, CLAUDE_MODEL_CHEAP, type Effort, type SystemBlock, type UsageCallback } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import { KEYWORD_SYSTEM, buildKeywordUser, BLOG_BRAIN_SYSTEM, buildBlogBrainUser } from './majalnamBlogPrompts.js'
import type { BlogDraft } from '../types/blog.js'
import {
  READER_STAGES,
  type BlogBrainResult,
  type BlogKeywordResult,
  type OfficialNotice,
  type ReaderStage,
  type TopPostData,
} from '../types/blogBrain.js'

function track(onUsage?: UsageCallback): UsageCallback {
  return (usage) => {
    onUsage?.(usage)
    recordSpendUsd(estimateCostUsd(usage))
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

// ───────────────────────── 2번: 키워드 생성 ─────────────────────────

// 키워드 단계가 실패해도 글쓰기는 멈추지 않는다 — 주제 기반 기본값으로 진행하고
// 결과에 fallback 표시를 남겨 결재함에서 대표님이 알 수 있게 한다.
function fallbackKeyword(topic: string): BlogKeywordResult {
  const base = topic.replace(/\(.*?\)/g, '').trim() || '스레드 계정 문의 늘리는 법'
  return {
    mainKeyword: base,
    subKeywords: [],
    readerStage: '②',
    searchVolume: null,
    reason: '키워드 생성 단계 실패 — 주제 기반 기본값으로 진행',
  }
}

export async function generateBlogKeywords(params: {
  apiKey: string
  topic: string
  keywordVolumes: string
  recentKeywords: string[]
  stageCounts: Record<ReaderStage, number>
  onUsage?: UsageCallback
}): Promise<{ keyword: BlogKeywordResult; fallback: boolean }> {
  const { apiKey, topic, keywordVolumes, recentKeywords, stageCounts, onUsage } = params
  const user = buildKeywordUser({ topic, keywordVolumes, recentKeywords, stageCounts })
  const hasVolumeData = keywordVolumes.trim() !== '' && keywordVolumes.trim() !== '없음'
  for (const strict of [false, true]) {
    try {
      const raw = rec(
        await callClaudeJson({
          apiKey,
          // 키워드 고르기는 "판단"이라 싼 모델로 충분(비용 절감 원칙).
          model: CLAUDE_MODEL_CHEAP,
          effort: 'low',
          system: KEYWORD_SYSTEM,
          user: strict ? `${user}\n\n[매우 중요] 지정된 스키마의 JSON 객체 하나만 출력하라. 설명·코드블록 금지.` : user,
          // Haiku 5.5는 생각 토큰도 한도에 포함 — 짧은 JSON이라도 잘리지 않게 여유를 둔다.
          maxTokens: 2048,
          timeoutMs: 60_000,
          onUsage: track(onUsage),
        }),
      )
      const mainKeyword = str(raw.mainKeyword).trim()
      if (!mainKeyword) throw new Error('mainKeyword 없음')
      const stage = str(raw.readerStage).trim() as ReaderStage
      const volume = typeof raw.searchVolume === 'number' && Number.isFinite(raw.searchVolume) ? raw.searchVolume : null
      return {
        keyword: {
          mainKeyword,
          subKeywords: arr(raw.subKeywords)
            .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
            .map((s) => s.trim())
            .slice(0, 2),
          readerStage: READER_STAGES.includes(stage) ? stage : '②',
          // 검색량 데이터가 없는데 숫자가 오면 지어낸 것 — 코드에서 한 번 더 막는다.
          searchVolume: hasVolumeData ? volume : null,
          reason: str(raw.reason),
        },
        fallback: false,
      }
    } catch {
      // 다음 시도(강한 지시) → 그래도 실패하면 기본값.
    }
  }
  return { keyword: fallbackKeyword(topic), fallback: true }
}

// ───────────────────────── 1번: 블로그 글쓰기 ─────────────────────────

function parseDraft(raw: unknown): BlogDraft {
  const r = rec(raw)
  const title = str(r.title).trim()
  const body = str(r.body).trim()
  if (!title || !body) throw new Error('블로그 초안 응답에 title/body가 없습니다.')
  return {
    title,
    body,
    photoPlacements: arr(r.photoPlacements).filter((p): p is string => typeof p === 'string'),
  }
}

// 시도 순서 — 1차는 대표님 결정대로 깊은 생각(high). 이 프롬프트는 "작성 → 15항목 자체 채점
// → 고친 뒤 출력"이라 생각 단계에서 글을 한 번 다 써 보고 고치므로 생각 토큰이 많다(생각도
// max_tokens에 포함). 8192 한도로는 본문 JSON이 중간에 잘려 "JSON을 찾지 못했습니다"로
// 실패했다(2026-10 실사용). 그래서 한도를 넉넉히 주고, 그래도 잘리거나 시간이 모자라면
// 생각 깊이를 낮춰 끝까지 받아낸다. (SDK 비스트리밍 상한 ≈21k 토큰 안쪽.)
const DRAFT_ATTEMPTS: { effort: Effort; maxTokens: number; strict: boolean }[] = [
  { effort: 'high', maxTokens: 16_000, strict: false },
  { effort: 'medium', maxTokens: 12_000, strict: true },
  { effort: 'low', maxTokens: 8192, strict: true },
]

export async function generateMajalnamBlogDraft(params: {
  apiKey: string
  system: SystemBlock[]
  user: string
  onUsage?: UsageCallback
  // 이 시각(ms)까지 끝내야 한다(크론·팀채팅 함수 300초 한도 — 앞의 키워드, 뒤의 채점 몫 제외).
  deadline?: number
}): Promise<BlogDraft> {
  const { apiKey, system, user, onUsage, deadline = Date.now() + 220_000 } = params
  // prefill은 모델 미지원이라 쓰지 않는다(claude.ts 참고) — 2·3차에 "JSON만" 강한 지시.
  const strictReminder =
    '\n\n[매우 중요] 설명·머리말·마크다운 코드블록(```) 없이, ' +
    '지정된 스키마의 JSON 객체 "하나만" 출력하세요. 첫 글자는 {, 마지막 글자는 } 여야 합니다. ' +
    '본문(body)의 줄바꿈은 \\n으로 이스케이프하세요.'
  let lastErr: unknown = new Error('블로그 초안을 만들 시간이 부족했습니다.')
  for (const [i, attempt] of DRAFT_ATTEMPTS.entries()) {
    const left = deadline - Date.now()
    // 마지막(가벼운) 시도는 짧게도 끝나므로 40초만 남아도 해 본다.
    if (left < (i === DRAFT_ATTEMPTS.length - 1 ? 40_000 : 60_000)) continue
    try {
      const raw = await callClaudeJson({
        apiKey,
        system,
        user: attempt.strict ? user + strictReminder : user,
        maxTokens: attempt.maxTokens,
        effort: attempt.effort,
        // 1차가 시간을 다 쓰지 않게 — 뒤 시도 몫(최소 40초)을 남긴다.
        timeoutMs: Math.max(30_000, i === DRAFT_ATTEMPTS.length - 1 ? left - 5_000 : left - 45_000),
        onUsage: track(onUsage),
      })
      return parseDraft(raw)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

// ───────────────────────── 제목 길이 자동 교정 ─────────────────────────

// 규칙 1(제목 25~35자, 메인 키워드 앞쪽, 효과 단정 금지)을 어긴 제목만 싼 모델로 다시 쓴다.
// 제목 하나라 비용은 1회 약 $0.001. 결과는 코드로 다시 검증하고(길이·키워드·금지 표현),
// 2번 다 통과 못 하면 원래 제목을 그대로 둔다(→ 결재함 상자에 "못 고친 것"으로 표시).
export async function fixBlogTitle(params: {
  apiKey: string
  title: string
  mainKeyword: string
  subKeywords: string[]
  isValid: (title: string) => boolean
  onUsage?: UsageCallback
  // 이 시각(ms)을 넘기면 더 시도하지 않는다(뒤의 채점·저장 몫 보호).
  deadline?: number
}): Promise<string | undefined> {
  const { apiKey, title, mainKeyword, subKeywords, isValid, onUsage, deadline = Date.now() + 60_000 } = params
  const user = `[현재 제목] ${title} (${title.trim().length}자)
[메인 키워드] ${mainKeyword}
[서브 키워드] ${subKeywords.join(', ') || '없음'}

위 네이버 블로그 제목을 아래 규칙에 맞게 고쳐라. 의미와 핵심 내용은 유지한다.
- 공백 포함 25~35자(반드시 이 범위)
- 메인 키워드를 앞쪽에 그대로 포함, 서브 키워드가 있으면 1개 포함
- "100%", "무조건", "보장" 같은 효과 단정 표현 금지
JSON만 출력: {"title": string}`
  for (let i = 0; i < 2; i++) {
    const left = deadline - Date.now()
    if (left < 10_000) break
    try {
      const raw = rec(
        await callClaudeJson({
          apiKey,
          model: CLAUDE_MODEL_CHEAP,
          effort: 'low',
          system: '당신은 네이버 블로그 제목 교정가다. 지정된 JSON만 출력한다.',
          user,
          maxTokens: 2048,
          timeoutMs: Math.min(30_000, left),
          onUsage: track(onUsage),
        }),
      )
      const fixed = str(raw.title).trim()
      if (fixed && isValid(fixed) && (!mainKeyword || fixed.includes(mainKeyword) || !title.includes(mainKeyword))) {
        return fixed
      }
    } catch {
      // 다음 시도 → 실패하면 원래 제목 유지.
    }
  }
  return undefined
}

// ───────────────────────── 3번: blog-brain 분석 ─────────────────────────

const BASIS3 = ['확정', '관찰', '참고'] as const
const BASIS2 = ['확정', '관찰'] as const

function parseMetric(v: unknown): { median: number; range: string } {
  const m = rec(v)
  const median = typeof m.median === 'number' && Number.isFinite(m.median) ? m.median : 0
  return { median, range: str(m.range) }
}

function parseBlogBrain(raw: unknown): BlogBrainResult {
  const r = rec(raw)
  const metrics = rec(r.metrics)
  let researchBlock = str(r.researchBlock).trim()
  // 확인된 게 없으면 억지로 채우지 않고 "변화 없음"으로 저장(지시서 7번).
  if (!researchBlock) researchBlock = '이번 주 규칙 변경 없음'
  // 지시서: 600자 이내. 모델이 넘기면 잘라서 글쓰기 프롬프트가 비대해지지 않게 한다.
  if (researchBlock.length > 700) researchBlock = `${researchBlock.slice(0, 700)}…`
  return {
    logicChanges: arr(r.logicChanges)
      .map(rec)
      .filter((x) => str(x.content).trim() !== '')
      .map((x) => {
        const basis = str(x.basis) as (typeof BASIS3)[number]
        return { content: str(x.content), basis: BASIS3.includes(basis) ? basis : '참고', source: str(x.source) }
      }),
    metrics: {
      chars: parseMetric(metrics.chars),
      photos: parseMetric(metrics.photos),
      headings: parseMetric(metrics.headings),
    },
    titlePatterns: arr(r.titlePatterns)
      .map(rec)
      .filter((x) => str(x.type).trim() !== '')
      .map((x) => ({ type: str(x.type), share: str(x.share), applyToMajalnam: str(x.applyToMajalnam) })),
    hookPatterns: arr(r.hookPatterns)
      .map(rec)
      .filter((x) => str(x.type).trim() !== '')
      .map((x) => ({ type: str(x.type), applyToMajalnam: str(x.applyToMajalnam) })),
    ruleOverrides: arr(r.ruleOverrides)
      .map(rec)
      .filter((x) => str(x.rule).trim() !== '' && BASIS2.includes(str(x.basis) as (typeof BASIS2)[number]))
      .map((x) => ({
        rule: str(x.rule),
        current: str(x.current),
        new: str(x.new),
        basis: str(x.basis) as (typeof BASIS2)[number],
      })),
    researchBlock,
  }
}

// 실패해도 던지지 않는다 — undefined면 호출부가 "지난주 research_block 유지"로 처리.
export async function analyzeBlogBrain(params: {
  apiKey: string
  notices: OfficialNotice[]
  posts: TopPostData[]
  lastWeekResult?: string
  onUsage?: UsageCallback
  // 이 시각(ms)까지 끝내야 한다(크론 시간 한도). 남은 시간이 1분 미만이면 다음 시도를 안 한다.
  deadline?: number
}): Promise<BlogBrainResult | undefined> {
  const { apiKey, notices, posts, lastWeekResult, onUsage, deadline = Date.now() + 540_000 } = params
  const strict = '\n\n[매우 중요] 지정된 스키마의 JSON 객체 하나만 출력하라. 설명·코드블록 금지.'
  // 1차 일반 → 2차 "JSON만" 강한 지시 → 3차 입력을 줄여(상위글 12개, 지난주 리포트 제외) 한 번 더.
  // 입력이 커서 응답이 잘리거나 시간이 걸린 경우에도 3차에서 끝까지 가도록.
  const attempts = [
    buildBlogBrainUser({ notices, posts, lastWeekResult }),
    buildBlogBrainUser({ notices, posts, lastWeekResult }) + strict,
    buildBlogBrainUser({ notices, posts: posts.slice(0, 12) }) + strict,
  ]
  for (const user of attempts) {
    const left = deadline - Date.now()
    if (left < 60_000) break
    try {
      const raw = await callClaudeJson({
        apiKey,
        system: BLOG_BRAIN_SYSTEM,
        user,
        maxTokens: 4096,
        timeoutMs: Math.min(150_000, left - 10_000),
        // 상위글 패턴 분석은 "보통" 깊이(비용 절감 A).
        effort: 'medium',
        onUsage: track(onUsage),
      })
      return parseBlogBrain(raw)
    } catch {
      // 다음 시도 → 전부 실패하면 undefined(호출부가 지난주 유지 + 다음 날 재시도).
    }
  }
  return undefined
}

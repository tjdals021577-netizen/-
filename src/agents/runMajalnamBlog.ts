// 마잘남 블로그 자동화 재설계 — 모델 호출부(키워드 생성 / 글쓰기 / blog-brain 분석).
// 프롬프트 본문은 majalnamBlogPrompts.ts(대표님 원문 그대로). 여기선 호출·파싱·폴백만.
import { callClaudeJson, CLAUDE_MODEL_CHEAP, type SystemBlock, type UsageCallback } from '../lib/claude.js'
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
          system: KEYWORD_SYSTEM,
          user: strict ? `${user}\n\n[매우 중요] 지정된 스키마의 JSON 객체 하나만 출력하라. 설명·코드블록 금지.` : user,
          maxTokens: 1024,
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

export async function generateMajalnamBlogDraft(params: {
  apiKey: string
  system: SystemBlock[]
  user: string
  onUsage?: UsageCallback
}): Promise<BlogDraft> {
  const { apiKey, system, user, onUsage } = params
  // 기존 라이터와 같은 방어: 1차 일반 → 2·3차 "JSON만" 강한 지시. (prefill은 모델
  // 미지원이라 쓰지 않는다 — claude.ts 참고.) 1,800~2,500자 본문이라 8192 토큰.
  const strictReminder =
    '\n\n[매우 중요] 앞선 응답이 JSON 형식이 아니었습니다. 설명·머리말·마크다운 코드블록(```) 없이, ' +
    '지정된 스키마의 JSON 객체 "하나만" 출력하세요. 첫 글자는 {, 마지막 글자는 } 여야 합니다. ' +
    '본문(body)의 줄바꿈은 \\n으로 이스케이프하세요.'
  let lastErr: unknown
  for (const strict of [false, true, true]) {
    try {
      const raw = await callClaudeJson({
        apiKey,
        system,
        user: strict ? user + strictReminder : user,
        maxTokens: 8192,
        timeoutMs: 120_000,
        onUsage: track(onUsage),
      })
      return parseDraft(raw)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
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
}): Promise<BlogBrainResult | undefined> {
  const { apiKey, notices, posts, lastWeekResult, onUsage } = params
  const user = buildBlogBrainUser({ notices, posts, lastWeekResult })
  for (const strict of [false, true]) {
    try {
      const raw = await callClaudeJson({
        apiKey,
        system: BLOG_BRAIN_SYSTEM,
        user: strict ? `${user}\n\n[매우 중요] 지정된 스키마의 JSON 객체 하나만 출력하라. 설명·코드블록 금지.` : user,
        maxTokens: 4096,
        timeoutMs: 180_000,
        onUsage: track(onUsage),
      })
      return parseBlogBrain(raw)
    } catch {
      // 다음 시도 → 그래도 실패하면 undefined.
    }
  }
  return undefined
}

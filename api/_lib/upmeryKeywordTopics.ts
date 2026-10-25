// 업메리 "검색 많은 주제" 주간 작업(2026-10-25) — 키워드도구 실제 검색량 → 코드 거르기 → 싼 모델이 업메리 손님 키워드만
// 골라 제목 → 네이버 블로그 상위 3개 글 실측(글자·사진)으로 순위 → blog_brain_reports에 저장(새 테이블 없음, brand =
// '업메리 검색주제'). 블로그 탭 주제 목록 맨 위에 검색량과 함께 뜬다. 네이버 검색광고 키가 없으면 아무것도 안 한다(AI 0원).
import { callClaudeJson, CLAUDE_MODEL_CHEAP } from '../../src/lib/claude.js'
import { estimateCostUsd } from '../../src/lib/budgetGuard.js'
import {
  buildKeywordTopicUser,
  parseKeywordTopics,
  preRank,
  prefilterKeywords,
  strengthOf,
  topicScore,
  UPMERY_KEYWORD_SEEDS,
  UPMERY_KEYWORD_TOPIC_SYSTEM,
  type KeywordTopic,
  type KeywordTopicReport,
} from '../../src/agents/upmeryKeywordTopics.js'
import { listUpmeryTopics } from '../../src/agents/upmeryTopicBank.js'
import { fetchKeywordVolumeRows, hasNaverAdKeys, measureNaverPost, naverSearchPageTop } from './naverBlogData.js'
import { getRecentMainKeywords, kstIsoWeekKey } from './blogStore.js'
import { supabaseInsert, supabaseSelect } from './supabaseAdmin.js'

const STORE_BRAND = '업메리 검색주제'
const KIND = '검색 많은 주제 뽑기'
// 상위 글을 실측할 후보 수(키워드당 상위 3개 글).
const MEASURE_TOP = 12

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function getLatestUpmeryKeywordTopics(): Promise<KeywordTopicReport | null> {
  try {
    const rows = await supabaseSelect<{ result: KeywordTopicReport | null }>(
      'blog_brain_reports',
      `brand=eq.${encodeURIComponent(STORE_BRAND)}&order=created_at.desc&limit=1&select=result`,
    )
    return rows[0]?.result ?? null
  } catch {
    return null
  }
}

async function measureTop(phrase: string): Promise<{ chars: number | null; photos: number | null }[]> {
  try {
    const urls = await naverSearchPageTop(phrase, 3)
    const measured = await Promise.all(urls.map((u) => measureNaverPost(u).catch(() => null)))
    return measured.filter((m): m is NonNullable<typeof m> => !!m).map((m) => ({ chars: m.chars, photos: m.photos }))
  } catch {
    return []
  }
}

export async function buildUpmeryKeywordTopics(apiKey: string, deadline: number): Promise<{ report: KeywordTopicReport; costUsd: number }> {
  const { rows, error } = await fetchKeywordVolumeRows(UPMERY_KEYWORD_SEEDS)
  if (rows.length === 0) throw new Error(`검색량을 못 받았어요(${error ?? '연관 키워드 0개'})`)
  const candidates = prefilterKeywords(rows)
  if (candidates.length === 0) throw new Error('업메리 범위에 맞는 연관 키워드가 없어요')

  let costUsd = 0
  const raw = await callClaudeJson({
    apiKey,
    model: CLAUDE_MODEL_CHEAP,
    effort: 'low',
    system: UPMERY_KEYWORD_TOPIC_SYSTEM,
    user: buildKeywordTopicUser({
      rows: candidates,
      existingTopics: listUpmeryTopics()
        .filter((t) => t.kind !== 'review')
        .map((t) => t.topic),
      recentKeywords: await getRecentMainKeywords('업메리'),
    }),
    maxTokens: 8000,
    timeoutMs: 90_000,
    onUsage: (u) => {
      // 싼 모델 단가는 대략 10분의 1 — 근무기록 비용 표시용 추정(adAgent와 같은 방식).
      costUsd += estimateCostUsd(u) / 10
    },
  })
  const picked = preRank(parseKeywordTopics(raw, candidates))
  if (picked.length === 0) throw new Error('업메리 손님에 맞는 키워드를 못 골랐어요')

  // 상위 글 실측 — 앞쪽 후보만(시간 한도 안에서), 나머지는 '미확인'.
  const measured: KeywordTopic[] = []
  for (let i = 0; i < picked.length; i += 4) {
    const batch = picked.slice(i, i + 4)
    const results = await Promise.all(
      batch.map(async (t, j) => (i + j < MEASURE_TOP && Date.now() < deadline - 20_000 ? measureTop(t.phrase) : [])),
    )
    batch.forEach((t, j) => {
      const s = strengthOf(results[j])
      measured.push({ ...t, ...s, score: topicScore(t.volume, s.strength) })
    })
  }
  measured.sort((a, b) => b.score - a.score)
  const checked = measured.filter((t) => t.strength !== '미확인').length
  return {
    report: {
      week: kstIsoWeekKey(),
      createdAt: new Date().toISOString(),
      topics: measured,
      note: `연관 키워드 ${rows.length}개 → 업메리 범위 ${candidates.length}개 → 주제 ${measured.length}개 (상위 글 실측 ${checked}개)`,
    },
    costUsd,
  }
}

// 크론(매일 깨어나 이번 주 것이 없을 때만)·"지금 새로 뽑기"(force) 공용.
export async function runUpmeryKeywordTopicsOnce(apiKey: string, opts: { force?: boolean; deadline?: number } = {}): Promise<string> {
  if (!hasNaverAdKeys()) return '네이버 검색광고 키가 없어 건너뜀(NAVER_AD_API_KEY·NAVER_AD_SECRET_KEY·NAVER_AD_CUSTOMER_ID)'
  const week = kstIsoWeekKey()
  if (!opts.force) {
    const latest = await getLatestUpmeryKeywordTopics()
    if (latest?.week === week) return `이번 주(${week}) 검색 많은 주제가 이미 있어 건너뜀`
  }
  const startedAt = new Date().toISOString()
  try {
    const { report, costUsd } = await buildUpmeryKeywordTopics(apiKey, opts.deadline ?? Date.now() + 270_000)
    await supabaseInsert('blog_brain_reports', {
      id: `kwtopics-${week}-${makeId()}`,
      week,
      brand: STORE_BRAND,
      raw_metrics: {},
      result: report,
      research_block: null,
    })
    await supabaseInsert('work_log', {
      id: makeId(),
      agent: 'brain',
      brand: '업메리',
      kind: KIND,
      status: 'done',
      status_label: '완료',
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      note: report.note,
      cost_usd: Number(costUsd.toFixed(4)),
    }).catch(() => undefined)
    return report.note
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabaseInsert('work_log', {
      id: makeId(),
      agent: 'brain',
      brand: '업메리',
      kind: KIND,
      status: 'error',
      status_label: '오류',
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      note: '검색 많은 주제 뽑기 실패',
      detail_html: message,
    }).catch(() => undefined)
    throw err
  }
}

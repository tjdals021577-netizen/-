// 업메리 블로그 주제 은행 — 매일 주제 걱정 없이(2026-10 대표님 "주제가 항상 걱정"). 고정 7개 순환 대신
// 4가지 글 종류를 요일별로 섞는다(AI 호출 없음 — 주제는 여기 목록과 후기 보관함에서 코드로 고른다).
//   후기 사례글(주 4) · 질문 답변글(주 1) · 키워드 정보글(주 1) · 대표 이야기(주 1)
// 후기 사례글 날엔 아직 안 쓴 후기 1건(upmeryReviews)을 꺼내 쓰고, 후기가 다 떨어지면 질문 답변글로 대신한다.
// 목록 주제는 모두 [검증된 사실]·[대표 에피소드] 범위 안에서 쓸 수 있는 것만 — 새 주제를 넣을 때도 그 기준으로.
import { reviewKeyContent, UPMERY_REVIEWS, type UpmeryReview } from './upmeryReviews.js'

export type UpmeryTopicKind = 'review' | 'qa' | 'info' | 'story' | 'keyword' | 'custom'

export const UPMERY_TOPIC_KIND_LABEL: Record<UpmeryTopicKind, string> = {
  review: '후기 사례글',
  qa: '질문 답변글',
  info: '키워드 정보글',
  story: '대표 이야기',
  keyword: '검색 많은 주제',
  custom: '직접 입력 주제',
}

// 요일별(KST, 0=일) 글 종류 — 후기 4 · 질문 1 · 정보 1 · 이야기 1.
const WEEKDAY_KIND: UpmeryTopicKind[] = ['review', 'review', 'qa', 'review', 'info', 'review', 'story']
// 질문 답변글이 들어갈 수 있는 요일(질문 날 + 후기가 떨어졌을 때의 후기 날).
const QA_CAPABLE_WEEKDAYS = WEEKDAY_KIND.flatMap((k, d) => (k === 'qa' || k === 'review' ? [d] : []))

// 상담하면서 실제로 받는 질문 — "고민·비교" 단계 독자.
export const UPMERY_QA_TOPICS = [
  '타로를 하나도 몰라도 타로 부업을 시작할 수 있나요',
  '타로 카드 78장 의미를 다 외워야 상담할 수 있나요',
  '타로 리딩이 틀리면 어떡하나요',
  '처음 보는 저한테 누가 돈을 내고 상담을 받을까요',
  '타로 부업, 하루에 시간을 얼마나 써야 하나요',
  '아이 키우면서도 타로 부업을 할 수 있을까요',
  '퇴근하고 한 시간만으로도 타로 부업이 되나요',
  '비대면 타로 상담은 전화로 하나요, 채팅으로 하나요',
  '첫 손님한테 상담료를 얼마 받아야 하나요',
  '타로 상담 단골은 어떻게 생기나요',
  '타로 자격증이 없으면 상담하면 안 되나요',
  '타로 플랫폼에 들어가는 게 낫지 않나요',
  '내성적인데 타로 상담을 할 수 있을까요',
  '손님 질문에 말문이 막히면 어떡하나요',
  '부업 여러 번 실패했는데 또 해도 될까요',
  '타로 상담 홍보는 어디에 해야 하나요',
]

// 검색 수요가 있는 정보형 — "무관심·고민" 단계 독자(키워드 단계가 메인 키워드를 따로 잡는다).
export const UPMERY_INFO_TOPICS = [
  '타로 부업 시작 전에 꼭 알아야 할 것',
  '타로 상담사 되는 법, 순서대로 정리',
  '타로 자격증 종류와 실제로 필요한지',
  '타로 플랫폼 입점과 내 계정 운영, 수수료 차이',
  '비대면 타로 상담, 첫 답장부터 결제까지 흐름',
  '타로 상담 단가 정하는 법',
  '폰 하나로 하는 재택 부업, 타로가 맞는 사람',
  '타로 배우기, 독학과 강의와 1:1 컨설팅 비교',
  '스레드로 타로 상담 손님이 오게 하는 법',
  '타로 상담 후 재상담과 단골 만드는 법',
  '주부 재택 부업 고를 때 확인할 것',
  '직장인 퇴근 후 부업, 현실적인 시간 계산',
]

// 대표 1인칭 이야기 — [대표 에피소드] 안에서만.
export const UPMERY_STORY_TOPICS = [
  '강의비 1,000만 원 쓰고도 통장이 0원이었던 이유',
  '12개월 할부로 시작한 마지막 부업',
  '자격증 세 개 따고 깨달은 것',
  '"자료 보고 하세요"라는 말이 제일 아팠던 이유',
  '타로를 못 봐서가 아니라 손님이 없어서였다',
  '부업으로 시작한 타로 상담이 본업이 되기까지',
  '지금도 매일 상담하는 현직 상담사가 직접 가르치는 이유',
]

export interface UpmeryDailyTopic {
  // 주제 ID — "review:r002" · "qa:3" · "info:0" · "story:5" · "custom:…". 근무기록 메모에 남겨 "썼음" 표시에 쓴다.
  key: string
  kind: UpmeryTopicKind
  topic: string
  keyContent?: string
  review?: UpmeryReview
  // 결재함 상자에 남길 안내(예: 후기 보관함 소진).
  note?: string
  // 검색량이 확인된 메인 키워드("검색 많은 주제") — 키워드 단계가 그대로 쓴다.
  mainKeyword?: string
}

function dayNumber(dateKst: string): number {
  return Math.floor(Date.parse(`${dateKst}T00:00:00Z`) / 86_400_000)
}

// 순수 함수 — 날짜(KST YYYY-MM-DD)와 이미 쓴 후기 ID로 오늘 주제를 고른다.
export function pickUpmeryTopic(dateKst: string, usedReviewIds: Set<string>): UpmeryDailyTopic {
  const day = dayNumber(dateKst)
  const weekday = new Date(`${dateKst}T00:00:00Z`).getUTCDay()
  const week = Math.floor((day + 3) / 7) // 월요일 시작 주차(1970-01-01이 목요일)
  let kind = WEEKDAY_KIND[weekday]
  let note: string | undefined

  if (kind === 'review') {
    const next = UPMERY_REVIEWS.find((r) => !usedReviewIds.has(r.id))
    if (next) {
      return reviewPlan(next)
    }
    kind = 'qa'
    note = '후기 보관함에 아직 안 쓴 후기가 없어 오늘은 질문 답변글로 썼어요 — 후기를 더 보내 주세요.'
  }
  // 같은 종류 안에서 겹치지 않게 돌린다 — 정보·이야기는 주 1회라 주차로. 질문 답변은 후기가 떨어지면 후기 날에도
  // 들어오므로(주 최대 5번) "주차×5 + 그 주 몇 번째 자리"로 연속 번호를 매겨 16개를 3주 넘게 안 겹치게 쓴다.
  const list = kind === 'qa' ? UPMERY_QA_TOPICS : kind === 'info' ? UPMERY_INFO_TOPICS : UPMERY_STORY_TOPICS
  const idx = (kind === 'qa' ? week * QA_CAPABLE_WEEKDAYS.length + QA_CAPABLE_WEEKDAYS.indexOf(weekday) : week) % list.length
  return { key: `${kind}:${idx}`, kind, topic: list[idx], note }
}

function reviewPlan(r: UpmeryReview): UpmeryDailyTopic {
  return { key: `review:${r.id}`, kind: 'review', topic: `수강생 후기: ${r.headline}`, keyContent: reviewKeyContent(r), review: r }
}

function listOf(kind: 'qa' | 'info' | 'story'): string[] {
  return kind === 'qa' ? UPMERY_QA_TOPICS : kind === 'info' ? UPMERY_INFO_TOPICS : UPMERY_STORY_TOPICS
}

// 블로그 탭 "주제 목록"에서 고른 주제 ID → 글쓰기 계획. 모르는 ID면 null.
export function planFromKey(key: string): UpmeryDailyTopic | null {
  const i = key.indexOf(':')
  if (i < 0) return null
  const kind = key.slice(0, i)
  const rest = key.slice(i + 1).trim()
  if (kind === 'review') {
    const r = UPMERY_REVIEWS.find((x) => x.id === rest)
    return r ? reviewPlan(r) : null
  }
  if (kind === 'kw') {
    // "kw:키워드|띄어쓴 키워드|주제 제목" — 이번 주 검색 많은 주제(upmeryKeywordTopics). 근무기록엔 "주제 kw:키워드".
    const [kw, phrase, ...rest2] = rest.split('|')
    const keyword = (kw ?? '').replace(/\s+/g, '').slice(0, 40)
    const topic = rest2.join('|').trim().slice(0, 120)
    if (!keyword || !topic) return null
    return { key: `kw:${keyword}`, kind: 'keyword', topic, mainKeyword: (phrase ?? '').trim().slice(0, 40) || keyword }
  }
  if (kind === 'custom') {
    const topic = rest.slice(0, 120)
    return topic ? { key: `custom:${topic}`, kind: 'custom', topic } : null
  }
  if (kind === 'qa' || kind === 'info' || kind === 'story') {
    const idx = Number(rest)
    const list = listOf(kind)
    return Number.isInteger(idx) && idx >= 0 && idx < list.length ? { key: `${kind}:${idx}`, kind, topic: list[idx] } : null
  }
  return null
}

export interface UpmeryTopicOption {
  key: string
  kind: Exclude<UpmeryTopicKind, 'custom' | 'keyword'>
  topic: string
  detail?: string
  hasPhoto?: boolean
}

// 주제 목록 전체(화면용) — 후기는 보관함 순서, 나머지는 목록 순서.
export function listUpmeryTopics(): UpmeryTopicOption[] {
  return [
    ...UPMERY_REVIEWS.map((r) => ({
      key: `review:${r.id}`,
      kind: 'review' as const,
      topic: r.headline,
      detail: r.angle,
      hasPhoto: r.images.length > 0,
    })),
    ...(['qa', 'info', 'story'] as const).flatMap((kind) => listOf(kind).map((topic, i) => ({ key: `${kind}:${i}`, kind, topic }))),
  ]
}

// 근무기록 메모에서 이미 쓴 주제 ID — "주제 qa:3"(목록 주제)·"주제 kw:타로부업"(검색 많은 주제)·"후기 r001"(후기) 표시를 읽는다.
export function usedTopicKeysFromNotes(notes: string[]): Set<string> {
  const keys = new Set<string>()
  for (const n of notes) {
    for (const m of n.matchAll(/주제 ((?:qa|info|story):\d+)/g)) keys.add(m[1])
    for (const m of n.matchAll(/주제 (kw:[^\s·]+)/g)) keys.add(m[1])
    for (const m of n.matchAll(/후기 (r\d{3,})/g)) keys.add(`review:${m[1]}`)
  }
  return keys
}

// 근무기록 메모에서 이미 쓴 후기 ID를 뽑는다("후기 r001" 형식).
export function usedReviewIdsFromNotes(notes: string[]): Set<string> {
  const ids = new Set<string>()
  for (const n of notes) for (const m of n.matchAll(/후기 (r\d{3,})/g)) ids.add(m[1])
  return ids
}

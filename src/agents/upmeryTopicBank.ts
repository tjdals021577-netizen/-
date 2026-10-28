// 업메리 블로그 주제 은행 — 매일 주제 걱정 없이(2026-10 대표님 "주제가 항상 걱정"). 고정 7개 순환 대신
// 4가지 글 종류를 요일별로 섞는다(AI 호출 없음 — 주제는 여기 목록과 후기 보관함에서 코드로 고른다).
//   후기 사례글(주 4) · 질문 답변글(주 1) · 키워드 정보글(주 1) · 멘토님 이야기(주 1)
// 후기 사례글 날엔 아직 안 쓴 후기 1건(upmeryReviews)을 꺼내 쓰고, 후기가 다 떨어지면 질문 답변글로 대신한다.
// 목록 주제는 모두 [검증된 사실]·[멘토님 이야기] 범위 안에서 쓸 수 있는 것만 — 새 주제를 넣을 때도 그 기준으로.
import { reviewKeyContent, UPMERY_REVIEWS, type UpmeryFocus, type UpmeryReview } from './upmeryReviews.js'

export type UpmeryTopicKind = 'review' | 'edu' | 'qa' | 'info' | 'story' | 'keyword' | 'custom'

export const UPMERY_TOPIC_KIND_LABEL: Record<UpmeryTopicKind, string> = {
  review: '후기 사례글',
  edu: '교육 과정',
  qa: '질문 답변글',
  info: '키워드 정보글',
  story: '멘토님 이야기',
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

// 멘토님 이야기(업메리가 3인칭으로 전함) — [멘토님 이야기] 안에서만. 홈페이지의 "저"는 대표가 아니라 멘토님(2026-10-25 정정).
export const UPMERY_STORY_TOPICS = [
  '멘토님이 강의비 1,000만 원 쓰고도 통장이 0원이었던 이유',
  '멘토님이 12개월 할부로 시작한 마지막 부업',
  '멘토님이 자격증 세 개 따고 깨달은 것',
  '멘토님에게 "자료 보고 하세요"라는 말이 제일 아팠던 이유',
  '타로를 못 봐서가 아니라 손님이 없어서였다, 멘토님 이야기',
  '멘토님의 부업 타로 상담이 본업이 되기까지',
  '지금도 매일 상담하는 현직 멘토님이 수강생 옆에 직접 붙는 이유',
]

// 🎓 교육 과정(2026-10-28 대표님 "업메리가 수강생 실시간 교육을 어떻게 하는지 보여 주는 섹션, 교육 50 : 수익 50").
// 각 주제는 [검증된 사실]의 1:1 컨설팅 내용 + 후기 보관함의 교육 장면(reviews)으로만 쓴다. 순서 = 키(edu:N) → 새 주제는 맨 뒤에만.
export const UPMERY_EDU_TOPICS: { topic: string; reviews: string[] }[] = [
  { topic: '업메리 1:1 교육은 이렇게 시작해요, 계정 세팅부터 첫 문의까지', reviews: ['r012', 'r016'] },
  { topic: '홍보 글 첨삭, 수강생 글이 이렇게 바뀌어요', reviews: ['r011', 'r026', 'r030', 'r014'] },
  { topic: '첫 문의가 오면 멘토님이 답장을 같이 써요', reviews: ['r008', 'r013'] },
  { topic: '첫 상담이 엉망이었던 날, 그날 바로 받은 피드백', reviews: ['r017', 'r024'] },
  { topic: '상담이 끝날 때마다 피드백, 처음 배운 사람을 혼자 두지 않으면', reviews: ['r004', 'r024'] },
  { topic: '막히면 바로 보이스톡, 수강생 실시간 교육 장면', reviews: ['r025', 'r017'] },
  { topic: '늦은 밤에도 물어볼 수 있는 교육, 기간·횟수·질문 무제한', reviews: ['r018', 'r010'] },
  { topic: '타로 리딩보다 먼저 가르치는 것, 손님이 오는 길', reviews: ['r023', 'r015'] },
  { topic: '단가 올리는 법과 단골 만드는 법도 같이 배워요', reviews: ['r019', 'r001'] },
  { topic: '타로만 배우는 게 아니라 온라인에서 일하는 법을 배워요', reviews: ['r011', 'r025', 'r008'] },
  { topic: '강의 듣고 혼자 남는 교육과 1:1로 같이 가는 교육의 차이', reviews: ['r012', 'r017'] },
  { topic: '50대도, 휴대폰이 서툴러도 따라올 수 있게 가르치는 법', reviews: ['r025'] },
  { topic: '"오늘 결제로 이어진 건 없어요?" 멘토님이 먼저 묻는 매일 확인', reviews: ['r028', 'r029'] },
  { topic: '대면이냐 비대면이냐, 수익 구조까지 같이 따져 주는 방향 잡기', reviews: ['r028'] },
  { topic: '"성격상 가격을 못 올려요" 단가 교육은 이렇게 해요', reviews: ['r027', 'r010'] },
  { topic: '밤 12시에 끝나도 내일 시간까지 같이 정하는 1:1 교육', reviews: ['r029', 'r018'] },
  { topic: '칭찬하고, 고치고, 5분 뒤 다시 보는 실시간 피드백의 하루', reviews: ['r030', 'r026'] },
  { topic: '"무료 타로·천 원 타로 돌리라"는 교육과 업메리가 다른 점', reviews: ['r031', 'r015'] },
]

function eduPlan(idx: number): UpmeryDailyTopic | null {
  const t = UPMERY_EDU_TOPICS[idx]
  if (!t) return null
  const scenes = t.reviews.map((id) => UPMERY_REVIEWS.find((r) => r.id === id)).filter((r): r is UpmeryReview => !!r)
  const keyContent = [
    '[교육 과정 글 — 아래 교육 장면 중에서 골라 순서대로 보여 준다(장면을 지어내지 않는다)]',
    ...scenes.map(
      (r) =>
        `- [${r.id}] ${r.who}${r.process ? ` / 과정: ${r.process}` : ''} / 결과: ${r.result}${r.quotes[0] ? ` / 수강생이 한 말: "${r.quotes[0]}"` : ''}${r.reply ? ` / 멘토님 답장: "${r.reply}"` : ''}${r.caution ? ` / 주의: ${r.caution}` : ''}`,
    ),
    '- 수강생은 이름 없이 "수강생"·"10월 수강생"·"50대 수강생"처럼만.',
  ].join('\n')
  return {
    key: `edu:${idx}`,
    kind: 'edu',
    topic: t.topic,
    keyContent,
    focus: '교육',
    images: scenes.flatMap((r) => r.images).slice(0, 4),
  }
}

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
  // 글의 축(교육·수익) — [핵심 내용] 맨 앞에 축 안내가 붙고, 근무기록에 "축 교육"으로 남아 비율을 센다. 직접 입력은 없음.
  focus?: UpmeryFocus
  // 결재함에 붙일 가린 후기 캡처(후기 사례글은 review.images, 교육 과정은 관련 장면의 사진).
  images?: { src: string; alt: string }[]
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
  return { key: `review:${r.id}`, kind: 'review', topic: `수강생 후기: ${r.headline}`, keyContent: reviewKeyContent(r), review: r, focus: r.focus, images: r.images }
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
    // "kw:키워드|띄어쓴 키워드|축|주제 제목" — 이번 주 검색 많은 주제(upmeryKeywordTopics). 근무기록엔 "주제 kw:키워드".
    // (축이 없는 예전 형식 "kw:키워드|띄어쓴 키워드|주제 제목"도 읽는다.)
    const [kw, phrase, ...rest2] = rest.split('|')
    const focus = rest2[0] === '교육' || rest2[0] === '수익' ? (rest2.shift() as UpmeryFocus) : undefined
    const keyword = (kw ?? '').replace(/\s+/g, '').slice(0, 40)
    const topic = rest2.join('|').trim().slice(0, 120)
    if (!keyword || !topic) return null
    return { key: `kw:${keyword}`, kind: 'keyword', topic, mainKeyword: (phrase ?? '').trim().slice(0, 40) || keyword, focus }
  }
  if (kind === 'edu') {
    const idx = Number(rest)
    return Number.isInteger(idx) ? eduPlan(idx) : null
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
  focus?: UpmeryFocus
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
      focus: r.focus,
    })),
    ...UPMERY_EDU_TOPICS.map((t, i) => ({
      key: `edu:${i}`,
      kind: 'edu' as const,
      topic: t.topic,
      detail: `실제 교육 장면 후기 ${t.reviews.length}건으로 써요`,
      hasPhoto: t.reviews.some((id) => (UPMERY_REVIEWS.find((r) => r.id === id)?.images.length ?? 0) > 0),
      focus: '교육' as const,
    })),
    ...(['qa', 'info', 'story'] as const).flatMap((kind) => listOf(kind).map((topic, i) => ({ key: `${kind}:${i}`, kind, topic }))),
  ]
}

// 근무기록 메모에서 이미 쓴 주제 ID — "주제 qa:3"(목록 주제)·"주제 kw:타로부업"(검색 많은 주제)·"후기 r001"(후기) 표시를 읽는다.
export function usedTopicKeysFromNotes(notes: string[]): Set<string> {
  const keys = new Set<string>()
  for (const n of notes) {
    for (const m of n.matchAll(/주제 ((?:qa|info|story|edu):\d+)/g)) keys.add(m[1])
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

// 최근 글의 축 비율 — 근무기록 메모의 "축 교육"·"축 수익"(최신순 notes에서 앞의 n편). 주제 목록이 부족한 축을 추천한다.
export function recentFocusCounts(notesNewestFirst: string[], n = 10): Record<UpmeryFocus, number> {
  const counts: Record<UpmeryFocus, number> = { 교육: 0, 수익: 0 }
  let seen = 0
  for (const note of notesNewestFirst) {
    const m = note.match(/축 (교육|수익)/)
    if (!m) continue
    counts[m[1] as UpmeryFocus]++
    if (++seen >= n) break
  }
  return counts
}

// 다음에 쓸 축 — 목표 교육 50 : 수익 50. 같으면 교육(대표님: "교육으로 홍보해야 믿는다").
export function nextFocus(counts: Record<UpmeryFocus, number>): UpmeryFocus {
  return counts.수익 < counts.교육 ? '수익' : '교육'
}

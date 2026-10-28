// 업메리 "검색 많은 주제"(2026-10-25 대표님: "진짜 블로그에서 사람들을 업메리에 맞춰 모아올 수 있는 주제?").
// 네이버 검색광고 키워드도구의 실제 월 검색량 → 코드 1차 거르기 → 싼 모델이 "업메리 손님이 될 사람이 찾는 말"만 골라
// 주제 제목을 붙임 → 상위 글 강도(글자·사진 수, 코드 실측)로 순위. 숫자(검색량·상위 글)는 전부 코드가 붙인다 —
// AI는 키워드를 고르고 제목만 쓴다(목록에 없는 키워드·숫자는 버림).

export const UPMERY_KEYWORD_SEEDS = [
  '타로 부업',
  '주부 부업',
  '직장인 부업',
  '재택 부업',
  '타로 수익화',
  '타로 상담사 되는 법',
  '타로 배우기',
  '폰으로 하는 부업',
  '타로 자격증',
  '집에서 하는 부업',
  '투잡',
  '육아 부업',
  '타로 상담사',
  '부업 추천',
  '경단녀 재취업',
]

// 업메리 블로그 키워드 단계(글마다 메인 키워드 고르기)에 넘길 검색량도 이 범위만.
export const UPMERY_VOLUME_FILTER = /타로|부업|재택|투잡|n잡|부수입|상담사|수익|돈벌|용돈|주부|육아|엄마|경단|경력단절|퇴근|직장인|폰으로|집에서/i

// 운세를 "보러" 온 사람(손님이 아니라 상담을 받을 사람)·도박·대출 등은 처음부터 뺀다.
const EXCLUDE_RE = /운세|무료타로|무료 타로|연애운|재회|궁합|띠별|오늘의|이번달|신년|사주풀이|타로점|타로보기|타로 보기|로또|대출|카지노|토토|코인|주식|사기|다단계/

export interface KeywordVolumeRow {
  keyword: string
  pc: number
  mobile: number
  total: number
  comp: string
}

// 키워드도구는 "< 10"처럼 문자열을 주기도 한다 → 5로 본다.
export function volumeOf(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
  return 5
}

// 1차 거르기(코드) — 업메리 범위 안 + 운세 소비자 제외 + 검색량 순 상위 limit개.
export function prefilterKeywords(rows: KeywordVolumeRow[], limit = 120): KeywordVolumeRow[] {
  const seen = new Set<string>()
  return rows
    .filter((r) => {
      const k = r.keyword.replace(/\s+/g, '').toLowerCase()
      if (!k || seen.has(k)) return false
      seen.add(k)
      return UPMERY_VOLUME_FILTER.test(r.keyword) && !EXCLUDE_RE.test(r.keyword)
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export const UPMERY_KEYWORD_TOPIC_SYSTEM = `너는 업메리(퀸퀸 타로) 네이버 블로그의 주제 기획자다.
업메리 = "타로 부업 수익화 1:1 컨설팅" 회사(현직 타로 상담사인 멘토님이 수강생 옆에 1:1로 붙는다). 타로를 몰라도 시작할 수 있고, 폰 하나로 비대면 상담을 해서
부업 수입을 만드는 법을 가르친다. 손님 = 부업을 찾는 주부·육아 중인 엄마·직장인, 타로를 배워 돈을 벌고 싶은 사람.

[할 일] 아래 [키워드 목록](실제 네이버 월 검색량)에서 "검색한 사람이 업메리 상담을 신청할 수 있는 사람"인 키워드만 골라
블로그 주제 제목을 붙인다.
- 고를 것: 부업·재택·투잡을 찾는 사람, 타로를 배우거나 타로로 돈 벌고 싶은 사람, 타로 상담사가 되고 싶은 사람.
- 버릴 것: 타로 점을 "보러" 온 사람(운세·연애운 등), 다른 회사·플랫폼·앱 이름이 들어간 키워드, 업메리와 상관없는 부업(배달·공장·쇼핑몰 등 구체 업종),
  업메리가 [검증된 사실] 없이 답할 수 없는 키워드(특정 금액 보장, 자격증 발급 등).
- 제목은 그 키워드를 자연스러운 띄어쓰기로 넣고, 검색한 사람의 궁금증에 답하는 형태(25~40자). 숫자·금액·기간을 지어내지 않는다.
- [이미 있는 주제]와 같은 내용은 피한다. 비슷한 키워드끼리는 하나만.
- 독자 단계: ① 무관심(넓은 부업 탐색) ② 고민·비교 ③ 결정 직전.
- 축(focus): "교육" = 검색자가 배우는 법·과정·방법을 궁금해함(타로 배우기, 상담사 되는 법, 홍보·상담 요령 등) /
  "수익" = 벌이·부업 수입·실제로 버는지를 궁금해함. 업메리는 교육 50 : 수익 50으로 쓰니 두 축이 고르게 나오게 고른다.

[출력] JSON 하나만:
{"topics":[{"keyword":"목록의 키워드 그대로","phrase":"띄어쓰기한 키워드","topic":"주제 제목","stage":"①|②|③","focus":"교육|수익","why":"이 키워드 검색자가 업메리 손님인 이유 한 줄"}]}
최대 20개. 고를 게 없으면 {"topics":[]}.`

export function buildKeywordTopicUser(params: { rows: KeywordVolumeRow[]; existingTopics: string[]; recentKeywords: string[] }): string {
  return [
    '[키워드 목록] (키워드 / 월 검색량 PC+모바일)',
    params.rows.map((r) => `${r.keyword} / ${r.total}`).join('\n'),
    '',
    '[이미 있는 주제]',
    params.existingTopics.join('\n') || '없음',
    '',
    '[최근 4주에 쓴 메인 키워드]',
    params.recentKeywords.join(', ') || '없음',
  ].join('\n')
}

export type TopStrength = '약함' | '보통' | '탄탄' | '미확인'

export interface KeywordTopic {
  keyword: string
  phrase: string
  topic: string
  stage: '①' | '②' | '③'
  // 글의 축(2026-10-28 교육 50 : 수익 50). 예전 목록엔 없을 수 있다.
  focus?: '교육' | '수익'
  why: string
  volume: number
  // 네이버 블로그 검색 상위 글(최대 3개) 실측 평균 — 상위 글이 약할수록 내 글이 올라갈 틈이 크다.
  topChars: number | null
  topPhotos: number | null
  strength: TopStrength
  score: number
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

// AI 응답 검증 — 목록에 있는 키워드만, 검색량은 목록 숫자로(코드가 붙임).
export function parseKeywordTopics(raw: unknown, rows: KeywordVolumeRow[]): Omit<KeywordTopic, 'topChars' | 'topPhotos' | 'strength' | 'score'>[] {
  const byKey = new Map(rows.map((r) => [norm(r.keyword), r]))
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { topics?: unknown }).topics) ? (raw as { topics: unknown[] }).topics : []
  const out: Omit<KeywordTopic, 'topChars' | 'topPhotos' | 'strength' | 'score'>[] = []
  const used = new Set<string>()
  for (const t of list) {
    if (!t || typeof t !== 'object') continue
    const o = t as Record<string, unknown>
    const row = byKey.get(norm(String(o.keyword ?? '')))
    if (!row || used.has(norm(row.keyword))) continue
    const topic = String(o.topic ?? '').trim().slice(0, 60)
    if (!topic) continue
    const phraseRaw = String(o.phrase ?? '').trim()
    const phrase = norm(phraseRaw) === norm(row.keyword) ? phraseRaw : row.keyword
    const stage = (['①', '②', '③'] as const).find((s) => s === String(o.stage ?? '').trim()) ?? '②'
    used.add(norm(row.keyword))
    const focus = o.focus === '교육' || o.focus === '수익' ? o.focus : '수익'
    out.push({ keyword: row.keyword.replace(/\s+/g, ''), phrase, topic, stage, focus, why: String(o.why ?? '').trim().slice(0, 120), volume: row.total })
  }
  return out.slice(0, 20)
}

export function strengthOf(measured: { chars: number | null; photos: number | null }[]): { topChars: number | null; topPhotos: number | null; strength: TopStrength } {
  const chars = measured.map((m) => m.chars).filter((n): n is number => typeof n === 'number')
  const photos = measured.map((m) => m.photos).filter((n): n is number => typeof n === 'number')
  if (chars.length === 0) return { topChars: null, topPhotos: null, strength: '미확인' }
  const avg = (a: number[]) => Math.round(a.reduce((s, n) => s + n, 0) / a.length)
  const topChars = avg(chars)
  const topPhotos = photos.length > 0 ? avg(photos) : null
  const strength: TopStrength = topChars < 1500 ? '약함' : topChars >= 2500 && (topPhotos ?? 0) >= 8 ? '탄탄' : '보통'
  return { topChars, topPhotos, strength }
}

// 순위 점수 — 검색량(300~5,000이 새 블로그가 올라가기 좋은 구간, 너무 크면 상위 경쟁이 세서 깎음) × 상위 글 강도.
export function topicScore(volume: number, strength: TopStrength): number {
  const band = volume < 100 ? 0.3 : volume <= 5000 ? 1 : volume <= 20000 ? 0.7 : 0.4
  const mult = strength === '약함' ? 1.4 : strength === '보통' ? 1 : strength === '탄탄' ? 0.6 : 0.9
  return Math.round(Math.min(volume, 5000) * band * mult)
}

// 측정 대상 순서(측정 전) — 같은 점수식에 '미확인'으로.
export function preRank<T extends { volume: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => topicScore(b.volume, '미확인') - topicScore(a.volume, '미확인'))
}

export interface KeywordTopicReport {
  week: string
  createdAt: string
  topics: KeywordTopic[]
  note: string
}

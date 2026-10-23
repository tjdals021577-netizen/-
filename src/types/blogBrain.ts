// 마잘남 블로그 자동화(재설계 지시서) 전용 타입 — 키워드 생성 / blog-brain 분석.

// 독자 인식 단계(①무관심 ②고민 ③비교 ④구매 직전) — 원문 표기 그대로 쓴다.
export type ReaderStage = '①' | '②' | '③' | '④'
export const READER_STAGES: ReaderStage[] = ['①', '②', '③', '④']

// 키워드 생성(2번 프롬프트) 출력.
export interface BlogKeywordResult {
  mainKeyword: string
  subKeywords: string[]
  readerStage: ReaderStage
  searchVolume: number | null
  reason: string
}

// blog-brain 수집 단계 — 상위노출 글 1건(코드가 측정한 값).
export interface TopPostData {
  keyword: string
  rank: number
  title: string
  url: string
  // 아래는 m.blog 본문을 코드로 측정한 값 — 측정 실패 시 null.
  chars: number | null
  photos: number | null
  headingCount: number | null
  headings: string[]
  intro: string[]
  hasFaq: boolean | null
  ctaSentence: string
}

// 공식 공지(네이버 서치어드바이저·네이버 검색 공식 블로그, 최근 7일).
export interface OfficialNotice {
  title: string
  date: string
  source: string
  summary: string
}

// blog-brain 분석(3번 프롬프트) 출력.
export interface BlogBrainResult {
  logicChanges: { content: string; basis: '확정' | '관찰' | '참고'; source: string }[]
  metrics: {
    chars: { median: number; range: string }
    photos: { median: number; range: string }
    headings: { median: number; range: string }
  }
  titlePatterns: { type: string; share: string; applyToMajalnam: string }[]
  hookPatterns: { type: string; applyToMajalnam: string }[]
  ruleOverrides: { rule: string; current: string; new: string; basis: '확정' | '관찰' }[]
  researchBlock: string
}

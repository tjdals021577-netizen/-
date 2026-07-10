export type Brand = '업메리' | '마잘남'

export const BRANDS: Brand[] = ['업메리', '마잘남']

export const BRAND_CONTEXT: Record<Brand, string> = {
  업메리: '업메리 — 타로 상담 개인 사업(고객 개인 대상, 감성적·신뢰감 있는 톤)',
  마잘남: '마잘남 — 스레드 마케팅 대행 에이전시(사업자·마케터 대상, 전문적·설득력 있는 톤)',
}

// 브랜드별로 실제 운영 중인 채널 — 업메리는 블로그만, 마잘남은 스레드까지 운영한다.
export const BRAND_CHANNELS: Record<Brand, string[]> = {
  업메리: ['블로그'],
  마잘남: ['스레드', '블로그', '유튜브'],
}

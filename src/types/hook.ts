// 대표님이 구글시트에 모은 "터진 후킹·CTA" 레퍼런스 1건.
// 업종이 달라도 반응이 온 후킹의 구조를 참고해, 스레드 위원회·대행이 글 쓸 때
// 우리 주제로 치환해 재창작하는 데 쓴다(문구 복붙 X, 구조만 O).
export interface ReferenceHook {
  id: string
  hook: string // 후킹 문장(핵심)
  industry?: string // 원본 업종
  structure?: string // 왜 터졌나(통념 비틀기·구체 수치·반전·공감 등)
  cta?: string // CTA 문구
  createdAt: string
}

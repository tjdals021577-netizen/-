import type { ReferenceHook } from '../types/hook.js'

// 무작위로 n개를 골라(매번 다른 조합이 참고되게) 순서를 섞는다.
function pickRandom<T>(items: T[], n: number): T[] {
  if (items.length <= n) return [...items]
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

// 스레드 위원회·대행 프롬프트에 넣는 "터진 후킹·CTA 레퍼런스" 동적 블록을 만든다.
// 대표님이 모은 실제 반응 온 문장들의 "구조·틀"만 참고하고 문구는 절대 베끼지
// 않게(유료 전자책 카피라이팅 원칙으로 우리 주제 치환) 강하게 지시한다.
// 토큰 절약을 위해 매번 무작위 일부(기본 15개)만 넣는다.
export function formatHookReference(hooks: ReferenceHook[], count = 15): string {
  if (hooks.length === 0) return ''
  const lines = pickRandom(hooks, count)
    .map((h) => {
      const parts = [`(후킹) ${h.hook}`]
      if (h.industry) parts.push(`업종: ${h.industry}`)
      if (h.structure) parts.push(`구조: ${h.structure}`)
      if (h.cta) parts.push(`CTA: ${h.cta}`)
      return `- ${parts.join(' | ')}`
    })
    .join('\n')
  return `[터진 후킹·CTA 레퍼런스 — 대표님이 수집한 "실제로 반응 온" 문장들. 반드시 반영하되 문구를 그대로 베끼지 말 것]
아래는 업종이 달라도 통한 후킹/CTA다. 유료 전자책 카피라이팅 원칙(통념 비틀기·구체 수치·반전·공감·12블록 설득 구조)으로
"왜 이게 먹혔는지" 구조를 먼저 파악하고, 그 구조·틀만 가져와 주제·소재를 이 계정(마잘남 또는 해당 클라이언트)의
스레드·브랜딩·마케팅으로 치환해 새 문장으로 재창작한다. 원문 문구·업종·수치를 그대로 옮기는 것은 금지(카피 X, 모방 O).
${lines}`
}

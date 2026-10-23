// 애드(업메리 광고 운영) — 광고 문구·분석을 코드로 검사한다(2026-10 대표님 요청). AI가 아니라 정규식이라 비용 0.
// · 금지 ①수익·금액 주장 ②읽는 사람 상황 단정(메타 "개인 특성" 정책) ③보장·100%·확실한 결과 → 걸리면 자동 고쳐 쓰기,
//   고쳐 쓴 뒤에도 걸리면 그 세트는 결재함에 올리지 않는다(심사 거절·계정 제재 위험).
// · AI 티(줄표·라벨·3단 나열) — 줄표는 코드로 바로 고치고 나머지는 고쳐 쓰기 지적으로 넘긴다.
// · 분석 근거 숫자는 [검증된 사실](대시보드·리드 숫자) 안에 있는 숫자만 — 밖의 숫자는 "확인 필요"로 표시.
import { checkAiTells } from './blogRuleCheck.js'

export interface AdCopySet {
  angle: string
  headline: string
  lines: string[]
}

export interface AdCopyIssue {
  rule: '수익·금액 주장' | '상황 단정' | '보장·확실' | 'AI 티' | '형식'
  quote: string
  reason: string
}

const RULES: { rule: AdCopyIssue['rule']; re: RegExp; reason: string }[] = [
  // ① 수익·금액 주장
  { rule: '수익·금액 주장', re: /\d[\d,.]*\s*(?:만|천|백|억)?\s*원(?!칙|리|인|형|본|래|장|서)/, reason: '금액 언급(수익 주장으로 심사 거절 위험)' },
  { rule: '수익·금액 주장', re: /[십백천만억]+\s*원(?!칙|리|인|형|본|래|장|서)/, reason: '금액 언급' },
  { rule: '수익·금액 주장', re: /(?:하루|일당|월|매달|매월|한\s*달|주|연)\s*(?:에|만에)?\s*\d[\d,.]*\s*(?:만|천|백|억)/, reason: '기간당 수익 금액(하루 OO만, 월 OO)' },
  { rule: '수익·금액 주장', re: /월\s*\d{2,}(?!\s*[일분시])/, reason: '월 OO 수익 표현' },
  { rule: '수익·금액 주장', re: /수익\s*(?:을\s*)?보장|고수익|큰\s*돈|떼돈|억대|돈\s*(?:을\s*)?(?:벌|버는|번다)/, reason: '수익 주장' },
  { rule: '수익·금액 주장', re: /패시브\s*인컴|passive\s*income|불로\s*소득|자동\s*수익|잠자는\s*동안/i, reason: '패시브 인컴류 표현' },
  { rule: '수익·금액 주장', re: /입금\s*(?:캡처|캡쳐|인증|내역)|통장\s*(?:인증|캡처|캡쳐)|수익\s*인증/, reason: '입금·수익 인증 표현' },
  // ② 읽는 사람의 상황 단정
  {
    rule: '상황 단정',
    re: /(?:없|부족하|힘드|힘들|어려우|지치|괴로우|불안하|막막하|답답하|외로우|쪼들리)(?:으)?(?:시죠|신가요|시나요|셨죠|셨나요|시지요)/,
    reason: '읽는 사람의 상황을 단정(메타 개인 특성 정책 위반)',
  },
  { rule: '상황 단정', re: /(?:돈|월급|생활비|통장)\s*(?:이|가)?\s*(?:없|부족|모자라|바닥)/, reason: '읽는 사람의 경제 상황 단정' },
  { rule: '상황 단정', re: /빚|대출|채무|신용\s*불량|파산/, reason: '경제적 어려움 언급(개인 특성)' },
  { rule: '상황 단정', re: /(?:당신|여러분)(?:은|는|도|이|의)?\s*[^.?!\n]{0,20}(?:이시죠|이신가요|인가요|하시죠)/, reason: '"당신은 ~인가요" 식 단정' },
  // ③ 보장·100%·확실한 결과
  { rule: '보장·확실', re: /보장/, reason: '보장 표현' },
  { rule: '보장·확실', re: /100\s*%|백\s*퍼(?:센트)?/, reason: '100% 표현' },
  { rule: '보장·확실', re: /확실(?:한|히|하게)?|무조건|틀림\s*없|반드시\s*(?:성공|벌|됩|된)/, reason: '확실한 결과 약속' },
]

function quoteAround(text: string, index: number, len: number): string {
  return text.slice(Math.max(0, index - 6), Math.min(text.length, index + len + 6)).trim()
}

export function checkBannedText(text: string): AdCopyIssue[] {
  const issues: AdCopyIssue[] = []
  for (const r of RULES) {
    const m = r.re.exec(text)
    if (m) issues.push({ rule: r.rule, quote: quoteAround(text, m.index, m[0].length), reason: r.reason })
  }
  return issues
}

// 줄표(—, –)는 코드로 바로 쉼표로 바꾼다(AI 티). 반환값: 고친 세트 + 고쳤는지.
export function autoFixCopySet(set: AdCopySet): { set: AdCopySet; fixed: boolean } {
  const fix = (s: string) => s.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').trim()
  const next = { ...set, headline: fix(set.headline), lines: set.lines.map(fix) }
  const fixed = next.headline !== set.headline || next.lines.some((l, i) => l !== set.lines[i])
  return { set: next, fixed }
}

export function checkCopySet(set: AdCopySet): AdCopyIssue[] {
  const text = [set.headline, ...set.lines].join('\n')
  const issues = checkBannedText(text)
  if (set.lines.length !== 3) issues.push({ rule: '형식', quote: `본문 ${set.lines.length}줄`, reason: '본문은 3줄' })
  if (!set.headline.trim()) issues.push({ rule: '형식', quote: '헤드라인 없음', reason: '헤드라인 필요' })
  for (const t of checkAiTells(text)) issues.push({ rule: 'AI 티', quote: t.quote, reason: t.reason })
  if (/^(?:질문|답|Q|A|핵심|결론)\s*[:.]/m.test(text)) issues.push({ rule: 'AI 티', quote: '라벨', reason: 'AI 티 — 라벨(질문:/핵심: 등)' })
  return issues
}

// 심사 거절·제재 위험이 있는 규칙(금지 3종) — 이게 남으면 그 세트는 올리지 않는다.
export function isBlockingIssue(i: AdCopyIssue): boolean {
  return i.rule === '수익·금액 주장' || i.rule === '상황 단정' || i.rule === '보장·확실'
}

// ── 숫자 검증(분석 근거) ──

function normalizeNumber(s: string): string {
  return s.replace(/,/g, '').replace(/\.0+$/, '')
}

export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(normalizeNumber)
}

// 근거 문장에 [검증된 사실]에 없는 숫자가 있으면 그 숫자들을 돌려준다(작은 수 0~1은 무시).
export function unverifiedNumbers(reason: string, factNumbers: Set<string>): string[] {
  return numbersIn(reason).filter((n) => Number(n) > 1 && !factNumbers.has(n))
}

import { plainNaverBody } from './naverFormat.js'

// 발행 전 규칙 자동 점검 — AI 호출 없이 코드로(비용 0). 채점이 실패해도 대표님이
// 놓치면 안 되는 표현(규칙 9: 효과 단정·양산 문장·민감정보, 규칙 1: 제목 길이)을
// 결재함 글 맨 위에 "발행 전 확인" 상자로 띄우고, 고친 제목도 제안한다.
// 채점이 실패한 경우엔 "글은 정상, 채점만 실패 — 읽고 승인하면 됨" 안내를 함께 띄운다.

export interface BlogRuleIssue {
  where: '제목' | '본문'
  quote: string
  reason: string
}

interface Pattern {
  re: RegExp
  reason: string
  // 제목 수정 제안 시 이 표현을 지운다(효과 단정 수식어만 — 문장이 깨지지 않는 것).
  stripFromTitle?: boolean
}

const PATTERNS: Pattern[] = [
  { re: /100\s*%/g, reason: '효과 단정 표현(규칙 9 "100% 보장"류)', stripFromTitle: true },
  { re: /무조건/g, reason: '효과 단정 표현(규칙 9)', stripFromTitle: true },
  { re: /보장(?:합니다|해\s?드립니다|됩니다|해요)?/g, reason: '효과 단정 표현(규칙 9 "보장")' },
  { re: /절대\s?(?:실패|안\s?망)/g, reason: '효과 단정 표현(규칙 9)' },
  { re: /강추|너무\s?좋았어요|인생\s?(?:템|업체)/g, reason: '체험단식 양산 문장(규칙 9)' },
  { re: /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, reason: '연락처(전화번호) 노출(규칙 9 민감정보)' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/g, reason: '연락처(이메일) 노출(규칙 9 민감정보)' },
]

// 인용은 찾은 표현 앞뒤로 조금만 — 결재함에서 어디인지 알아볼 수 있게.
function around(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 8)
  const end = Math.min(text.length, index + length + 8)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

export function checkBlogRules(draft: { title: string; body: string }): {
  issues: BlogRuleIssue[]
  suggestedTitle?: string
} {
  const issues: BlogRuleIssue[] = []
  for (const [where, text] of [
    ['제목', draft.title],
    ['본문', draft.body],
  ] as const) {
    for (const p of PATTERNS) {
      // 같은 표현이 본문에 여러 번 나와도 첫 번째만 보여준다(상자가 길어지지 않게).
      const m = new RegExp(p.re.source).exec(text)
      if (m) issues.push({ where, quote: around(text, m.index, m[0].length), reason: p.reason })
    }
  }
  // 구조 수치(규칙 2·3) — AI가 스스로 세면 틀려서(소제목 6개 등) 코드로 잰다. 미달 자동 고쳐 쓰기에 그대로 전달된다.
  const headingCount = draft.body.split('\n').filter((l) => /^\s*##/.test(l)).length
  if (draft.body.trim() && (headingCount < 3 || headingCount > 5)) {
    issues.push({ where: '본문', quote: `소제목 ${headingCount}개`, reason: '소제목 수 규칙(3~5개) 밖' })
  }
  const bodyChars = bodyCharCount(draft.body)
  if (draft.body.trim() && (bodyChars < 1800 || bodyChars > 2500)) {
    issues.push({ where: '본문', quote: `${bodyChars.toLocaleString('ko-KR')}자`, reason: '본문 분량 규칙(1,800~2,500자) 밖' })
  }
  const len = draft.title.trim().length
  if (len > 0 && (len < 25 || len > 35)) {
    issues.push({ where: '제목', quote: `${len}자`, reason: '제목 길이 규칙(25~35자) 밖' })
  }

  // 제목에서 효과 단정 수식어만 지운 버전을 제안(예: "안 물으면 100% 후회" → "안 물으면 후회").
  let suggestedTitle: string | undefined
  let cleaned = draft.title
  for (const p of PATTERNS) if (p.stripFromTitle) cleaned = cleaned.replace(new RegExp(p.re.source, 'g'), '')
  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim()
  if (cleaned !== draft.title.trim() && cleaned.length > 0) suggestedTitle = cleaned
  return { issues, suggestedTitle }
}

// 대표님이 매번 확인·수정하지 않도록, 의미가 안 바뀌는 것은 코드가 먼저 고친다(비용 0).
// · 제목의 효과 단정 수식어(100%·무조건) 삭제  · 본문의 연락처(전화번호·이메일) 가림
// 본문의 단정 표현은 문장을 고쳐 써야 해서 자동 수정하지 않고 상자에 표시만 한다.
// 제목 길이(25~35자)는 호출부가 싼 모델로 다시 쓴다(runMajalnamBlog.fixBlogTitle).
export function autoFixDraft<T extends { title: string; body: string }>(draft: T): { draft: T; fixes: string[] } {
  const fixes: string[] = []
  let { title, body } = draft
  const { suggestedTitle } = checkBlogRules(draft)
  if (suggestedTitle) {
    fixes.push(`제목의 효과 단정 표현 삭제: "${title}" → "${suggestedTitle}"`)
    title = suggestedTitle
  }
  const noEmojiTitle = stripEmoji(title).trim()
  const noEmojiBody = body
    .split('\n')
    .map((l) => (/^\s*\[📸/.test(l) ? l : stripEmoji(l).replace(/^(\s*##)\s+/, '$1 ')))
    .join('\n')
  if (noEmojiTitle !== title.trim() || noEmojiBody !== body) {
    fixes.push('이모지 삭제(사진 자리 표시는 유지)')
    title = noEmojiTitle
    body = noEmojiBody
  }
  const contactRes = PATTERNS.filter((p) => p.reason.startsWith('연락처')).map((p) => new RegExp(p.re.source, 'g'))
  for (const re of contactRes) {
    if (re.test(body)) {
      body = body.replace(re, '[연락처 삭제]')
      fixes.push('본문의 연락처를 [연락처 삭제]로 가림')
    }
  }
  return { draft: { ...draft, title, body }, fixes }
}

// 본문 글자 수(공백 포함) — 꾸밈 표시(##·>·**)와 사진 자리 줄은 빼고 센다.
export function bodyCharCount(body: string): number {
  return plainNaverBody(body)
    .split('\n')
    .filter((l) => !/^\s*\[📸/.test(l))
    .join('\n')
    .trim().length
}

// 이모지(대표님 지시: 거의 쓰지 않음) — 사진 자리 표시 줄([📸 …])은 대표님용 안내라 남긴다.
const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F|\u200D)*/gu
function stripEmoji(line: string): string {
  return line.replace(EMOJI_RE, '').replace(/ {2,}/g, ' ')
}

export function titleLengthOk(title: string): boolean {
  const len = title.trim().length
  return len >= 25 && len <= 35
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 결재함·캘린더 글 맨 위에 붙이는 안내 상자. 채점 성공 + 걸린 표현 없음이면 빈 문자열.
export function buildBlogCheckHtml(params: {
  reviewed: boolean
  draft: { title: string; body: string }
  // 코드·AI가 이미 자동으로 고친 내역 — 투명하게 보여준다(대표님이 따로 고칠 필요 없음).
  autoFixes?: string[]
  // 브랜드 전용 추가 점검 결과(마잘남: checkImpact).
  extraIssues?: BlogRuleIssue[]
}): string {
  const { reviewed, draft, autoFixes = [], extraIssues = [] } = params
  const checked = checkBlogRules(draft)
  const suggestedTitle = checked.suggestedTitle
  const issues = [...checked.issues, ...extraIssues]
  const parts: string[] = []
  if (autoFixes.length > 0) {
    parts.push(`<b>✅ 자동으로 고쳐 두었어요</b><br/>${autoFixes.map((f) => `· ${esc(f)}`).join('<br/>')}`)
  }
  if (!reviewed) {
    parts.push(
      '<b>⚠️ 채점만 실패했어요 — 글 자체는 정상입니다.</b><br/>읽어 보시고 괜찮으면 승인하시면 돼요. (아래 자동 점검은 채점과 별개로 코드가 확인한 것)',
    )
  }
  if (issues.length > 0) {
    const list = issues.map((i) => `· ${i.where}: "${esc(i.quote)}" — ${esc(i.reason)}`).join('<br/>')
    parts.push(
      `<b>🔎 발행 전 확인 (자동으로 못 고친 것 — 이것만 봐주세요)</b><br/>${list}` +
        (suggestedTitle ? `<br/><b>제목 수정 제안:</b> ${esc(suggestedTitle)}` : ''),
    )
  } else if (!reviewed) {
    parts.push('🔎 규칙 자동 점검: 걸린 표현 없음')
  }
  if (parts.length === 0) return ''
  return `<div style="border:1.5px solid #e0a800;border-radius:10px;padding:10px 12px;background:#fff8e1;color:#4a3800">${parts.join('<br/><br/>')}</div><br/>`
}

// 결재함 칩·근무기록에 쓰는 문구 — "채점 실패"만 보면 글이 망가진 줄 알아서 바꿨다.
export const REVIEW_FAILED_LABEL = '채점 없음 · 글 정상'
export const REVIEW_FAILED_NOTE = '채점만 실패 — 글은 정상, 읽고 승인'

// 임팩트·숫자 점검(마잘남 블로그 전용 — 대표님: "밋밋하다, 숫자·콜아웃·비포애프터가 있어야").
// ① 꾸밈 요소(숫자 카드 "!! "·콜아웃 ":: "·비포애프터 "[전]/[후]")가 빠졌는지, 숫자가 너무 적은지
// ② 돈·사람·비율 단위가 붙은 숫자가 [검증된 사실]에 없는지(지어낸 숫자일 수 있음) — 코드로, 비용 0.
// 결과는 결재함 상자("못 고친 것")와 미달 자동 고쳐 쓰기 지시에 그대로 들어간다.
export function checkImpact(body: string, factsText: string): BlogRuleIssue[] {
  const issues: BlogRuleIssue[] = []
  const lines = body.split('\n').map((l) => l.trim())
  if (!lines.some((l) => l.startsWith('!!'))) {
    issues.push({ where: '본문', quote: '숫자 카드 0개', reason: '"!! " 숫자 카드가 없어 밋밋함(2~3개 필요)' })
  }
  if (!lines.some((l) => l.startsWith('::'))) {
    issues.push({ where: '본문', quote: '콜아웃 0개', reason: '":: " 콜아웃이 없음(1~2개 필요)' })
  }
  if (!(lines.some((l) => l.startsWith('[전]')) && lines.some((l) => l.startsWith('[후]')))) {
    issues.push({ where: '본문', quote: '비포·애프터 없음', reason: '"[전]"→"[후]" 비교가 없음(1개 필요)' })
  }
  const text = plainNaverBody(lines.filter((l) => !l.startsWith('[📸')).join('\n')).replace(/\[경험 삽입:[^\]]*\]/g, '')
  const numberCount = (text.match(/\d[\d,.]*/g) ?? []).length
  if (numberCount < 6) {
    issues.push({ where: '본문', quote: `숫자 ${numberCount}개`, reason: '구체적인 숫자가 적음(검증된 사실의 숫자로 6개 이상)' })
  }
  const allowed = new Set((factsText.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, '')))
  const seen = new Set<string>()
  for (const m of text.matchAll(/(\d[\d,.]*)\s*(억|만\s*원|만|천|원|명|팀|%|건)/g)) {
    const num = m[1].replace(/,/g, '').replace(/\.$/, '')
    const key = `${m[1]}${m[2]}`
    if (!allowed.has(num) && !seen.has(key)) {
      seen.add(key)
      issues.push({ where: '본문', quote: key, reason: '[검증된 사실]에 없는 숫자 — 지어낸 수치인지 확인' })
    }
  }
  return issues
}

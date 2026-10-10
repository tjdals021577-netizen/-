// 마잘남 블로그 본문 → 네이버 스마트에디터에 붙여넣기 좋은 HTML(대표님 지시: "너무 꾸미지 말고
// 적당하게, 읽기 좋게 — 블로그 대행·마케팅 업체 글처럼"). 글쓰기 프롬프트가 쓰는 꾸밈 표시는 3가지뿐:
//   "## 소제목"  → 가운데 굵은 18px 소제목(위아래 여백)
//   "> 요약 줄"  → 연한 회색 박스(질문-답 요약 블록)
//   "**핵심 문장**" → 굵게
// 그 외 줄은 가운데 정렬·넉넉한 줄간격, 빈 줄은 문단 간격. 사진 자리([📸 …])는 작은 회색 안내,
// [경험 삽입 …]은 노란 형광펜(대표님이 채울 자리). 스타일은 붙여넣기에서 살아남도록 전부 인라인.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[경험 삽입:[^\]]*\]/g, (m) => `<span style="background:#fff3a3">${m}</span>`)
}

const P = 'text-align:center;line-height:1.9;margin:0;font-size:15px;color:#222'

export function renderNaverBody(body: string, extraInline?: (html: string) => string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  const post = (html: string) => (extraInline ? extraInline(html) : html)
  let quote: string[] = []
  const flushQuote = () => {
    if (quote.length === 0) return
    out.push(
      `<div style="background:#f4f5f7;border-radius:8px;padding:14px 16px;margin:14px auto;max-width:560px;text-align:center;line-height:1.8;font-size:14.5px;color:#333">${quote
        .map((q) => post(inline(q)))
        .join('<br/>')}</div>`,
    )
    quote = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('>')) {
      quote.push(line.replace(/^>\s?/, ''))
      continue
    }
    flushQuote()
    if (line === '') {
      out.push('<p style="margin:0;line-height:1.9">&nbsp;</p>')
    } else if (line.startsWith('## ') || line.startsWith('##')) {
      const t = line.replace(/^##\s?/, '')
      out.push(`<p style="text-align:center;margin:26px 0 10px;font-size:18px;line-height:1.6;color:#111"><b>${post(inline(t))}</b></p>`)
    } else if (/^\[📸/.test(line)) {
      out.push(`<p style="text-align:center;margin:6px 0;font-size:12.5px;color:#9a9a9a">${post(esc(line))}</p>`)
    } else {
      out.push(`<p style="${P}">${post(inline(line))}</p>`)
    }
  }
  flushQuote()
  return out.join('')
}

// 꾸밈 표시를 걷어낸 순수 텍스트(붙여넣기 대체용·글자 수 계산용).
export function plainNaverBody(body: string): string {
  return body
    .split('\n')
    .map((l) => l.replace(/^\s*##\s?/, '').replace(/^\s*>\s?/, ''))
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
}

// 결재함 HTML 안에서 "네이버용 복사" 버튼이 찾는 표시(제목·본문을 각각 감싼다).
export const NAVER_TITLE_ATTR = 'data-naver-title'
export const NAVER_POST_ATTR = 'data-naver-post'

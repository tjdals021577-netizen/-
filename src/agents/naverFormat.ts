// 마잘남 블로그 본문 → 네이버 스마트에디터에 붙여넣기 좋은 HTML(대표님 지시: "적당하게, 읽기 좋게 —
// 블로그 대행·마케팅 업체 글처럼" + "밋밋하지 않게: 콜아웃·숫자 강조·비포/애프터"). 글쓰기 프롬프트가 쓰는 표시:
//   "## 소제목"      → 01·02… 번호 라벨 + 가운데 굵은 18px 소제목
//   "> 요약 줄"      → 연한 회색 박스(질문-답 요약 블록)
//   ":: 콜아웃 줄"   → 주황 왼쪽 선 + 연한 주황 바탕 "POINT" 박스(연속 줄은 한 박스)
//   "!! 숫자 한 줄"  → 크게 강조되는 숫자 카드
//   "[전] …" / "[후] …" → BEFORE → AFTER 비교 블록(연속된 전·후 한 쌍)
//   "**…**"          → 숫자가 있으면 주황 굵게, 문장이면 굵게 + 연한 형광펜
// 그 외 줄은 가운데 정렬·넉넉한 줄간격. 사진 자리([📸 …])는 작은 회색 안내, [경험 삽입 …]은 노란 형광펜.
// 스타일은 붙여넣기에서 살아남도록 전부 인라인.

const ACCENT = '#e8590c'
const ACCENT_SOFT = '#fff4e6'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, (_m, inner: string) =>
      /\d/.test(inner)
        ? `<b><span style="color:${ACCENT}">${inner}</span></b>`
        : `<b><span style="background:#fff3bf">${inner}</span></b>`,
    )
    .replace(/\[경험 삽입:[^\]]*\]/g, (m) => `<span style="background:#fff3a3">${m}</span>`)
}

const P = 'text-align:center;line-height:1.9;margin:0;font-size:15px;color:#222'
const BOX = 'margin:16px auto;max-width:560px;border-radius:8px;line-height:1.8;font-size:14.5px'

type Group = 'quote' | 'callout' | 'ba'
const isBA = (l: string) => /^\[(전|후)\]/.test(l)

export function renderNaverBody(body: string, extraInline?: (html: string) => string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  const post = (html: string) => (extraInline ? extraInline(html) : html)
  let group: Group | null = null
  let buf: string[] = []
  let headingNo = 0

  const flush = () => {
    if (!group || buf.length === 0) {
      group = null
      buf = []
      return
    }
    if (group === 'quote') {
      out.push(
        `<div style="${BOX};background:#f4f5f7;padding:14px 16px;text-align:center;color:#333">${buf
          .map((q) => post(inline(q)))
          .join('<br/>')}</div>`,
      )
    } else if (group === 'callout') {
      out.push(
        `<div style="${BOX};background:${ACCENT_SOFT};border-left:4px solid ${ACCENT};padding:12px 16px;text-align:left;color:#333">` +
          `<b><span style="color:${ACCENT};font-size:12.5px">POINT</span></b><br/>${buf.map((q) => post(inline(q))).join('<br/>')}</div>`,
      )
    } else {
      const row = (l: string) => {
        const before = l.startsWith('[전]')
        const text = post(inline(l.replace(/^\[(전|후)\]\s*/, '')))
        return before
          ? `<div style="background:#f1f3f5;border-radius:8px;padding:10px 14px;color:#555"><b><span style="color:#868e96;font-size:12.5px">BEFORE</span></b><br/>${text}</div>`
          : `<div style="background:${ACCENT_SOFT};border-radius:8px;padding:10px 14px;color:#222"><b><span style="color:${ACCENT};font-size:12.5px">AFTER</span></b><br/><b>${text}</b></div>`
      }
      out.push(
        `<div style="${BOX};text-align:center">${buf
          .map(row)
          .join(`<p style="margin:4px 0;color:${ACCENT};font-size:16px;text-align:center">↓</p>`)}</div>`,
      )
    }
    group = null
    buf = []
  }
  const push = (g: Group, text: string) => {
    if (group !== g) flush()
    group = g
    buf.push(text)
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('>')) {
      push('quote', line.replace(/^>\s?/, ''))
      continue
    }
    if (line.startsWith('::')) {
      push('callout', line.replace(/^::\s?/, ''))
      continue
    }
    if (isBA(line)) {
      push('ba', line)
      continue
    }
    flush()
    if (line === '') {
      out.push('<p style="margin:0;line-height:1.9">&nbsp;</p>')
    } else if (line.startsWith('##')) {
      headingNo += 1
      const t = line.replace(/^##\s?/, '')
      out.push(
        `<p style="text-align:center;margin:30px 0 2px;font-size:13px;color:${ACCENT}"><b>${String(headingNo).padStart(2, '0')}</b></p>` +
          `<p style="text-align:center;margin:0 0 12px;font-size:18px;line-height:1.6;color:#111"><b>${post(inline(t))}</b></p>`,
      )
    } else if (line.startsWith('!!')) {
      const t = line.replace(/^!!\s?/, '')
      out.push(
        `<p style="text-align:center;margin:18px auto;max-width:560px;padding:14px 12px;background:${ACCENT_SOFT};border-radius:10px;font-size:21px;line-height:1.5;color:${ACCENT}"><b>${post(esc(t).replace(/\*\*(.+?)\*\*/g, '$1'))}</b></p>`,
      )
    } else if (/^\[📸/.test(line)) {
      out.push(`<p style="text-align:center;margin:6px 0;font-size:12.5px;color:#9a9a9a">${post(esc(line))}</p>`)
    } else {
      out.push(`<p style="${P}">${post(inline(line))}</p>`)
    }
  }
  flush()
  return out.join('')
}

// 꾸밈 표시를 걷어낸 순수 텍스트(붙여넣기 대체용·글자 수 계산용).
export function plainNaverBody(body: string): string {
  return body
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*##\s?/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*::\s?/, '')
        .replace(/^\s*!!\s?/, '')
        .replace(/^\s*\[(전|후)\]\s*/, ''),
    )
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
}

// 결재함 HTML 안에서 "네이버용 복사" 버튼이 찾는 표시(제목·본문을 각각 감싼다).
export const NAVER_TITLE_ATTR = 'data-naver-title'
export const NAVER_POST_ATTR = 'data-naver-post'

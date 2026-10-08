// blog-brain 데이터 수집(지시서 2번) — 서버(크론) 전용.
//
// 두 가지 모드를 "환경변수 유무"로 자동 선택한다(대표님 결정: 일단 B로, 키 생기면 A로):
//  · A(정밀): NAVER_SEARCH_CLIENT_ID/SECRET 있으면 네이버 검색 API(블로그, sort=sim)로
//    키워드별 상위 글을 가져온다. 검색량은 NAVER_AD_* 있으면 검색광고 API(키워드도구).
//  · B(간편): 키가 없으면 Claude 웹서치로 상위 글 URL·제목을 모은다.
// 어느 모드든 모인 글은 m.blog 본문을 "코드로" 측정한다(글자 수·사진 수·소제목·
// 도입 3줄·FAQ·CTA) — AI 추정이 아니라 실측값이라 B 모드도 수치는 정확하다.
// 공식 공지(서치어드바이저·네이버 검색 공식 블로그 최근 7일)는 웹서치(최대 2회).
//
// 네이버가 HTML 구조를 바꾸거나 봇을 막으면 측정이 실패할 수 있다 — 실패한 글은
// 값이 null로 남고(분석 프롬프트에 "측정 실패"로 전달), 전체 수집을 막지 않는다.
import { createHmac } from 'node:crypto'
import { callClaudeJsonWithWebSearch, type UsageCallback } from '../../src/lib/claude.js'
import type { OfficialNotice, TopPostData } from '../../src/types/blogBrain.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

export function hasNaverSearchKeys(): boolean {
  return !!(process.env.NAVER_SEARCH_CLIENT_ID && process.env.NAVER_SEARCH_CLIENT_SECRET)
}

export function hasNaverAdKeys(): boolean {
  return !!(process.env.NAVER_AD_API_KEY && process.env.NAVER_AD_SECRET_KEY && process.env.NAVER_AD_CUSTOMER_ID)
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ── HTML → 텍스트 ──

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/​|‌|‍|﻿/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const charLen = (s: string): number => [...s].length
const clip = (s: string, n: number): string => (charLen(s) > n ? `${[...s].slice(0, n).join('')}…` : s)

// blog.naver.com 글 주소 → (blogId, logNo). 네이버 블로그 글이 아니면 null.
export function parseNaverPostUrl(url: string): { blogId: string; logNo: string } | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m)\./, '')
    if (host !== 'blog.naver.com') return null
    const blogId = u.searchParams.get('blogId')
    const logNo = u.searchParams.get('logNo')
    if (blogId && logNo && /^\d+$/.test(logNo)) return { blogId, logNo }
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) return { blogId: parts[0], logNo: parts[1] }
    return null
  } catch {
    return null
  }
}

interface Measured {
  title: string
  chars: number | null
  photos: number | null
  headingCount: number | null
  headings: string[]
  intro: string[]
  hasFaq: boolean | null
  ctaSentence: string
}

const FAQ_RE = /FAQ|자주\s*(묻는|하는)\s*질문|Q\s*[.:)]|Q\s*\d|Q&A|질문\s*\d/i
const CTA_RE = /(문의|신청|상담|링크|클릭|댓글|이웃|구독|DM|카톡|카카오|예약|방문|진단)/

// 스마트에디터 ONE(se-main-container) 본문을 컴포넌트 단위로 읽어 측정한다.
// 문단(p.se-text-paragraph)마다 "가장 가까운 앞 컴포넌트"의 종류로 제목/소제목/
// 인용구/본문을 구분한다(컴포넌트 끝 태그를 찾지 않아도 돼서 구조 변화에 덜 민감).
function measureSmartEditor(html: string): Measured | null {
  const start = html.indexOf('se-main-container')
  if (start < 0) return null
  const body = html.slice(start)
  const comps = [...body.matchAll(/<div class="se-component\s+([^"]*)"/g)].map((m) => ({
    idx: m.index ?? 0,
    classes: m[1],
  }))
  const owner = (idx: number): string => {
    let cls = ''
    for (const c of comps) {
      if (c.idx < idx) cls = c.classes
      else break
    }
    return cls
  }
  let title = ''
  const headings: string[] = []
  const quotes: string[] = []
  const paragraphs: string[] = []
  const allText: string[] = []
  for (const m of body.matchAll(/<p class="se-text-paragraph[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = htmlToText(m[1])
    if (!text) continue
    const cls = owner(m.index ?? 0)
    if (cls.includes('se-documentTitle')) {
      title = title ? `${title} ${text}` : text
      continue
    }
    allText.push(text)
    if (cls.includes('se-sectionTitle')) headings.push(clip(text, 40))
    else if (cls.includes('se-quotation')) quotes.push(text)
    else paragraphs.push(text)
  }
  if (allText.length === 0) return null
  // 소제목 컴포넌트를 안 쓰고 인용구로 소제목을 다는 블로그가 많아, 소제목이 0개면
  // 짧은 인용구를 소제목 대용으로 센다.
  const headingList = headings.length > 0 ? headings : quotes.filter((q) => charLen(q) <= 40).map((q) => clip(q, 40))
  const joined = allText.join(' ')
  const tail = paragraphs.slice(-6).reverse()
  const cta = tail.find((p) => CTA_RE.test(p)) ?? paragraphs[paragraphs.length - 1] ?? ''
  return {
    title,
    chars: charLen(joined),
    photos: (body.match(/se-image-resource/g) ?? []).length,
    headingCount: headingList.length,
    headings: headingList.slice(0, 8),
    intro: paragraphs.slice(0, 3).map((p) => clip(p, 80)),
    hasFaq: FAQ_RE.test(joined),
    ctaSentence: clip(cta, 120),
  }
}

function ogTitle(html: string): string {
  const m = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)
  return m ? decodeEntities(m[1]).trim() : ''
}

// 모바일 PostView 우선(지시서: m.blog), 본문을 못 찾으면 데스크톱 PostView로 한 번 더.
export async function measureNaverPost(url: string): Promise<Measured | null> {
  const ids = parseNaverPostUrl(url)
  if (!ids) return null
  const q = `blogId=${encodeURIComponent(ids.blogId)}&logNo=${ids.logNo}`
  const candidates = [
    `https://m.blog.naver.com/PostView.naver?${q}`,
    `https://blog.naver.com/PostView.naver?${q}`,
  ]
  let fallbackTitle = ''
  for (const target of candidates) {
    try {
      const res = await fetchWithTimeout(target, { headers: { 'User-Agent': MOBILE_UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } }, 10_000)
      if (!res.ok) continue
      const html = await res.text()
      fallbackTitle = fallbackTitle || ogTitle(html)
      const measured = measureSmartEditor(html)
      if (measured) return { ...measured, title: measured.title || fallbackTitle }
    } catch {
      // 다음 후보로.
    }
  }
  return fallbackTitle
    ? { title: fallbackTitle, chars: null, photos: null, headingCount: null, headings: [], intro: [], hasFaq: null, ctaSentence: '' }
    : null
}

// ── A 모드: 네이버 검색 API(블로그) ──

async function naverBlogSearch(keyword: string, display: number): Promise<{ title: string; url: string }[]> {
  const res = await fetchWithTimeout(
    `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(keyword)}&display=${display}&sort=sim`,
    {
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_SEARCH_CLIENT_ID ?? '',
        'X-Naver-Client-Secret': process.env.NAVER_SEARCH_CLIENT_SECRET ?? '',
      },
    },
    10_000,
  )
  if (!res.ok) throw new Error(`네이버 검색 API ${res.status}`)
  const data = (await res.json()) as { items?: { title?: string; link?: string }[] }
  return (data.items ?? []).map((it) => ({ title: htmlToText(it.title ?? ''), url: it.link ?? '' }))
}

// ── 검색량: 네이버 검색광고 API(키워드도구) ──
// HMAC-SHA256 서명: base64(HMAC(secret, `${timestamp}.GET./keywordstool`)).
// 키가 없거나 실패하면 '없음'을 돌려준다(키워드 프롬프트가 검색량 없이 진행).
export async function fetchKeywordVolumes(hints: string[]): Promise<string> {
  if (!hasNaverAdKeys()) return '없음'
  try {
    const timestamp = String(Date.now())
    const uri = '/keywordstool'
    const signature = createHmac('sha256', process.env.NAVER_AD_SECRET_KEY ?? '')
      .update(`${timestamp}.GET.${uri}`)
      .digest('base64')
    // 키워드도구 hintKeywords는 공백을 허용하지 않고 최대 5개.
    const hintParam = hints
      .map((h) => h.replace(/\s+/g, ''))
      .filter(Boolean)
      .slice(0, 5)
      .map(encodeURIComponent)
      .join(',')
    const res = await fetchWithTimeout(
      `https://api.searchad.naver.com${uri}?hintKeywords=${hintParam}&showDetail=1`,
      {
        headers: {
          'X-Timestamp': timestamp,
          'X-API-KEY': process.env.NAVER_AD_API_KEY ?? '',
          'X-Customer': process.env.NAVER_AD_CUSTOMER_ID ?? '',
          'X-Signature': signature,
        },
      },
      10_000,
    )
    if (!res.ok) return '없음'
    const data = (await res.json()) as {
      keywordList?: { relKeyword?: string; monthlyPcQcCnt?: number | string; monthlyMobileQcCnt?: number | string; compIdx?: string }[]
    }
    // "< 10"처럼 문자열로 오는 저검색 키워드는 5로 간주(정렬용).
    const n = (v: number | string | undefined) => (typeof v === 'number' ? v : 5)
    const rows = (data.keywordList ?? [])
      .filter((k) => k.relKeyword && /스레드|SNS|마케팅|인스타|브랜딩/.test(k.relKeyword))
      .sort((a, b) => n(b.monthlyPcQcCnt) + n(b.monthlyMobileQcCnt) - (n(a.monthlyPcQcCnt) + n(a.monthlyMobileQcCnt)))
      .slice(0, 40)
    if (rows.length === 0) return '없음'
    return rows
      .map((k) => `${k.relKeyword} / ${k.monthlyPcQcCnt ?? '-'} / ${k.monthlyMobileQcCnt ?? '-'} / ${k.compIdx ?? '-'}`)
      .join('\n')
  } catch {
    return '없음'
  }
}

// ── 웹서치 수집기(B 모드의 상위글 + 공식 공지) ──

interface CollectorResult {
  posts: { keyword: string; rank: number; title: string; url: string }[]
  notices: OfficialNotice[]
}

async function webSearchCollect(params: {
  apiKey: string
  keywords: string[]
  includePosts: boolean
  todayKst: string
  maxSearches: number
  onUsage?: UsageCallback
}): Promise<CollectorResult> {
  const { apiKey, keywords, includePosts, todayKst, maxSearches, onUsage } = params
  const postPart = includePosts
    ? `[수집 1 — 상위노출 글]
아래 키워드 각각으로 네이버 블로그(blog.naver.com)에서 상위에 노출되는 글을 찾아, 키워드당 최대 5개까지 제목과 URL을 적는다.
- 키워드: ${keywords.join(' / ')}
- 검색 결과에서 실제로 확인한 글만 적는다. URL은 blog.naver.com 글 주소여야 한다. 지어내지 않는다.
- rank는 그 키워드에서 찾은 순서(1부터).

`
    : ''
  const system = `너는 네이버 블로그 데이터 수집기다. 웹 검색으로 "확인된 사실"만 모아 JSON으로 돌려준다. 분석·추측·창작은 하지 않는다.

${postPart}[수집 ${includePosts ? '2' : '1'} — 공식 공지]
네이버 서치어드바이저(searchadvisor.naver.com) 공지와 네이버 검색 공식 블로그의 글 중, 오늘(${todayKst}) 기준 최근 7일 안에 올라온 것만 적는다.
블로그 검색·노출에 관련된 것만. 날짜를 확인할 수 없거나 7일보다 오래됐으면 넣지 않는다. 없으면 빈 배열.

[검색 횟수] 총 ${maxSearches}회 이내.
[출력] 설명·코드블록 없이 아래 스키마의 순수 JSON만.
{ "posts": [ { "keyword": string, "rank": number, "title": string, "url": string } ],
  "notices": [ { "title": string, "date": "YYYY-MM-DD", "source": string, "summary": string } ] }`
  const raw = (await callClaudeJsonWithWebSearch({
    apiKey,
    system,
    user: `오늘은 ${todayKst}입니다. 위 지시대로 수집해 JSON으로만 답하세요.`,
    maxSearches,
    maxTokens: 3000,
    timeoutMs: 300_000,
    // 사실 수집만 하는 단계 — 얕게(비용 절감 A).
    effort: 'low',
    onUsage,
  })) as Record<string, unknown>
  const posts = (Array.isArray(raw.posts) ? raw.posts : [])
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      keyword: String(p.keyword ?? ''),
      rank: typeof p.rank === 'number' ? p.rank : 0,
      title: String(p.title ?? ''),
      url: String(p.url ?? ''),
    }))
    .filter((p) => p.keyword && parseNaverPostUrl(p.url))
  const cutoff = Date.parse(todayKst) - 8 * 86_400_000
  const notices = (Array.isArray(raw.notices) ? raw.notices : [])
    .filter((n): n is Record<string, unknown> => typeof n === 'object' && n !== null)
    .map((n) => ({
      title: String(n.title ?? ''),
      date: String(n.date ?? ''),
      source: String(n.source ?? ''),
      summary: String(n.summary ?? ''),
    }))
    .filter((n) => n.title && !(Date.parse(n.date) < cutoff))
  return { posts, notices }
}

// 동시에 너무 많이 긁지 않게(네이버 차단 방지) 4개씩.
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export interface BlogBrainCollection {
  mode: 'A' | 'B'
  posts: TopPostData[]
  notices: OfficialNotice[]
  note: string
}

export async function collectBlogBrainData(params: {
  apiKey: string
  keywords: string[]
  todayKst: string
  onUsage?: UsageCallback
}): Promise<BlogBrainCollection> {
  const { apiKey, keywords, todayKst, onUsage } = params
  const notes: string[] = []
  let rawPosts: { keyword: string; rank: number; title: string; url: string }[] = []
  let notices: OfficialNotice[] = []
  const mode: 'A' | 'B' = hasNaverSearchKeys() ? 'A' : 'B'

  if (mode === 'A') {
    // A: 키워드 6개 × 상위 7개(측정 부담·분석 토큰을 고려한 상한).
    const targets = keywords.slice(0, 6)
    const results = await Promise.all(
      targets.map(async (kw) => {
        try {
          return (await naverBlogSearch(kw, 7)).map((it, i) => ({ keyword: kw, rank: i + 1, title: it.title, url: it.url }))
        } catch (err) {
          notes.push(`검색API 실패(${kw}): ${err instanceof Error ? err.message : String(err)}`)
          return []
        }
      }),
    )
    rawPosts = results.flat()
    try {
      notices = (await webSearchCollect({ apiKey, keywords: [], includePosts: false, todayKst, maxSearches: 2, onUsage })).notices
    } catch (err) {
      notes.push(`공지 수집 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    // B: 웹서치로 키워드 4개 상위글 + 공지를 한 번에(검색 6회 이내).
    try {
      const collected = await webSearchCollect({
        apiKey,
        keywords: keywords.slice(0, 4),
        includePosts: true,
        todayKst,
        maxSearches: 6,
        onUsage,
      })
      rawPosts = collected.posts
      notices = collected.notices
    } catch (err) {
      notes.push(`웹서치 수집 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 중복 URL 제거 후 최대 30개 실측.
  const seen = new Set<string>()
  const unique = rawPosts.filter((p) => {
    const ids = parseNaverPostUrl(p.url)
    if (!ids) return false
    const key = `${ids.blogId}/${ids.logNo}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 30)

  const posts = await mapPool(unique, 4, async (p): Promise<TopPostData> => {
    const m = await measureNaverPost(p.url).catch(() => null)
    return {
      keyword: p.keyword,
      rank: p.rank,
      title: m?.title || p.title,
      url: p.url,
      chars: m?.chars ?? null,
      photos: m?.photos ?? null,
      headingCount: m?.headingCount ?? null,
      headings: m?.headings ?? [],
      intro: m?.intro ?? [],
      hasFaq: m?.hasFaq ?? null,
      ctaSentence: m?.ctaSentence ?? '',
    }
  })
  const measuredCount = posts.filter((p) => p.chars !== null).length
  notes.unshift(`모드 ${mode} · 상위글 ${posts.length}개(본문 측정 성공 ${measuredCount}) · 공지 ${notices.length}건`)
  return { mode, posts, notices, note: notes.join(' / ') }
}

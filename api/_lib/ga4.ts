// 서비스 계정(JSON 키)으로 GA4 Data API를 호출한다. 별도 npm 패키지(googleapis 등) 없이
// Node 내장 crypto로 JWT를 직접 서명해서 액세스 토큰을 발급받는다(서비스 계정 표준 플로우).
import { createSign } from 'node:crypto'

interface ServiceAccountKey {
  client_email: string
  private_key: string
}

export interface Ga4Report {
  sessions: number
  activeUsers: number
  conversions: number
  topPages: { path: string; views: number }[]
  trafficSources: { source: string; sessions: number }[]
  naverLandingPages: { landingPage: string; sessions: number }[]
}

interface RunReportResponse {
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[]
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function getAccessToken(key: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  )
  const signInput = `${header}.${claims}`
  const signer = createSign('RSA-SHA256')
  signer.update(signInput)
  signer.end()
  const signature = base64url(signer.sign(key.private_key))
  const jwt = `${signInput}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    throw new Error(`GA4 토큰 발급 실패: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

async function runReport(
  accessToken: string,
  propertyId: string,
  body: object,
): Promise<RunReportResponse> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    throw new Error(`GA4 runReport 실패: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<RunReportResponse>
}

// startDate/endDate는 GA4 API가 그대로 받는 형식('yesterday', 'today', 'NdaysAgo', 'YYYY-MM-DD').
export async function fetchGa4Report(params: {
  serviceAccountKeyJson: string
  propertyId: string
  startDate: string
  endDate: string
}): Promise<Ga4Report> {
  const key = JSON.parse(params.serviceAccountKeyJson) as ServiceAccountKey
  const accessToken = await getAccessToken(key)
  const dateRanges = [{ startDate: params.startDate, endDate: params.endDate }]

  const [summary, pages, sources, naverLandingPages] = await Promise.all([
    runReport(accessToken, params.propertyId, {
      dateRanges,
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'conversions' }],
    }),
    runReport(accessToken, params.propertyId, {
      dateRanges,
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: '5',
    }),
    runReport(accessToken, params.propertyId, {
      dateRanges,
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: '5',
    }),
    // 네이버 검색으로 들어온 세션이 "어느 페이지로 착지했는지" — 브랜드명
    // 검색(보통 홈으로 착지)과 블로그 글 검색(그 글 주소로 착지)을 구분하는
    // 용도(대표님 요청 — GA4는 검색어 자체는 안 주지만 착지 페이지는 준다).
    runReport(accessToken, params.propertyId, {
      dateRanges,
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionSource',
          stringFilter: { matchType: 'CONTAINS', value: 'naver', caseSensitive: false },
        },
      },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: '5',
    }),
  ])

  const summaryValues = summary.rows?.[0]?.metricValues
  return {
    sessions: Number(summaryValues?.[0]?.value ?? 0),
    activeUsers: Number(summaryValues?.[1]?.value ?? 0),
    conversions: Number(summaryValues?.[2]?.value ?? 0),
    topPages: (pages.rows ?? []).map((r) => ({
      path: r.dimensionValues?.[0]?.value ?? '',
      views: Number(r.metricValues?.[0]?.value ?? 0),
    })),
    trafficSources: (sources.rows ?? []).map((r) => ({
      source: r.dimensionValues?.[0]?.value ?? '',
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
    })),
    naverLandingPages: (naverLandingPages.rows ?? []).map((r) => ({
      landingPage: r.dimensionValues?.[0]?.value ?? '',
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
    })),
  }
}

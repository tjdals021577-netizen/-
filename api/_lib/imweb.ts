// 아임웹 오픈 API — API Key/Secret Key로 액세스 토큰을 발급받아 REST 호출한다.
// 공식 문서: https://developers-docs.imweb.me/ (인증 POST /v2/auth, 주문 조회 GET /v2/shop/orders)
// 주의: 응답 필드명이 문서에서 100% 확정되지 않아 방어적으로 여러 후보 키를 시도한다.
// 처음 실제로 돌 때 rawSample을 work_log에 남겨서, 필드명이 다르면 바로 확인하고 고칠 수 있게 했다.

const BASE_URL = 'https://api.imweb.me/v2'

function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  return values.find((v) => v !== undefined && v !== null)
}

async function getAccessToken(apiKey: string, secretKey: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: apiKey, secret: secretKey }),
  })
  if (!res.ok) {
    throw new Error(`아임웹 인증 실패: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  const dataBlock = data.data as Record<string, unknown> | undefined
  // 실제 응답: {"msg":"SUCCESS","code":200,"access_token":"..."} — 토큰이 최상위
  // access_token(snake_case)에 온다. 예전엔 accessToken/access-token만 찾아서
  // "토큰을 응답에서 찾지 못함"으로 실패했다.
  const token = firstDefined(
    data.access_token,
    data.accessToken,
    data['access-token'],
    dataBlock?.access_token,
    dataBlock?.accessToken,
    dataBlock?.['access-token'],
  ) as string | undefined
  if (!token) {
    throw new Error(`아임웹 액세스 토큰을 응답에서 찾지 못함: ${JSON.stringify(data).slice(0, 500)}`)
  }
  return token
}

export interface ImwebOrderSummary {
  orderCount: number
  revenueKrw: number | null
  rawSample: string
}

export async function fetchImwebOrderSummary(params: {
  apiKey: string
  secretKey: string
  dateFrom: string // YYYY-MM-DD
  dateTo: string // YYYY-MM-DD
}): Promise<ImwebOrderSummary> {
  const token = await getAccessToken(params.apiKey, params.secretKey)
  const url = `${BASE_URL}/shop/orders?order-date-from=${params.dateFrom}&order-date-to=${params.dateTo}&limit=100`
  // 아임웹은 토큰을 access-token 헤더로 받는 편인데 규격이 문서마다 달라서,
  // Bearer와 access-token 둘 다 넣는다(둘 다 보내도 무해 — 읽는 쪽만 쓴다).
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'access-token': token },
  })
  if (!res.ok) {
    throw new Error(`아임웹 주문 조회 실패: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  const dataBlock = data.data as Record<string, unknown> | undefined
  const listCandidate = firstDefined(data.list, dataBlock?.list, data.orders) as
    | unknown[]
    | undefined
  const list = Array.isArray(listCandidate) ? listCandidate : []

  // 실제 결제 금액 = payment.payment_amount(할인 반영). total_price는 할인 전
  // 정가라 그걸 합치면 매출이 부풀려진다(실사용에서 8배 부풀려짐을 확인).
  const orderAmount = (o: unknown): number => {
    const rec = o as Record<string, unknown>
    const p = (rec.payment ?? {}) as Record<string, unknown>
    const v = firstDefined(p.payment_amount, p.paymentAmount, rec.payment_amount)
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : NaN
  }
  // order_time(유닉스 초, KST 기준 날짜)로 조회 범위 안 주문만 센다 — 아임웹의
  // order-date 파라미터가 안 먹혀 다른 달 주문까지 섞여 오는 경우를 여기서 확실히 거른다.
  const orderKstDate = (o: unknown): string | null => {
    const rec = o as Record<string, unknown>
    const t = Number(rec.order_time ?? rec.orderTime)
    if (!Number.isFinite(t) || t <= 0) return null
    return new Date(t * 1000 + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }

  const inRange = list.filter((o) => {
    const d = orderKstDate(o)
    return d !== null && d >= params.dateFrom && d <= params.dateTo
  })

  let revenueKrw: number | null = null
  if (inRange.length > 0) {
    const finite = inRange.map(orderAmount).filter((n) => Number.isFinite(n))
    revenueKrw = finite.length > 0 ? finite.reduce((sum, n) => sum + n, 0) : null
  }

  return {
    orderCount: inRange.length,
    revenueKrw,
    rawSample: list.length > 0 ? JSON.stringify(list[0]).slice(0, 1000) : '(해당 기간 주문 없음)',
  }
}

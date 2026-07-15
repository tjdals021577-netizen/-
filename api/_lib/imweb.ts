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
  const token = firstDefined(
    data.accessToken,
    data['access-token'],
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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Error(`아임웹 주문 조회 실패: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  const dataBlock = data.data as Record<string, unknown> | undefined
  const listCandidate = firstDefined(data.list, dataBlock?.list, data.orders) as
    | unknown[]
    | undefined
  const list = Array.isArray(listCandidate) ? listCandidate : []

  let revenueKrw: number | null = null
  if (list.length > 0) {
    const amounts = list.map((o) => {
      const rec = o as Record<string, unknown>
      // 아임웹 v2는 결제 금액을 주문 객체 안 payment(중첩) 객체에 snake_case로
      // 넣어준다(payment.total_price 등). 예전엔 최상위 카멜케이스 필드만 찾아서
      // 못 읽고 매출이 null로 떨어졌다 — 중첩 payment + snake_case 후보를 모두 시도한다.
      const payment = (rec.payment ?? rec.pay ?? rec.payment_info ?? {}) as Record<string, unknown>
      const val = firstDefined(
        // 중첩 payment 우선(실제 구조)
        payment.total_price,
        payment.totalPrice,
        payment.price,
        payment.paymentAmount,
        payment.payment_price,
        payment.amount,
        // 최상위 폴백(스키마가 평면일 때)
        rec.total_price,
        rec.order_price,
        rec.paymentAmount,
        rec.totalPrice,
        rec.finalPrice,
        rec.amount,
        rec.price,
      )
      return typeof val === 'number' ? val : Number(val)
    })
    // 일부 주문만 금액이 파싱돼도 그걸 합산한다(예전엔 하나라도 NaN이면 전체 null이라
    // 매출이 통째로 안 보였다). 하나도 못 읽으면 그때만 null(필드 재확인 필요).
    const finite = amounts.filter((n) => Number.isFinite(n))
    revenueKrw = finite.length > 0 ? finite.reduce((sum, n) => sum + n, 0) : null
  }

  return {
    orderCount: list.length,
    revenueKrw,
    rawSample: list.length > 0 ? JSON.stringify(list[0]).slice(0, 1000) : '(해당 기간 주문 없음)',
  }
}

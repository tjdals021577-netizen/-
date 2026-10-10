// 크론 함수 전용 — service role 키로 RLS를 우회해서 자유롭게 읽고 쓴다.
// 프론트엔드(src/lib/remoteSync.ts)는 절대 이 키를 쓰지 않는다(anon 키만 사용).

function assertConfigured(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.')
  }
  return { url, key }
}

// PostgREST가 401 PGRST303 "JWT issued at future"(또는 나중에 유효해지는 nbf)를
// 낼 때가 있다 — 서비스 키의 발급시각(iat)이 Supabase 서버 시계보다 아주 살짝
// 미래일 때다(키를 최근 재발급했거나 시계가 미세하게 어긋난 경우). 실제로
// 병렬 크론에서 한 브랜드만 이걸로 실패하는 일이 있었다(같은 키·같은 순간이라도
// 요청마다 경계에서 갈림). 이건 시간이 지나면 서버 시계가 iat를 지나가 저절로
// 풀리는 "일시적" 오류이므로, 잠깐 기다렸다 몇 번 재시도한다. 우리 쓰기는 모두
// 멱등(upsert=merge-duplicates / PATCH / 필터 DELETE / SELECT)이라 재시도가 안전하다.
function isClockSkewAuthError(status: number, body: string): boolean {
  if (status !== 401) return false
  return /PGRST303|issued at future|not yet valid|issued in the future|before .*nbf/i.test(body)
}

async function supaFetch(
  label: string,
  path: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
  const { url, key } = assertConfigured()
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(init.headers ?? {}),
  }
  // 최대 4회(초기 1 + 재시도 3). 시계 차는 보통 1~2초 안쪽이라 1.5s→3s→4.5s면 충분.
  let lastBody = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${url}${path}`, { ...init, headers })
    if (res.ok) return res
    const body = await res.text()
    if (isClockSkewAuthError(res.status, body) && attempt < 3) {
      lastBody = body
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    throw new Error(`Supabase ${label} 실패: ${res.status} ${body || lastBody}`)
  }
  // 여기 도달하면 재시도까지 전부 시계 오류로 실패한 경우.
  throw new Error(`Supabase ${label} 실패(시계 동기화 재시도 소진): 401 ${lastBody}`)
}

export async function supabaseSelect<T>(table: string, query: string): Promise<T[]> {
  const res = await supaFetch(`select (${table})`, `/rest/v1/${table}?${query}`, {})
  return res.json() as Promise<T[]>
}

export async function supabaseInsert(table: string, record: object): Promise<void> {
  await supaFetch(`insert (${table})`, `/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(record),
  })
}

// 이미 있는 행의 "일부 컬럼만" 갱신할 때 쓴다(PATCH=UPDATE). supabaseInsert(=upsert)로
// 부분 레코드를 보내면, 행이 있어도 INSERT 경로에서 name·status 등 NOT NULL 컬럼이
// 빠져 제약 위반이 날 수 있다 — 부분 갱신은 반드시 이 함수로 한다. query는 대상
// 행을 특정하는 PostgREST 필터(예: "id=eq.abc") — 안전을 위해 필수.
export async function supabaseUpdate(table: string, query: string, record: object): Promise<void> {
  if (!query.trim()) {
    throw new Error(`Supabase update 안전장치: ${table} 갱신에 필터(query)가 없습니다.`)
  }
  await supaFetch(`update (${table})`, `/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(record),
  })
}

// 조건에 맞는 행을 삭제하고, 삭제된 개수를 돌려준다(Prefer: return=representation).
// query는 PostgREST 필터(예: "created_at=lt.2026-02-16") — 안전을 위해 반드시
// 하나 이상의 필터를 넘겨야 한다(빈 query로 전체 삭제되는 사고 방지).
export async function supabaseDelete(table: string, query: string): Promise<number> {
  if (!query.trim()) {
    throw new Error(`Supabase delete 안전장치: ${table} 삭제에 필터(query)가 없습니다.`)
  }
  // count=exact로 삭제 개수만 헤더로 받는다 — return=representation을 쓰면
  // 삭제된 행(여기선 큰 base64 이미지)을 전부 응답으로 내려받아 느려진다.
  const res = await supaFetch(`delete (${table})`, `/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: {
      Prefer: 'count=exact,return=minimal',
    },
  })
  // content-range 헤더: "*/12" 형식 — 슬래시 뒤가 삭제된 개수.
  const range = res.headers.get('content-range')
  const n = range ? Number(range.split('/')[1]) : NaN
  return Number.isFinite(n) ? n : 0
}

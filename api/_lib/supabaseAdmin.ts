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

export async function supabaseSelect<T>(table: string, query: string): Promise<T[]> {
  const { url, key } = assertConfigured()
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    throw new Error(`Supabase select 실패 (${table}): ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T[]>
}

export async function supabaseInsert(table: string, record: object): Promise<void> {
  const { url, key } = assertConfigured()
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(record),
  })
  if (!res.ok) {
    throw new Error(`Supabase insert 실패 (${table}): ${res.status} ${await res.text()}`)
  }
}

// 조건에 맞는 행을 삭제하고, 삭제된 개수를 돌려준다(Prefer: return=representation).
// query는 PostgREST 필터(예: "created_at=lt.2026-02-16") — 안전을 위해 반드시
// 하나 이상의 필터를 넘겨야 한다(빈 query로 전체 삭제되는 사고 방지).
export async function supabaseDelete(table: string, query: string): Promise<number> {
  const { url, key } = assertConfigured()
  if (!query.trim()) {
    throw new Error(`Supabase delete 안전장치: ${table} 삭제에 필터(query)가 없습니다.`)
  }
  // count=exact로 삭제 개수만 헤더로 받는다 — return=representation을 쓰면
  // 삭제된 행(여기선 큰 base64 이미지)을 전부 응답으로 내려받아 느려진다.
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact,return=minimal',
    },
  })
  if (!res.ok) {
    throw new Error(`Supabase delete 실패 (${table}): ${res.status} ${await res.text()}`)
  }
  // content-range 헤더: "*/12" 형식 — 슬래시 뒤가 삭제된 개수.
  const range = res.headers.get('content-range')
  const n = range ? Number(range.split('/')[1]) : NaN
  return Number.isFinite(n) ? n : 0
}

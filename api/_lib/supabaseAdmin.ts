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

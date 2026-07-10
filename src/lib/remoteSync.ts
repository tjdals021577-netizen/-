// Phase 4(Supabase 프로젝트)가 연결되면, 로컬 저장과 별도로 같은 레코드를
// 서버에도 비동기로 복제해서 크론 작업이 읽을 수 있게 한다.
// 연결 전(지금)에는 환경변수가 없어서 즉시 조용히 아무 것도 하지 않는다 —
// 로컬 전용 동작에는 어떤 영향도 주지 않는다.
const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY

export function syncToSupabase(table: string, record: object): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(record),
  }).catch(() => {
    // 네트워크 실패는 조용히 무시 — 로컬 저장은 이미 끝났으므로 기능에 영향 없음
  })
}

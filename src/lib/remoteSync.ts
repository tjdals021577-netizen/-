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
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(record),
  }).catch(() => {
    // 네트워크 실패는 조용히 무시 — 로컬 저장은 이미 끝났으므로 기능에 영향 없음
  })
}

// 설정 화면의 "연결 테스트" 버튼용 — syncToSupabase와 달리 에러를 숨기지 않고
// 그대로 화면에 보여줘서, 개발자 도구 없이도 문제를 바로 확인할 수 있게 한다.
export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      ok: false,
      message:
        'VITE_SUPABASE_URL 또는 VITE_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다 (배포 환경변수 확인 필요).',
    }
  }
  try {
    const testRecord = {
      id: `conn-test-${Date.now()}`,
      agent: 'test',
      brand: '마잘남',
      kind: '연결 테스트',
      status: 'done',
      status_label: '완료',
      started_at: new Date().toISOString(),
      note: '설정 화면에서 실행한 연결 테스트',
      detail_html: '',
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/work_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(testRecord),
    })
    if (res.ok) {
      return {
        ok: true,
        message: `성공! (상태 코드 ${res.status}) Supabase work_log 테이블에 테스트 행이 추가됐습니다.`,
      }
    }
    const bodyText = await res.text()
    return { ok: false, message: `실패 — 상태 코드 ${res.status}\n${bodyText}` }
  } catch (err) {
    return {
      ok: false,
      message: `네트워크 오류(요청 자체가 실패함): ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

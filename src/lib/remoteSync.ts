// Phase 4(Supabase 프로젝트)가 연결되면, 로컬 저장과 별도로 같은 레코드를
// 서버에도 비동기로 복제해서 크론 작업이 읽을 수 있게 한다.
// 연결 전(지금)에는 환경변수가 없어서 즉시 조용히 아무 것도 하지 않는다 —
// 로컬 전용 동작에는 어떤 영향도 주지 않는다.
// 사람이 Vercel 환경변수에 직접 복사/붙여넣기 하다 보면 눈에 안 보이는
// 공백·특수문자가 섞여 들어올 수 있다(HTTP 헤더는 ISO-8859-1 범위 밖 문자를
// 허용하지 않아 그런 문자가 하나만 있어도 fetch 자체가 즉시 실패한다).
// 앞뒤 공백 제거 + 출력 가능한 ASCII 범위 밖 문자를 제거해서 방어한다.
function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}

const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

// 프론트엔드 타입(WorkLogEntry 등)은 카멜케이스인데 Supabase 테이블 컬럼은
// 스네이크케이스다(started_at 등). 이름이 안 맞으면 PostgREST가 "컬럼을
// 못 찾음" 에러를 응답하지만, 아래 fetch가 실패를 조용히 무시하도록 설계돼
// 있어서 화면에는 아무 문제 없이 보이면서 실제로는 저장이 안 되는 문제가
// 있었다(실제로 겪은 문제). 호출부마다 일일이 변환하지 않도록 여기서
// 한 번에 처리한다.
function toSnakeCase(record: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value
  }
  return out
}

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
    body: JSON.stringify(toSnakeCase(record)),
  })
    .then((res) => {
      if (!res.ok) {
        res.text().then((text) => console.warn(`[Supabase sync 실패] ${table}:`, res.status, text))
      }
    })
    .catch(() => {
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
    const debugLine = `[사용 중인 값] URL=${SUPABASE_URL} / KEY 앞 20자=${SUPABASE_ANON_KEY.slice(0, 20)}... (길이 ${SUPABASE_ANON_KEY.length}자)`
    if (res.ok) {
      return {
        ok: true,
        message: `성공! (상태 코드 ${res.status}) Supabase work_log 테이블에 테스트 행이 추가됐습니다.\n${debugLine}`,
      }
    }
    const bodyText = await res.text()
    return { ok: false, message: `실패 — 상태 코드 ${res.status}\n${bodyText}\n${debugLine}` }
  } catch (err) {
    const debugLine = `[사용 중인 값] URL=${SUPABASE_URL} / KEY 앞 20자=${SUPABASE_ANON_KEY.slice(0, 20)}... (길이 ${SUPABASE_ANON_KEY.length}자)`
    return {
      ok: false,
      message: `네트워크 오류(요청 자체가 실패함): ${err instanceof Error ? err.message : String(err)}\n${debugLine}`,
    }
  }
}

import { supabaseInsert } from '../_lib/supabaseAdmin'
import { fetchGa4Report } from '../_lib/ga4'
import type { Brand } from '../../src/types/brand'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 브랜드별 GA4 속성 ID 환경변수 — 서비스 계정(GA4_SERVICE_ACCOUNT_KEY)은 공용으로
// 재사용하고, 속성 ID만 브랜드별로 다르다. 아직 GA4를 연결 안 한 브랜드는 해당
// 환경변수가 비어있으므로 건너뛴다(에러 아님 — 순차적으로 하나씩 연결해가는 걸 전제).
const PROPERTY_ID_ENV_KEY: Record<Brand, string> = {
  업메리: 'GA4_PROPERTY_ID_UPMERY',
  마잘남: 'GA4_PROPERTY_ID_MAJALNAM',
}

// 매일 08시 모닝 크론 직전에 돌아서(vercel.json 참고), 어제 하루치 GA4 스냅샷을
// Supabase radar_snapshots에 저장한다. 모닝 크론이 이 값을 읽어서 브리핑에 반영하고,
// 프론트 대시보드도 이 테이블을 읽어서 방문자 수 등을 보여준다.
export default async function handler(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const keyJson = process.env.GA4_SERVICE_ACCOUNT_KEY
  if (!keyJson) {
    return new Response('GA4_SERVICE_ACCOUNT_KEY 환경변수가 설정되지 않았습니다.', {
      status: 500,
    })
  }

  const results: string[] = []
  for (const [brand, envKey] of Object.entries(PROPERTY_ID_ENV_KEY) as [Brand, string][]) {
    const propertyId = process.env[envKey]
    if (!propertyId) {
      results.push(`${brand}: 건너뜀 (${envKey} 미설정)`)
      continue
    }

    const report = await fetchGa4Report({
      serviceAccountKeyJson: keyJson,
      propertyId,
      startDate: 'yesterday',
      endDate: 'yesterday',
    })

    await supabaseInsert('radar_snapshots', {
      id: makeId(),
      brand,
      source: 'ga4',
      period_label: '어제',
      sessions: report.sessions,
      active_users: report.activeUsers,
      conversions: report.conversions,
      top_pages: report.topPages,
      traffic_sources: report.trafficSources,
      created_at: new Date().toISOString(),
    })
    results.push(`${brand}: 방문자 ${report.activeUsers}명 / 세션 ${report.sessions}회`)
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

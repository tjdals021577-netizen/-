import type { IncomingMessage, ServerResponse } from 'node:http'
import { estimateCostUsd } from '../../src/lib/budgetGuard.js'
import { researchMarketResilient } from '../../src/agents/runBrain.js'
import { BRANDS, BRAND_CONTEXT, BRAND_CHANNELS, BRAND_RESEARCH_FOCUS } from '../../src/types/brand.js'
import { supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, haltIfPaused, sendText, sendJson } from '../_lib/cronHandler.js'

// 웹서치를 포함한 리서치는 오래 걸린다(비스트리밍일 땐 210초에도 못 끝나 504·폴백이
// 반복됐다). 이제 runBrain은 스트리밍으로 호출하고, 이 함수엔 Fluid compute 최대치인
// 800초를 준다 — 스트리밍이라 연결이 안 끊기고, 두 브랜드는 병렬이라 벽시계는
// 브랜드 1개(웹서치 최대 560초 + 폴백)라 800초 안에 안전하게 끝난다.
export const maxDuration = 800

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Vercel Cron이 매주 월요일 09:00 KST(월 00:00 UTC)에 호출한다 — vercel.json 참고.
// (원래 매월 1회였는데, 라이터·리믹서가 이 결과를 공유해 쓰는 구조라 자료가
// 신선할수록 좋아서 주 1회로 늘렸다 — 대표님 결정.) 사용자가 매번 주제를
// 입력하는 수동 리서치와 달리, 자동 실행은 주제가 없으므로 "이번 주 트렌드"
// 기본 주제로 돌아서 매주 놓치지 않고 시장을 한 번씩 훑는다.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  if (haltIfPaused(res)) return
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  // 브랜드별로 순차 실행하면(웹서치 포함 Claude 호출 2번) 300초 크론 제한을
  // 넘겨서 타임아웃이 났다(실제로 겪은 문제) — 브랜드끼리는 서로 의존관계가
  // 없으므로 병렬로 돌려서 전체 시간을 절반 가까이 줄인다.
  const results = await Promise.all(
    BRANDS.map(async (brand) => {
      const topic = `이번 주 ${brand} 콘텐츠 트렌드 및 벤치마킹`
      // researchMarketResilient는 어떤 경우에도 예외를 던지지 않는다(웹서치 실패 시
      // 검색 없이 재시도 → 그래도 안 되면 빈 리포트). 그래도 저장(supabase) 단계가
      // 혹시 던질 수 있으니 바깥 try/catch는 안전망으로 남겨둔다.
      try {
        let costUsd = 0
        const research = await researchMarketResilient({
          apiKey,
          topic,
          context: `[브랜드]\n${BRAND_CONTEXT[brand]}\n운영 채널: ${BRAND_CHANNELS[brand].join(', ')}`,
          focus: BRAND_RESEARCH_FOCUS[brand],
          onUsage: (usage) => {
            costUsd += estimateCostUsd(usage)
          },
        })
        const report = research.report
        const nowIso = new Date().toISOString()
        const hasFindings = report.findings.length > 0

        await supabaseInsert('work_log', {
          id: makeId(),
          agent: 'brain',
          brand,
          kind: '주간 리서치(자동)',
          // 하드 에러가 아니라, 결과가 없으면 '보류'로만 표시한다 — 대표님이
          // 아침에 빨간 "오류"를 보지 않게(브레인 무중단 원칙).
          status: research.ok && hasFindings ? 'done' : 'attention',
          status_label: research.ok && hasFindings ? '완료' : '보류',
          started_at: nowIso,
          ended_at: nowIso,
          cost_usd: costUsd,
          // 웹서치로 됐는지(✅웹검색) 검색 실패로 지식기반 폴백인지(⚠️검색실패)
          // note에 명시 — 200만 봐서는 구분이 안 됐던 문제 해결.
          note: research.ok
            ? `발견 ${report.findings.length}건 · ${research.usedWebSearch ? '✅웹검색' : '⚠️검색실패→지식기반'}`
            : research.note,
          detail_html: hasFindings
            ? `<b>발견 사항</b><br/>${report.findings
                .map((f) => `- [${f.source}] ${f.insight}`)
                .join('<br/>')}<br/><br/><b>요약</b><br/>${report.summary}`
            : research.note,
        })
        // 라이터/버즈/리믹서가 다시 찾아 쓸 수 있게 구조화해서도 저장한다.
        // 결과가 있을 때만 저장 — 빈 리포트로 덮으면 직전에 잘 찾아둔 자료가
        // 사라지므로, 실패한 주기에는 저장하지 않고 이전 자료를 그대로 둔다.
        if (research.ok && hasFindings) {
          await supabaseInsert('brain_reports', {
            id: makeId(),
            brand,
            topic,
            findings: report.findings,
            summary: report.summary,
            recommendations: report.recommendations,
            created_at: nowIso,
          })
        }
        return `${brand}: ${
          research.ok
            ? `발견 ${report.findings.length}건 · ${research.usedWebSearch ? '✅웹검색됨' : '⚠️검색실패→지식기반'}`
            : '일시 실패(다음 주기 재시도)'
        }`
      } catch (err) {
        // 저장 단계 등에서의 예외 안전망 — 여기서도 500을 던지지 않고 문자열만 남긴다.
        return `${brand}: 저장 실패 (${err instanceof Error ? err.message : String(err)})`
      }
    }),
  )

  sendJson(res, 200, { ok: true, results })
}

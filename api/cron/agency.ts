import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateAgencyDraftBatch, digestReferenceStyle } from '../../src/agents/runAgencyThread.js'
import { runThreadReviewBatch } from '../../src/agents/runThreadReview.js'
import { PASS_THRESHOLD } from '../../src/types/domain.js'
import type { VisionImageInput } from '../../src/lib/claude.js'
import type { DraftAttempt } from '../../src/types/agency.js'
import type { ThreadDraft, ThreadReview } from '../../src/types/thread.js'
import { REVIEW_FAILED_NOTE } from '../../src/agents/blogRuleCheck.js'
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../_lib/supabaseAdmin.js'
import { fetchHookReferenceBlock } from '../_lib/sheetHooks.js'
import { requireCronAuth, haltIfPaused, sendJson, sendText } from '../_lib/cronHandler.js'
import { kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'

const DRAFT_COUNT = 3
// 함수 한도 300초 — 생성 재시도·채점·저장까지 이 안에서 끝낸다.
const CRON_BUDGET_MS = 280_000
const MAX_RECENT_DRAFTS = 30

interface AgencyClientRow {
  id: string
  name: string
  business: string
  persona: string
  memo: string
  status: string
  guidance: string | null
  recent_draft_texts: string[]
  reference_image_ids: string[]
  style_digest: string | null
}

interface ReferenceImageRow {
  id: string
  image_base64: string
  media_type: 'image/png' | 'image/jpeg' | 'image/webp'
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildDraftsHtml(attempts: DraftAttempt[], reviewed: boolean): string {
  const head = reviewed
    ? ''
    : '<b>⚠️ 채점만 실패했어요 — 시안 자체는 정상입니다. 읽어 보시고 괜찮으면 승인하시면 돼요.</b><br/><br/>'
  return (
    head +
    attempts
      .map((a, i) => `<b>${i + 1}. ${reviewed ? `${a.review.totalScore}점` : '채점 없음'}</b><br/>${a.draft.text.replace(/\n/g, '<br/>')}`)
      .join('<br/><br/>')
  )
}

async function fetchReferenceImages(ids: string[]): Promise<VisionImageInput[]> {
  if (ids.length === 0) return []
  const filter = ids.map((id) => `"${id}"`).join(',')
  const rows = await supabaseSelect<ReferenceImageRow>(
    'reference_images',
    `id=in.(${filter})&select=id,image_base64,media_type`,
  )
  return rows.map((r) => ({ imageBase64: r.image_base64, imageMediaType: r.media_type }))
}

// 매일 07:30 KST(모닝 크론 전)에 돌아서, 진행 중인(일시중단 아닌) 대행
// 클라이언트마다 사람이 대시보드에서 "오늘 초안 생성"을 누른 것과
// 완전히 동일한 결과물(초안 N개 + 채점 + 결재함/캘린더 등록)을 자동으로 만든다.
// 레퍼런스 이미지가 등록된 클라이언트는 그 스타일을 참고해서 쓴다.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  if (haltIfPaused(res)) return
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  const clients = await supabaseSelect<AgencyClientRow>(
    'agency_clients',
    'status=eq.active&select=id,name,business,persona,memo,status,guidance,recent_draft_texts,reference_image_ids,style_digest',
  )

  const kstDate = kstDateKey(kstNow())
  // 구글시트에서 동기화된 "터진 후킹·CTA" 레퍼런스 — 클라이언트마다 동일하게
  // 참고(구조만 가져와 각 클라이언트 주제로 치환). 한 번만 조회한다.
  // 대표님 요청: 대행은 후킹을 넉넉히 참고(50개 로테이션 — 며칠이면 전체 풀 활용).
  const hookReference = await fetchHookReferenceBlock(50)
  const results: string[] = []
  const cronDeadline = Date.now() + CRON_BUDGET_MS
  for (const client of clients) {
    try {
      // 클라이언트당 하루 1번만 생성한다(멱등). content-schedule과 같은 방식으로
      // 오늘 이미 이 클라이언트의 대행 자동 시안 work_log가 있으면 건너뛴다 —
      // 크론이 두 번 돌거나(예약+수동 Run) 하면 결재함에 같은 대행 초안이
      // 2배로 중복되던 문제를 막는다.
      const kind = `대행 — ${client.name} (자동)`
      const attempted = await supabaseSelect<{ id: string }>(
        'work_log',
        `agent=eq.buzz&brand=eq.${encodeURIComponent('마잘남')}` +
          `&kind=eq.${encodeURIComponent(kind)}` +
          `&started_at=gte.${kstDate}T00:00:00%2B09:00&select=id&limit=1`,
      )
      if (attempted.length > 0) {
        results.push(`${client.name}: 오늘 이미 생성함 — 건너뜀`)
        continue
      }
      const recentPosts = client.recent_draft_texts ?? []
      // 레퍼런스 이미지는 "딱 1번"만 읽어 텍스트 스타일 요약으로 저장하고, 이후엔
      // 그 요약만 참고한다 — 이미지를 매일 다시 읽던 비전 토큰 낭비 제거(비용 95%+ 절감).
      // 요약이 아직 없고 이미지가 있으면 지금 1회 생성해 style_digest에 저장(자가 치유).
      let styleDigest = client.style_digest ?? undefined
      if (!styleDigest && (client.reference_image_ids?.length ?? 0) > 0) {
        try {
          // 이미지가 수십 장이어도 digestReferenceStyle이 12장씩 나눠 전부 읽어 합친다.
          const images = await fetchReferenceImages(client.reference_image_ids)
          styleDigest = await digestReferenceStyle({ apiKey, referenceImages: images })
          if (styleDigest) {
            // 기존 행의 일부 컬럼만 갱신 — upsert가 아니라 PATCH(UPDATE)로.
            await supabaseUpdate('agency_clients', `id=eq.${encodeURIComponent(client.id)}`, {
              style_digest: styleDigest,
            })
          }
        } catch {
          // 요약 실패해도 생성은 계속 — 클라이언트 정보만으로 작성.
        }
      }
      // 초안 N개를 한 번에 생성 + 채점도 한 번에(비용 절감). 프롬프트는 대행 전용
      // ("마잘남 – 글쓰기")으로 화면(AgencyScreen)과 동일. 이미지 대신 스타일 요약 참고.
      // 생성은 최대 2번(2차는 "JSON만" 강한 지시) — 1번 실패로 그날 시안이 통째로
      // 빠지지 않게. 뒤의 채점·저장 몫(40초)은 남긴다.
      let drafts: ThreadDraft[] | undefined
      let genErr: unknown = new Error('시안을 만들 시간이 부족했습니다.')
      for (const strict of [false, true]) {
        const left = cronDeadline - Date.now() - 40_000
        if (left < 45_000) break
        try {
          drafts = await generateAgencyDraftBatch({
            apiKey,
            topic: `${client.business} 관련 스레드 게시물`,
            business: client.business,
            persona: client.persona,
            count: DRAFT_COUNT,
            recentPosts,
            styleDigest,
            guidance: client.guidance ?? undefined,
            hookReference,
            timeoutMs: Math.min(200_000, left),
            strict,
          })
          break
        } catch (err) {
          genErr = err
        }
      }
      if (!drafts) throw genErr
      // 채점이 실패해도 시안은 버리지 않는다 — 예전엔 채점 오류가 클라이언트 전체를
      // 실패로 만들어, 다 만든 시안이 결재함에 안 올라갔다. 채점 없이 올리고 표시만.
      let reviewed = true
      let reviews: ThreadReview[]
      try {
        reviews = await runThreadReviewBatch({ apiKey, drafts })
      } catch (err) {
        console.warn('[agency] 채점 실패 — 시안은 저장:', err instanceof Error ? err.message : String(err))
        reviewed = false
        reviews = drafts.map(() => ({ totalScore: 0, summary: REVIEW_FAILED_NOTE, criteriaScores: [], flags: [] }))
      }
      const attempts: DraftAttempt[] = drafts.map((draft, i) => ({ draft, review: reviews[i] }))

      const passCount = attempts.filter((a) => a.review.totalScore >= PASS_THRESHOLD).length
      const scoreSummary = reviewed ? `${passCount}/${DRAFT_COUNT}건 통과` : `채점 없음 · 시안 ${attempts.length}건 정상`
      const nowIso = new Date().toISOString()
      const today = nowIso.slice(0, 10)
      const logId = makeId()

      // generateThreadDraft/runThreadReview는 사람이 쓰는 브라우저 경로와 공유하는
      // 순수 함수라 usage를 밖으로 안 넘긴다(budgetGuard의 localStorage 예산 기록만
      // 내부에서 시도하고 서버에선 조용히 no-op) — 자동 생성분은 비용을 따로 집계하지
      // 않는다(cost_usd 비워둠). 실제 API 비용 자체는 그대로 Anthropic 콘솔에서 확인 가능.
      await supabaseInsert('work_log', {
        id: logId,
        agent: 'buzz',
        brand: '마잘남',
        kind,
        status: 'done',
        status_label: '완료',
        started_at: nowIso,
        ended_at: nowIso,
        note: `${scoreSummary} (자동 생성)`,
        detail_html: `<b>${client.name} 오늘 초안 ${DRAFT_COUNT}건 (자동)</b><br/>${attempts
          .map((a, i) => `${i + 1}. ${reviewed ? `${a.review.totalScore}점` : '채점 없음'}`)
          .join(' · ')}`,
      })

      const title = `${client.name} — 오늘 초안 ${DRAFT_COUNT}건 (자동)`
      const contentHtml = buildDraftsHtml(attempts, reviewed)
      await supabaseInsert('approval_queue', {
        id: makeId(),
        agent: 'buzz',
        brand: '마잘남',
        title,
        content_html: contentHtml,
        passed: passCount > 0,
        score_label: scoreSummary,
        created_at: nowIso,
        status: 'pending',
        source_work_log_id: logId,
      })

      await supabaseInsert('calendar_entries', {
        id: makeId(),
        date: today,
        brand: '마잘남',
        channel: 'agency',
        title,
        status: passCount > 0 ? 'planned' : 'open',
        note: `${scoreSummary} (자동 생성)`,
        content_html: contentHtml,
        created_at: nowIso,
        source_work_log_id: logId,
      })

      // 기존 클라이언트 행의 일부 컬럼만 갱신 — upsert로 부분 레코드를 보내면
      // NOT NULL(name·status 등) 위반이 날 수 있어 PATCH(UPDATE)로 처리한다.
      await supabaseUpdate('agency_clients', `id=eq.${encodeURIComponent(client.id)}`, {
        today_drafts: attempts,
        today_drafts_date: today,
        recent_draft_texts: [...attempts.map((a) => a.draft.text), ...recentPosts].slice(
          0,
          MAX_RECENT_DRAFTS,
        ),
      })

      results.push(`${client.name}: ${scoreSummary}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push(`${client.name}: 실패 (${msg})`)
      // 예전엔 실패가 크론 응답에만 남아 대표님이 알 수 없었다 — 팀채팅에 보이게 기록.
      try {
        const nowIso = new Date().toISOString()
        await supabaseInsert('work_log', {
          id: makeId(),
          agent: 'buzz',
          brand: '마잘남',
          kind: `대행 — ${client.name} (자동)`,
          status: 'error',
          status_label: '오류',
          started_at: nowIso,
          ended_at: nowIso,
          note: '대행 자동 시안 실패',
          detail_html: `${client.name} 자동 시안을 2번 시도했지만 실패했어요: ${msg}<br/>대행 탭에서 "오늘 초안 생성"을 누르면 다시 만들 수 있어요.`,
        })
      } catch {
        // 기록 실패는 무시.
      }
    }
  }

  sendJson(res, 200, { ok: true, results })
}

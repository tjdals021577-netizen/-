import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateAgencyDraftBatch, digestReferenceStyle } from '../../src/agents/runAgencyThread.js'
import { runThreadReviewBatch } from '../../src/agents/runThreadReview.js'
import { PASS_THRESHOLD } from '../../src/types/domain.js'
import type { VisionImageInput } from '../../src/lib/claude.js'
import type { DraftAttempt } from '../../src/types/agency.js'
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../_lib/supabaseAdmin.js'
import { fetchHookReferenceBlock } from '../_lib/sheetHooks.js'
import { requireCronAuth, sendJson, sendText } from '../_lib/cronHandler.js'
import { kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'

const DRAFT_COUNT = 3
const MAX_RECENT_DRAFTS = 30

interface AgencyClientRow {
  id: string
  name: string
  business: string
  persona: string
  memo: string
  status: string
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

function buildDraftsHtml(attempts: DraftAttempt[]): string {
  return attempts
    .map((a, i) => `<b>${i + 1}. ${a.review.totalScore}점</b><br/>${a.draft.text.replace(/\n/g, '<br/>')}`)
    .join('<br/><br/>')
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
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  const clients = await supabaseSelect<AgencyClientRow>(
    'agency_clients',
    'status=eq.active&select=id,name,business,persona,memo,status,recent_draft_texts,reference_image_ids,style_digest',
  )

  const kstDate = kstDateKey(kstNow())
  // 구글시트에서 동기화된 "터진 후킹·CTA" 레퍼런스 — 클라이언트마다 동일하게
  // 참고(구조만 가져와 각 클라이언트 주제로 치환). 한 번만 조회한다.
  // 대표님 요청: 대행은 후킹을 넉넉히 참고(50개 로테이션 — 며칠이면 전체 풀 활용).
  const hookReference = await fetchHookReferenceBlock(50)
  const results: string[] = []
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
      const drafts = await generateAgencyDraftBatch({
        apiKey,
        topic: `${client.business} 관련 스레드 게시물`,
        business: client.business,
        persona: client.persona,
        count: DRAFT_COUNT,
        recentPosts,
        styleDigest,
        hookReference,
      })
      const reviews = await runThreadReviewBatch({ apiKey, drafts })
      const attempts: DraftAttempt[] = drafts.map((draft, i) => ({ draft, review: reviews[i] }))

      const passCount = attempts.filter((a) => a.review.totalScore >= PASS_THRESHOLD).length
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
        note: `${passCount}/${DRAFT_COUNT}건 통과 (자동 생성)`,
        detail_html: `<b>${client.name} 오늘 초안 ${DRAFT_COUNT}건 (자동)</b><br/>${attempts
          .map((a, i) => `${i + 1}. ${a.review.totalScore}점`)
          .join(' · ')}`,
      })

      const title = `${client.name} — 오늘 초안 ${DRAFT_COUNT}건 (자동)`
      const contentHtml = buildDraftsHtml(attempts)
      await supabaseInsert('approval_queue', {
        id: makeId(),
        agent: 'buzz',
        brand: '마잘남',
        title,
        content_html: contentHtml,
        passed: passCount > 0,
        score_label: `${passCount}/${DRAFT_COUNT}건 통과`,
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
        note: `${passCount}/${DRAFT_COUNT}건 통과 (자동 생성)`,
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

      results.push(`${client.name}: ${passCount}/${DRAFT_COUNT}건 통과`)
    } catch (err) {
      results.push(`${client.name}: 실패 (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  sendJson(res, 200, { ok: true, results })
}

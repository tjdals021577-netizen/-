import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateAgencyDraftBatch } from '../../src/agents/runAgencyThread.js'
import { runThreadReviewBatch } from '../../src/agents/runThreadReview.js'
import { PASS_THRESHOLD } from '../../src/types/domain.js'
import type { VisionImageInput } from '../../src/lib/claude.js'
import type { DraftAttempt } from '../../src/types/agency.js'
import { supabaseSelect, supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, sendJson, sendText } from '../_lib/cronHandler.js'

const DRAFT_COUNT = 5
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
// 클라이언트마다 사람이 대시보드에서 "오늘 초안 5개 생성"을 누른 것과
// 완전히 동일한 결과물(초안 5개 + 채점 + 결재함/캘린더 등록)을 자동으로 만든다.
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
    'status=eq.active&select=id,name,business,persona,memo,status,recent_draft_texts,reference_image_ids',
  )

  const results: string[] = []
  for (const client of clients) {
    try {
      const referenceImages = await fetchReferenceImages(client.reference_image_ids ?? [])
      const recentPosts = client.recent_draft_texts ?? []
      // 초안 5개를 한 번에 생성 + 채점도 한 번에 — 예전엔 클라이언트당 API를
      // 10번(생성5+채점5) 불러서 시스템 프롬프트·레퍼런스 이미지 토큰이 매번
      // 반복 과금됐다. 2번으로 줄여 비용 ~75% 절감(대표님 결정). 프롬프트도
      // 대행 전용("마잘남 – 글쓰기")으로 통일 — 화면(AgencyScreen)과 동일.
      const drafts = await generateAgencyDraftBatch({
        apiKey,
        topic: `${client.business} 관련 스레드 게시물`,
        business: client.business,
        persona: client.persona,
        count: DRAFT_COUNT,
        recentPosts,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
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
        kind: `대행 — ${client.name} (자동)`,
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

      await supabaseInsert('agency_clients', {
        id: client.id,
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

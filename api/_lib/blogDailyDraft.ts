// 블로그 1단계(매일 자동, 대표님 결정 A): 오늘 주제로 키워드 → 깊게 쓰기 → 자동 수정까지 하고 결재함·
// 근무기록·캘린더에 "채점 대기"로 올린다. 채점·고쳐 쓰기는 2단계(majalnamBlogPolish)가 따로 한다.
// 마잘남(content-schedule, 06시대)과 업메리(api/cron/[task].ts, 04시대)가 같이 쓴다.
import { runMajalnamBlogPipeline, buildMajalnamBlogHtml } from './majalnamBlogPipeline.js'
import { supabaseInsert, supabaseSelect } from './supabaseAdmin.js'
import { getBlogBrandConfig } from '../../src/agents/blogBrandConfig.js'
import { makeDefaultChecklist } from '../../src/types/calendar.js'
import { kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'
import type { Brand } from '../../src/types/brand.js'
import {
  pickUpmeryTopic,
  planFromKey,
  UPMERY_TOPIC_KIND_LABEL,
  usedReviewIdsFromNotes,
  type UpmeryDailyTopic,
} from '../../src/agents/upmeryTopicBank.js'

const KIND = '주간 스케줄 자동 기획'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 매일 하나씩 도는 주제(브랜드 설정의 주제 목록, 날짜 기준 순환 — 예전 content-schedule과 같은 계산).
export function todaysTopic(brand: Brand): string {
  const topics = getBlogBrandConfig(brand).topics
  return topics[Math.floor(Date.now() / 86_400_000) % topics.length]
}

async function todaysPhotoCount(date: string, brand: Brand): Promise<number> {
  try {
    const rows = await supabaseSelect<{ id: string }>(
      'content_photos',
      `date=eq.${date}&brand=eq.${encodeURIComponent(brand)}&channel=eq.blog&select=id`,
    )
    return rows.length
  } catch {
    return 0
  }
}

// 업메리 후기 사례글로 이미 쓴 후기 ID — 근무기록 메모의 "후기 r001" 표시로 센다(다듬기 단계도 같은 표시를 남김).
async function usedUpmeryReviewIds(): Promise<Set<string>> {
  try {
    const rows = await supabaseSelect<{ note: string | null }>(
      'work_log',
      `agent=eq.writer&brand=eq.${encodeURIComponent('업메리')}&note=like.${encodeURIComponent('*후기 r*')}&select=note&limit=1000`,
    )
    return usedReviewIdsFromNotes(rows.map((r) => r.note ?? ''))
  } catch {
    return new Set()
  }
}

export async function runDailyBlogDraft(apiKey: string, brand: Brand, date: string): Promise<string> {
  // 업메리는 주제 은행(후기 사례글 주 4 · 질문 · 정보 · 대표 이야기)에서, 마잘남은 기존 주제 순환에서.
  const plan: UpmeryDailyTopic | null = brand === '업메리' ? pickUpmeryTopic(date, await usedUpmeryReviewIds()) : null
  return (await runBlogDraftWithPlan({ apiKey, brand, date, plan, kind: KIND })).message
}

// 블로그 탭 "주제 목록"에서 대표님이 고른 주제로 1단계(깊게 쓰기)를 바로 실행 — api/dispatch.ts가 부른다(2026-10-25).
// 다듬기(2단계)는 화면이 이어서 api/dispatch.ts(action 'upmery-blog-polish')로 같은 결재함 항목을 넘겨 실행한다.
export async function runUpmeryBlogForTopic(apiKey: string, topicKey: string): Promise<{ message: string; approvalId: string }> {
  const plan = planFromKey(topicKey)
  if (!plan) throw new Error('알 수 없는 주제예요. 주제 목록을 새로고침해 주세요.')
  return runBlogDraftWithPlan({ apiKey, brand: '업메리', date: kstDateKey(kstNow()), plan, kind: '주제 목록 요청' })
}

async function runBlogDraftWithPlan(p: {
  apiKey: string
  brand: Brand
  date: string
  plan: UpmeryDailyTopic | null
  kind: string
}): Promise<{ message: string; approvalId: string }> {
  const { apiKey, brand, date, plan } = p
  const topic = plan?.topic ?? todaysTopic(brand)
  const photoCount = await todaysPhotoCount(date, brand)
  const reviewImages = plan?.review?.images ?? []
  const reviewPhoto = plan?.review
    ? reviewImages.length > 0
      ? `후기 캡처 ${reviewImages.length}장(${reviewImages.map((i) => i.alt).join(' / ')}) — 수강생이 한 말을 인용한 바로 옆에 "[📸 첨부 사진: 후기 캡처]"로 배치(이름·연락처는 이미 가려 둠). 나머지 사진 추천은 평소대로.`
      : `후기 캡처 원본은 대표님이 갖고 있음 — 수강생이 한 말을 인용한 바로 옆에 "[📸 첨부 사진: 후기 캡처 — 이름·프로필 가려서]"로 자리만 표시. 나머지 사진 추천은 평소대로.`
    : ''
  // 근무기록 메모에 남길 주제 표시 — 후기는 "후기 r002", 목록 주제는 "주제 qa:3"(주제 목록의 "썼음" 표시).
  const noteTag = plan?.review ? `후기 ${plan.review.id}` : plan && plan.kind !== 'custom' ? `주제 ${plan.key}` : undefined
  const result = await runMajalnamBlogPipeline({
    apiKey,
    brand,
    mode: 'draft',
    topic,
    date,
    keyContent: plan?.keyContent,
    mainKeyword: plan?.mainKeyword,
    // 대표님이 올린 사진은 설명이 없으니 장수만 알려주고 배치 위치만 표시하게 한다.
    photos:
      [
        reviewPhoto,
        photoCount > 0
          ? `대표님이 오늘 올린 사진 ${photoCount}장(설명 없음) — 사진 추천 지점 중 어울리는 곳에 "[📸 첨부 사진: 대표님 사진 N번]"으로 배치`
          : '',
      ]
        .filter(Boolean)
        .join('\n') || undefined,
    topicInfo: plan
      ? `${UPMERY_TOPIC_KIND_LABEL[plan.kind]}${plan.review ? ` (후기 ${plan.review.id})` : ''}${plan.note ? ` — ${plan.note}` : ''}`
      : undefined,
    reviewId: plan?.review?.id,
    noteTag,
    attachments: reviewImages.length > 0 ? reviewImages : undefined,
  })
  const { draft, keyword } = result
  const scoreNote = '1단계(깊게 쓰기) 완료 — 채점·다듬기 예정'
  const html = buildMajalnamBlogHtml(result)
  const kwNote = `키워드 "${keyword.mainKeyword}" ${keyword.readerStage}`
  const nowIso = new Date().toISOString()
  const logId = makeId()

  await supabaseInsert('work_log', {
    id: logId,
    agent: 'writer',
    brand,
    kind: p.kind,
    status: 'done',
    status_label: '완료',
    started_at: nowIso,
    ended_at: nowIso,
    note: `${scoreNote} · ${kwNote} · 사진 ${photoCount}장${plan ? ` · ${UPMERY_TOPIC_KIND_LABEL[plan.kind]}` : ''}${noteTag ? ` · ${noteTag}` : ''}`,
    detail_html: html,
  })
  const approvalId = makeId()
  await supabaseInsert('approval_queue', {
    id: approvalId,
    agent: 'writer',
    brand,
    title: draft.title,
    content_html: html,
    passed: false,
    score_label: '채점 대기',
    created_at: nowIso,
    status: 'pending',
    source_work_log_id: logId,
  })
  await supabaseInsert('calendar_entries', {
    id: makeId(),
    date,
    brand,
    channel: 'blog',
    title: draft.title,
    status: 'open',
    note: `${scoreNote} (${p.kind === KIND ? '자동 기획' : '주제 목록 요청'}) · ${kwNote} · 발행 전 [경험 삽입] 채우기`,
    content_html: html,
    checklist: makeDefaultChecklist(true),
    created_at: nowIso,
    source_work_log_id: logId,
  })
  return { message: `${brand} 블로그: ${scoreNote} · ${kwNote}`, approvalId }
}

// 크론용 — 하루 1번만(성공·실패 상관없이 오늘 기록이 있으면 건너뜀), 실패하면 근무기록에 남긴다
// (content-schedule과 같은 규칙).
export async function runDailyBlogDraftOnce(apiKey: string, brand: Brand): Promise<string> {
  const date = kstDateKey(kstNow())
  const attempted = await supabaseSelect<{ id: string }>(
    'work_log',
    `agent=eq.writer&brand=eq.${encodeURIComponent(brand)}&kind=eq.${encodeURIComponent(KIND)}` +
      `&started_at=gte.${date}T00:00:00%2B09:00&select=id&limit=1`,
  )
  if (attempted.length > 0) return `${brand} 블로그: 오늘 이미 시도함 — 건너뜀`
  try {
    return await runDailyBlogDraft(apiKey, brand, date)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabaseInsert('work_log', {
      id: makeId(),
      agent: 'writer',
      brand,
      kind: KIND,
      status: 'error',
      status_label: '오류',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      note: '자동 생성 실패',
      detail_html: message,
    }).catch(() => undefined)
    return `${brand} 블로그: 실패 (${message})`
  }
}

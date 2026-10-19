// 블로그 1단계(매일 자동, 대표님 결정 A): 오늘 주제로 키워드 → 깊게 쓰기 → 자동 수정까지 하고 결재함·
// 근무기록·캘린더에 "채점 대기"로 올린다. 채점·고쳐 쓰기는 2단계(majalnamBlogPolish)가 따로 한다.
// 마잘남(content-schedule, 06시대)과 업메리(api/cron/[task].ts, 04시대)가 같이 쓴다.
import { runMajalnamBlogPipeline, buildMajalnamBlogHtml } from './majalnamBlogPipeline.js'
import { supabaseInsert, supabaseSelect } from './supabaseAdmin.js'
import { getBlogBrandConfig } from '../../src/agents/blogBrandConfig.js'
import { makeDefaultChecklist } from '../../src/types/calendar.js'
import { kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'
import type { Brand } from '../../src/types/brand.js'

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

export async function runDailyBlogDraft(apiKey: string, brand: Brand, date: string): Promise<string> {
  const topic = todaysTopic(brand)
  const photoCount = await todaysPhotoCount(date, brand)
  const result = await runMajalnamBlogPipeline({
    apiKey,
    brand,
    mode: 'draft',
    topic,
    date,
    // 대표님이 올린 사진은 설명이 없으니 장수만 알려주고 배치 위치만 표시하게 한다.
    photos:
      photoCount > 0
        ? `대표님이 오늘 올린 사진 ${photoCount}장(설명 없음) — 사진 추천 지점 중 어울리는 곳에 "[📸 첨부 사진: 대표님 사진 N번]"으로 배치`
        : undefined,
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
    kind: KIND,
    status: 'done',
    status_label: '완료',
    started_at: nowIso,
    ended_at: nowIso,
    note: `${scoreNote} · ${kwNote} · 사진 ${photoCount}장`,
    detail_html: html,
  })
  await supabaseInsert('approval_queue', {
    id: makeId(),
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
    note: `${scoreNote} (자동 기획) · ${kwNote} · 발행 전 [경험 삽입] 채우기`,
    content_html: html,
    checklist: makeDefaultChecklist(true),
    created_at: nowIso,
    source_work_log_id: logId,
  })
  return `${brand} 블로그: ${scoreNote} · ${kwNote}`
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

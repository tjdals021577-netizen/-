// 06:30 2단계(대표님 결정 A — 두 번에 나눠 실행): 06:00 content-schedule이 깊게 써서 올린 마잘남
// 블로그 초안을 찾아 채점 → 85점 미만이면 채점 지적대로 고쳐 쓰기 → 재채점하고, 결재함·근무기록·
// 캘린더의 "같은 항목"을 업데이트한다. 서버 함수가 12개 한도라 새 함수를 만들지 않고 hooks 크론
// (06:30으로 이동) 안에서 실행된다.
import { supabaseSelect, supabaseUpdate } from './supabaseAdmin.js'
import { buildMajalnamBlogHtml, decodeBlogState, polishMajalnamBlog, type MajalnamBlogResult } from './majalnamBlogPipeline.js'
import { kstNow, kstDateKey } from '../../src/lib/weeklySchedule.js'
import { PASS_THRESHOLD } from '../../src/types/domain.js'
import { REVIEW_FAILED_LABEL } from '../../src/agents/blogRuleCheck.js'

interface ApprovalRow {
  id: string
  status: string
  content_html: string
  source_work_log_id: string | null
}

export async function runMajalnamBlogPolish(apiKey: string, deadline: number): Promise<string> {
  const today = kstDateKey(kstNow())
  const rows = await supabaseSelect<ApprovalRow>(
    'approval_queue',
    `brand=eq.${encodeURIComponent('마잘남')}&agent=eq.writer` +
      `&created_at=gte.${today}T00:00:00%2B09:00&order=created_at.desc&select=id,status,content_html,source_work_log_id`,
  )
  const target = rows.find((r) => r.status === 'pending' && r.content_html.includes('MJBLOG-STATE:'))
  if (!target) return '오늘 다듬을 1단계 초안 없음(이미 처리됐거나 06:00 글쓰기 실패)'
  const state = decodeBlogState(target.content_html)
  if (!state) return '1단계 초안 상태를 읽지 못함'

  let result: MajalnamBlogResult
  let failed = ''
  try {
    result = await polishMajalnamBlog({ apiKey, state, deadline })
  } catch (err) {
    // 실패해도 1단계 글은 그대로 살린다 — "채점만 실패, 글 정상"으로 표시하고 상태 표시는 지운다.
    failed = err instanceof Error ? err.message : String(err)
    result = { ...state, reviews: [], pendingPolish: false, autoFixes: [...state.autoFixes, '06:30 채점·다듬기 실패 — 06:00 글 그대로'] }
  }

  const reviewed = result.reviews.length > 0
  const avg = reviewed ? result.reviews.reduce((t, r) => t + r.totalScore, 0) / result.reviews.length : 0
  const passed = reviewed && avg >= PASS_THRESHOLD
  const scoreLabel = reviewed ? `${avg.toFixed(1)}/100` : REVIEW_FAILED_LABEL
  const html = buildMajalnamBlogHtml(result)
  const rewroteNote = result.autoFixes.find((f) => f.includes('자동 고쳐 쓰기')) ?? ''
  const note =
    `${reviewed ? `${avg.toFixed(1)}점 ${passed ? '통과' : '미달'}` : '채점 실패 — 글은 정상'}` +
    ` · 키워드 "${result.keyword.mainKeyword}" ${result.keyword.readerStage}` +
    (rewroteNote ? ` · ${rewroteNote}` : '')

  // 대표님이 그사이 승인·반려했으면 결재함은 건드리지 않는다(위 select에서 pending만 골랐지만 한 번 더).
  await supabaseUpdate('approval_queue', `id=eq.${encodeURIComponent(target.id)}&status=eq.pending`, {
    title: result.draft.title,
    content_html: html,
    passed,
    score_label: scoreLabel,
  })
  if (target.source_work_log_id) {
    const logFilter = encodeURIComponent(target.source_work_log_id)
    await supabaseUpdate('work_log', `id=eq.${logFilter}`, { note, detail_html: html }).catch(() => undefined)
    await supabaseUpdate('calendar_entries', `source_work_log_id=eq.${logFilter}`, {
      title: result.draft.title,
      content_html: html,
      status: passed ? 'planned' : 'open',
      note: `${note} (06:30 다듬기) · 발행 전 [경험 삽입] 채우기`,
    }).catch(() => undefined)
  }
  return failed ? `다듬기 실패(글은 유지): ${failed}` : note
}

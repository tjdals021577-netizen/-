// 여러 가벼운 크론을 함수 하나로 묶은 동적 경로(/api/cron/<task>) — Vercel Hobby 서버 함수 12개 한도 때문에
// (2026-10 업메리 블로그 자동화 추가). /api/cron/brain 같은 개별 파일이 있는 주소는 그 파일이 우선이고,
// 나머지 주소만 여기로 온다.
//   cleanup             — 매주 월 03시대: 오래된 블로그 사진 정리(예전 api/cron/cleanup.ts, 주소 그대로)
//   upmery-blog         — 매일 04시대: 업메리 블로그 1단계(키워드 → 깊게 쓰기 → 자동 수정 → 결재함 "채점 대기")
//   upmery-blog-polish  — 매일 07시대: 업메리 블로그 2단계(채점 → 미달이면 고쳐 쓰기 → 재채점 → 같은 글 업데이트)
//   ad-weekly           — 매주 월 09시대: 애드(업메리 광고 운영) 주간 분석 + 다음 행동 제안 + 광고 문구 → 결재함
//                         (광고 변경은 결재함 승인 때만 실행). 이번 주 리포트가 이미 있으면 건너뜀.
//   meta-capi           — 매일 07시대(레이더와 같은 시간대): 업메리 상담 신청(리드)의 신청·통화 완료·결제를
//                         메타 전환 API로 전송(아직 안 보낸 것만, 전화번호는 해시). 키·테이블 없으면 건너뜀.
// Hobby 크론은 "그 시간대 안 아무 때나" 실행되므로 1단계(04시대)와 2단계(07시대)는 시간대를 띄워 둔다.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { requireCronAuth, haltIfPaused, sendJson, sendText } from '../_lib/cronHandler.js'
import { runCleanup } from '../_lib/cleanupTask.js'
import { runDailyBlogDraftOnce } from '../_lib/blogDailyDraft.js'
import { runMajalnamBlogPolish } from '../_lib/majalnamBlogPolish.js'
import { sendLeadConversions } from '../_lib/leads.js'
import { runAdWeeklyOnce } from '../_lib/adAgent.js'

export const maxDuration = 300

// Vercel은 동적 경로 값을 쿼리(?task=)로 넘기기도 하고 원래 주소 그대로 두기도 해서 둘 다 본다.
function taskName(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return url.searchParams.get('task') || url.pathname.split('/').filter(Boolean).pop() || ''
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  if (haltIfPaused(res)) return
  const startedAt = Date.now()
  const task = taskName(req)

  if (task === 'cleanup') {
    sendJson(res, 200, await runCleanup())
    return
  }
  if (task === 'meta-capi') {
    let result: string
    try {
      result = await sendLeadConversions()
    } catch (err) {
      result = `메타 전환 전송 실패: ${err instanceof Error ? err.message : String(err)}`
    }
    sendJson(res, 200, { ok: true, task, result })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }
  if (task === 'ad-weekly') {
    sendJson(res, 200, { ok: true, task, result: await runAdWeeklyOnce(apiKey, startedAt) })
    return
  }
  if (task === 'upmery-blog') {
    sendJson(res, 200, { ok: true, task, result: await runDailyBlogDraftOnce(apiKey, '업메리') })
    return
  }
  if (task === 'upmery-blog-polish') {
    let result: string
    try {
      result = await runMajalnamBlogPolish(apiKey, startedAt + 280_000, '업메리')
    } catch (err) {
      result = `블로그 다듬기 실패: ${err instanceof Error ? err.message : String(err)}`
    }
    sendJson(res, 200, { ok: true, task, result })
    return
  }
  sendText(res, 404, `알 수 없는 작업: ${task}`)
}

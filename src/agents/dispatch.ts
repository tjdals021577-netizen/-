import { generateBlogDraft, runBlogAgentReview } from './runBlogReview'
import { generateThreadDraft, runThreadReview } from './runThreadReview'
import { generateRemixPlan } from './runRemix'
import { researchMarket } from './runBrain'
import { startWorkLog, finishWorkLog } from '../lib/workLog'
import { getTodaySpendUsd } from '../lib/budgetGuard'
import { PASS_THRESHOLD } from '../types/domain'
import type { BlogRole } from '../types/blog'

const BLOG_ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']

export type DispatchableAgent = 'writer' | 'buzz' | 'remix' | 'brain'

export const DISPATCHABLE_AGENTS: DispatchableAgent[] = ['writer', 'buzz', 'remix', 'brain']

// 팀 채팅의 "일 시키기"에서 호출하는 경량 실행기 — 각 컴포저의 내부 상태는
// 건드리지 않고, 같은 생성·채점 로직만 재사용해 근무기록에 결과를 남긴다.
export async function dispatchJob(params: {
  agent: DispatchableAgent
  apiKey: string
  instruction: string
}): Promise<void> {
  const { agent, apiKey, instruction } = params
  const topic = instruction.trim()
  const spendBefore = getTodaySpendUsd()
  const logId = startWorkLog({
    agent,
    kind: '수동 지시(팀 채팅)',
    note: topic,
  })

  try {
    if (agent === 'writer') {
      const draft = await generateBlogDraft({
        apiKey,
        topic,
        keyPoints: '',
        photoDescriptions: '',
      })
      const reviews = await Promise.all(
        BLOG_ROLES.map((role) => runBlogAgentReview({ apiKey, role, draft })),
      )
      const avg = reviews.reduce((s, r) => s + r.totalScore, 0) / reviews.length
      const passed = avg >= PASS_THRESHOLD
      finishWorkLog(logId, {
        status: passed ? 'done' : 'attention',
        statusLabel: passed ? '완료' : '보류',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: `${avg.toFixed(1)}점 ${passed ? '통과' : '미달'}`,
        detailHtml: `<b>${draft.title}</b><br/>운영실 &gt; 블로그 탭에서 전체 내용을 확인하세요.`,
      })
      return
    }

    if (agent === 'buzz') {
      const draft = await generateThreadDraft({ apiKey, topic })
      const review = await runThreadReview({ apiKey, draft })
      const passed = review.totalScore >= PASS_THRESHOLD
      finishWorkLog(logId, {
        status: passed ? 'done' : 'attention',
        statusLabel: passed ? '완료' : '보류',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: `${review.totalScore}점 ${passed ? '통과' : '미달'}`,
        detailHtml: `${draft.text.slice(0, 60)}${draft.text.length > 60 ? '…' : ''}`,
      })
      return
    }

    if (agent === 'remix') {
      const plan = await generateRemixPlan({ apiKey, topic, referenceText: '' })
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: `훅 후보 ${plan.hooks.length}개`,
        detailHtml: `<b>훅 후보</b><br/>${plan.hooks.map((h) => `- ${h}`).join('<br/>')}`,
      })
      return
    }

    // brain
    const report = await researchMarket({ apiKey, topic, context: '' })
    finishWorkLog(logId, {
      status: 'done',
      statusLabel: '완료',
      costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
      note: `발견 ${report.findings.length}건`,
      detailHtml: `<b>발견 사항</b><br/>${report.findings.map((f) => `- [${f.source}] ${f.insight}`).join('<br/>')}<br/><br/><b>요약</b><br/>${report.summary}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    finishWorkLog(logId, {
      status: 'error',
      statusLabel: '오류',
      note: '실행 실패',
      detailHtml: message,
    })
    throw err
  }
}

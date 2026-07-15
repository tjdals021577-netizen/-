import { generateBlogDraft, runBlogReviewsResilient } from './runBlogReview.js'
import type { BlogReview } from '../types/blog.js'
import { generateThreadDraft, runThreadReview } from './runThreadReview.js'
import { MAJALNAM_THREAD_VOICE } from './threadPrompts.js'
import { generateRemixPlan } from './runRemix.js'
import { researchMarket } from './runBrain.js'
import { startWorkLog, finishWorkLog } from '../lib/workLog.js'
import { getTodaySpendUsd } from '../lib/budgetGuard.js'
import { submitForApproval } from '../lib/approvalStore.js'
import { createEntry } from '../lib/calendarStore.js'
import { PASS_THRESHOLD } from '../types/domain.js'
import { BRAND_CONTEXT, BRAND_CHANNELS, type Brand } from '../types/brand.js'
import type { BlogRole } from '../types/blog.js'
import { getLatestBrainReport, formatBrainFindingsForPrompt, saveBrainReport } from '../lib/brainStore.js'

const BLOG_ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']

export type DispatchableAgent = 'writer' | 'buzz' | 'remix' | 'brain'

export const DISPATCHABLE_AGENTS: DispatchableAgent[] = ['writer', 'buzz', 'remix', 'brain']

// 팀 채팅의 "일 시키기"에서 호출하는 경량 실행기 — 각 컴포저의 내부 상태는
// 건드리지 않고, 같은 생성·채점 로직만 재사용해 근무기록에 결과를 남긴다.
export async function dispatchJob(params: {
  agent: DispatchableAgent
  brand: Brand
  apiKey: string
  instruction: string
}): Promise<void> {
  const { agent, brand, apiKey, instruction } = params
  const topic = instruction.trim()
  const today = new Date().toISOString().slice(0, 10)
  const marketFindings = formatBrainFindingsForPrompt(getLatestBrainReport(brand))
  const spendBefore = getTodaySpendUsd()
  const logId = startWorkLog({
    agent,
    brand,
    kind: '수동 지시(팀 채팅)',
    note: topic,
  })

  try {
    if (agent === 'writer') {
      let draft = await generateBlogDraft({
        apiKey,
        topic,
        keyPoints: '',
        photoDescriptions: '',
        brandContext: BRAND_CONTEXT[brand],
        marketFindings,
      })
      let reviews = await runBlogReviewsResilient({ apiKey, roles: BLOG_ROLES, draft })
      const scoreOf = (rs: BlogReview[]) =>
        rs.length > 0 ? rs.reduce((s, r) => s + r.totalScore, 0) / rs.length : 0

      // 첫 시도가 기준 미달이면, 심사위원 피드백을 반영해서 딱 한 번 다시
      // 쓴다(무한 루프 방지) — "미달인 채로 그냥 보류"만 반복돼서 발행할
      // 콘텐츠가 안 나오는 문제를 줄이기 위함. 재작성이 오히려 더 나쁘면
      // 첫 초안을 유지한다.
      if (reviews.length > 0 && scoreOf(reviews) < PASS_THRESHOLD) {
        try {
          const feedback = reviews
            .map((r) => `[${r.role}] ${r.summary}\n${r.flags.map((f) => `- ${f.reason}`).join('\n')}`)
            .join('\n\n')
          const revised = await generateBlogDraft({
            apiKey,
            topic,
            keyPoints: '',
            photoDescriptions: '',
            brandContext: BRAND_CONTEXT[brand],
            marketFindings,
            previousDraft: draft,
            feedback,
          })
          const revisedReviews = await runBlogReviewsResilient({ apiKey, roles: BLOG_ROLES, draft: revised })
          if (revisedReviews.length > 0 && scoreOf(revisedReviews) > scoreOf(reviews)) {
            draft = revised
            reviews = revisedReviews
          }
        } catch {
          // 재작성 실패 시 첫 초안 그대로 진행 — 재작성은 보너스지 필수가 아님
        }
      }

      const reviewed = reviews.length > 0
      const avg = scoreOf(reviews)
      const passed = reviewed && avg >= PASS_THRESHOLD
      const scoreNote = reviewed ? `${avg.toFixed(1)}점 ${passed ? '통과' : '미달'}` : '채점 실패 — 내용은 저장됨'
      finishWorkLog(logId, {
        status: passed ? 'done' : 'attention',
        statusLabel: passed ? '완료' : '보류',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: scoreNote,
        detailHtml: `<b>${draft.title}</b><br/>블로그 탭에서 전체 내용을 확인하세요.`,
      })
      const contentHtml = `${draft.body.replace(/\n/g, '<br/>')}${draft.photoPlacements.length > 0 ? `<br/><br/><b>사진 배치 제안</b><br/>${draft.photoPlacements.map((p) => `- ${p}`).join('<br/>')}` : ''}`
      submitForApproval({
        agent: 'writer',
        brand,
        title: draft.title,
        contentHtml,
        passed,
        scoreLabel: reviewed ? `${avg.toFixed(1)}/100` : '채점 실패',
        sourceWorkLogId: logId,
      })
      createEntry({
        date: today,
        brand,
        channel: 'blog',
        title: draft.title,
        status: passed ? 'planned' : 'open',
        note: scoreNote,
        contentHtml,
        sourceWorkLogId: logId,
      })
      return
    }

    if (agent === 'buzz') {
      if (!BRAND_CHANNELS[brand].includes('스레드')) {
        throw new Error(`${brand}는 스레드 채널을 운영하지 않습니다.`)
      }
      const draft = await generateThreadDraft({
        apiKey,
        topic,
        brandVoice: MAJALNAM_THREAD_VOICE,
        marketFindings,
      })
      const review = await runThreadReview({ apiKey, draft })
      const passed = review.totalScore >= PASS_THRESHOLD
      finishWorkLog(logId, {
        status: passed ? 'done' : 'attention',
        statusLabel: passed ? '완료' : '보류',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: `${review.totalScore}점 ${passed ? '통과' : '미달'}`,
        detailHtml: `${draft.text.slice(0, 60)}${draft.text.length > 60 ? '…' : ''}`,
      })
      const title = draft.text.slice(0, 40) + (draft.text.length > 40 ? '…' : '')
      const contentHtml = draft.text.replace(/\n/g, '<br/>')
      submitForApproval({
        agent: 'buzz',
        brand,
        title,
        contentHtml,
        passed,
        scoreLabel: `${review.totalScore}/100`,
        sourceWorkLogId: logId,
      })
      createEntry({
        date: today,
        brand,
        channel: 'thread',
        title,
        status: passed ? 'planned' : 'open',
        note: `${review.totalScore}점 ${passed ? '통과' : '미달'}`,
        contentHtml,
        sourceWorkLogId: logId,
      })
      return
    }

    if (agent === 'remix') {
      if (!BRAND_CHANNELS[brand].includes('유튜브')) {
        throw new Error(`${brand}는 유튜브 채널을 운영하지 않습니다.`)
      }
      const plan = await generateRemixPlan({
        apiKey,
        topic,
        referenceText: '',
        brandContext: BRAND_CONTEXT[brand],
        marketFindings,
      })
      finishWorkLog(logId, {
        status: 'done',
        statusLabel: '완료',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: `훅 후보 ${plan.hooks.length}개`,
        detailHtml: `<b>훅 후보</b><br/>${plan.hooks.map((h) => `- ${h}`).join('<br/>')}`,
      })
      const contentHtml = `<b>훅 후보</b><br/>${plan.hooks.map((h) => `- ${h}`).join('<br/>')}<br/><br/><b>대본 구성안</b><br/>${plan.outline.replace(/\n/g, '<br/>')}`
      submitForApproval({
        agent: 'remix',
        brand,
        title: topic,
        contentHtml,
        passed: true,
        scoreLabel: '채점 없음',
        sourceWorkLogId: logId,
      })
      createEntry({
        date: today,
        brand,
        channel: 'youtube',
        title: topic,
        status: 'planned',
        note: `훅 후보 ${plan.hooks.length}개`,
        contentHtml,
        sourceWorkLogId: logId,
      })
      return
    }

    // brain
    const report = await researchMarket({
      apiKey,
      topic,
      context: `[브랜드]\n${BRAND_CONTEXT[brand]}\n운영 채널: ${BRAND_CHANNELS[brand].join(', ')}`,
    })
    saveBrainReport({
      brand,
      topic,
      findings: report.findings,
      summary: report.summary,
      recommendations: report.recommendations,
    })
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

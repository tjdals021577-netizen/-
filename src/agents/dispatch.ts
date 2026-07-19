import { generateBlogDraft, runBlogReviewsResilient } from './runBlogReview.js'
import type { BlogReview } from '../types/blog.js'
import { generateThreadDraft, runThreadReview } from './runThreadReview.js'
import { MAJALNAM_THREAD_VOICE } from './threadPrompts.js'
import { generateScoredRemixPlan } from './runRemix.js'
import { researchMarketResilient } from './runBrain.js'
import { startWorkLog, finishWorkLog } from '../lib/workLog.js'
import { getTodaySpendUsd } from '../lib/budgetGuard.js'
import { submitForApproval } from '../lib/approvalStore.js'
import { createEntry } from '../lib/calendarStore.js'
import { setLastOutput } from '../lib/agentChatStore.js'
import { PASS_THRESHOLD, REWRITE_THRESHOLD } from '../types/domain.js'
import { BRAND_CONTEXT, BRAND_CHANNELS, BRAND_RESEARCH_FOCUS, type Brand } from '../types/brand.js'
import type { BlogRole } from '../types/blog.js'
import { getLatestBrainReport, formatBrainFindingsForPrompt, saveBrainReport } from '../lib/brainStore.js'
import { formatRecentFeedbackForPrompt } from '../lib/contentFeedbackStore.js'
import { ClaudeCancelledError } from '../lib/claude.js'
import { getReferenceHooks } from '../lib/hookStore.js'
import { formatHookReference } from './hookReference.js'

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
  // 대표님이 "방금 만든 거 이렇게 고쳐줘"라고 할 때, 직전 결과물을 넘겨 그걸
  // 수정보완하게 한다(처음부터 새로 쓰지 않음). chatDecide가 수정 요청으로
  // 판단했을 때만 채워진다.
  previousOutput?: { title: string; content: string }
}): Promise<void> {
  const { agent, brand, apiKey, instruction, previousOutput } = params
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
      const pastFeedback = formatRecentFeedbackForPrompt(brand, 'blog')
      let draft = await generateBlogDraft({
        apiKey,
        topic,
        keyPoints: '',
        photoDescriptions: '',
        brandContext: BRAND_CONTEXT[brand],
        marketFindings,
        pastFeedback,
        // 수정보완 요청이면 직전 글을 기반으로 고쳐 쓴다.
        previousDraft: previousOutput
          ? { title: previousOutput.title, body: previousOutput.content, photoPlacements: [] }
          : undefined,
        feedback: previousOutput ? topic : undefined,
      })
      let reviews = await runBlogReviewsResilient({ apiKey, roles: BLOG_ROLES, draft })
      const scoreOf = (rs: BlogReview[]) =>
        rs.length > 0 ? rs.reduce((s, r) => s + r.totalScore, 0) / rs.length : 0

      // 첫 시도가 기준 미달이면, 심사위원 피드백을 반영해서 딱 한 번 다시
      // 쓴다(무한 루프 방지) — "미달인 채로 그냥 보류"만 반복돼서 발행할
      // 콘텐츠가 안 나오는 문제를 줄이기 위함. 재작성이 오히려 더 나쁘면
      // 첫 초안을 유지한다.
      if (reviews.length > 0 && scoreOf(reviews) < REWRITE_THRESHOLD) {
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
      // 방금 만든 글을 기억해둔다 — 다음에 "이렇게 고쳐줘" 하면 이걸 수정보완한다.
      setLastOutput({ agent: 'writer', brand, title: draft.title, content: draft.body })
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
        // 대표님이 구글시트에 모은 터진 후킹·CTA 레퍼런스(구조만 참고).
        hookReference: formatHookReference(getReferenceHooks()),
        // 수정보완 요청이면 직전 스레드 글을 기반으로 고쳐 쓴다.
        previousDraft: previousOutput ? { text: previousOutput.content } : undefined,
        feedback: previousOutput ? topic : undefined,
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
      setLastOutput({ agent: 'buzz', brand, title, content: draft.text })
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
      const { plan, review } = await generateScoredRemixPlan({
        apiKey,
        topic,
        referenceText: '',
        brandContext: BRAND_CONTEXT[brand],
        marketFindings,
        pastFeedback: formatRecentFeedbackForPrompt(brand, 'youtube'),
        // 수정보완 요청이면 직전 기획안을 기반으로 고쳐 쓴다(제목·구성 전문을 넘김).
        revision: previousOutput
          ? {
              previousPlan: { title: previousOutput.title, outline: previousOutput.content, hooks: [], benchmarkNotes: [] },
              feedback: topic,
            }
          : undefined,
      })
      const videoTitle = plan.title || topic
      const passed = review.totalScore >= PASS_THRESHOLD
      const scoreNote = `${review.totalScore}점 ${passed ? '통과' : '미달'}`
      const titleLine = plan.title ? `<b>🎬 제목</b><br/>${plan.title}<br/><br/>` : ''
      finishWorkLog(logId, {
        status: passed ? 'done' : 'attention',
        statusLabel: passed ? '완료' : '보류',
        costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
        note: `${scoreNote} · ${videoTitle}`,
        detailHtml: `${titleLine}<b>채점</b> ${scoreNote}<br/>${review.summary}`,
      })
      const contentHtml = `${titleLine}<b>훅 후보</b><br/>${plan.hooks.map((h) => `- ${h}`).join('<br/>')}<br/><br/><b>대본 구성안</b><br/>${plan.outline.replace(/\n/g, '<br/>')}<br/><br/><b>채점</b> ${scoreNote} — ${review.summary}`
      // 방금 만든 기획을 기억해둔다(제목 + 훅 + 대본) — 다음 수정 요청 때 이걸 고친다.
      setLastOutput({
        agent: 'remix',
        brand,
        title: videoTitle,
        content: `제목: ${plan.title}\n훅: ${plan.hooks.join(' / ')}\n\n대본 구성:\n${plan.outline}`,
      })
      submitForApproval({
        agent: 'remix',
        brand,
        title: videoTitle,
        contentHtml,
        passed,
        scoreLabel: `${review.totalScore}/100`,
        sourceWorkLogId: logId,
      })
      createEntry({
        date: today,
        brand,
        channel: 'youtube',
        title: videoTitle,
        status: passed ? 'planned' : 'open',
        note: scoreNote,
        contentHtml,
        sourceWorkLogId: logId,
      })
      return
    }

    // brain — researchMarketResilient는 예외를 던지지 않고 항상 리포트를 돌려준다
    // (웹서치 실패 시 검색 없이 재시도 → 그래도 안 되면 빈 리포트 + ok:false).
    const research = await researchMarketResilient({
      apiKey,
      topic,
      context: `[브랜드]\n${BRAND_CONTEXT[brand]}\n운영 채널: ${BRAND_CHANNELS[brand].join(', ')}`,
      focus: BRAND_RESEARCH_FOCUS[brand],
    })
    const report = research.report
    const hasFindings = report.findings.length > 0
    // 결과가 있을 때만 저장 — 빈 리포트로 덮으면 직전에 잘 찾아둔 자료가 사라진다.
    if (research.ok && hasFindings) {
      saveBrainReport({
        brand,
        topic,
        findings: report.findings,
        summary: report.summary,
        recommendations: report.recommendations,
      })
    }
    finishWorkLog(logId, {
      status: research.ok && hasFindings ? 'done' : 'attention',
      statusLabel: research.ok && hasFindings ? '완료' : '보류',
      costUsd: Math.max(0, getTodaySpendUsd() - spendBefore),
      note: research.ok ? `발견 ${report.findings.length}건` : research.note,
      detailHtml: hasFindings
        ? `<b>발견 사항</b><br/>${report.findings.map((f) => `- [${f.source}] ${f.insight}`).join('<br/>')}<br/><br/><b>요약</b><br/>${report.summary}`
        : research.note,
    })
    // 여기서 자동으로 기획까지 이어가지 않는다(대표님 결정) — 브레인은 찾아서
    // 기억(저장)만 하고, 나중에 대표님이 대본 기획을 요청할 때 리믹서가 이
    // 저장된 자료를 자동으로 참고한다(dispatchJob 상단 marketFindings 주입).
    // 리서치할 때마다 기획까지 돌리면 토큰이 과하게 나가서 뺐다.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 취소는 "실패"가 아니다 — 근무기록에 '오류'가 아니라 '취소됨(보류)'으로 남긴다.
    const cancelled = err instanceof ClaudeCancelledError
    finishWorkLog(logId, {
      status: cancelled ? 'attention' : 'error',
      statusLabel: cancelled ? '취소됨' : '오류',
      note: cancelled ? '대표님이 취소함' : '실행 실패',
      detailHtml: cancelled ? '작업을 취소했습니다.' : message,
    })
    throw err
  }
}

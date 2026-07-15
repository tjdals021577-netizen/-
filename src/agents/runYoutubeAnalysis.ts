import { callClaudeJson } from '../lib/claude.js'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard.js'
import { buildYoutubeAnalysisSystemPrompt, buildYoutubeAnalysisUserPrompt } from './youtubePrompts.js'

export interface YoutubeAnalysis {
  summary: string
  findings: string[]
  nextSteps: string[]
}

function parseAnalysis(raw: unknown): YoutubeAnalysis {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('유튜브 분석 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  return {
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    findings: Array.isArray(rec.findings) ? rec.findings.filter((f): f is string => typeof f === 'string') : [],
    nextSteps: Array.isArray(rec.nextSteps) ? rec.nextSteps.filter((n): n is string => typeof n === 'string') : [],
  }
}

export async function analyzeYoutubeContent(params: {
  apiKey: string
  brandContext: string
  stats: { title: string; viewCount: number; likeCount: number; commentCount: number }[]
}): Promise<YoutubeAnalysis> {
  const { apiKey, brandContext, stats } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildYoutubeAnalysisSystemPrompt(brandContext),
    user: buildYoutubeAnalysisUserPrompt(stats),
    // 2048로는 영상 10개 분석 시 출력이 잘려서 JSON이 끝나기 전에 끊기고
    // "모델 응답에서 JSON을 찾지 못했습니다" 에러가 났다(실사용에서 확인).
    // 4096으로 늘리고, 프롬프트에서 findings·nextSteps 개수도 제한한다.
    maxTokens: 4096,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseAnalysis(raw)
}

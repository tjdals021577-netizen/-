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
    maxTokens: 2048,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseAnalysis(raw)
}

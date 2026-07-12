import { callClaudeJson } from '../lib/claude'
import { estimateCostUsd, recordSpendUsd } from '../lib/budgetGuard'
import { buildMorningSystemPrompt, buildMorningUserPrompt } from './morningPrompts'
import type { MorningBriefing } from '../types/morning'
import type { WorkLogEntry } from '../lib/workLog'

const AGENT_LABEL_KO: Record<string, string> = {
  morning: '모닝',
  brain: '브레인',
  calen: '캘린',
  writer: '라이터',
  buzz: '버즈',
  remix: '리믹서',
  coach: '코치',
  radar: '레이더',
}

function parseBriefing(raw: unknown): MorningBriefing {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('브리핑 응답 형식이 올바르지 않습니다.')
  }
  const rec = raw as Record<string, unknown>
  const agentSummaries = Array.isArray(rec.agentSummaries)
    ? rec.agentSummaries
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map((s) => ({
          agent: typeof s.agent === 'string' ? s.agent : '',
          summary: typeof s.summary === 'string' ? s.summary : '',
        }))
    : []
  return {
    headline: typeof rec.headline === 'string' ? rec.headline : '',
    agentSummaries,
    risks: Array.isArray(rec.risks)
      ? rec.risks.filter((r): r is string => typeof r === 'string')
      : [],
    nextActions: Array.isArray(rec.nextActions)
      ? rec.nextActions.filter((n): n is string => typeof n === 'string')
      : [],
  }
}

function buildLogText(entries: WorkLogEntry[]): string {
  return entries
    .map((e) => {
      const agentLabel = AGENT_LABEL_KO[e.agent] ?? e.agent
      const cost = e.costUsd !== undefined ? `$${e.costUsd.toFixed(3)}` : '진행중'
      return `- [${agentLabel}] ${e.kind} / ${e.statusLabel} / ${cost} / ${e.note}`
    })
    .join('\n')
}

export async function generateMorningBriefing(params: {
  apiKey: string
  brand: string
  entries: WorkLogEntry[]
  todaySpendUsd: number
  dateLabel?: string
}): Promise<MorningBriefing> {
  const { apiKey, brand, entries, todaySpendUsd, dateLabel = '오늘' } = params
  const raw = await callClaudeJson({
    apiKey,
    system: buildMorningSystemPrompt(),
    user: buildMorningUserPrompt({
      brand,
      dateLabel,
      logText: buildLogText(entries),
      spendText: `$${todaySpendUsd.toFixed(3)} / $5`,
    }),
    maxTokens: 2048,
    onUsage: (usage) => recordSpendUsd(estimateCostUsd(usage)),
  })
  return parseBriefing(raw)
}

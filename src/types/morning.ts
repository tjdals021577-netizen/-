export interface AgentBriefingSummary {
  agent: string
  summary: string
}

export interface MorningBriefing {
  headline: string
  agentSummaries: AgentBriefingSummary[]
  risks: string[]
  nextActions: string[]
}

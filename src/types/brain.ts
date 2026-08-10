export interface BrainFinding {
  source: string
  insight: string
}

export interface BrainReport {
  findings: BrainFinding[]
  summary: string
  recommendations: string[]
}

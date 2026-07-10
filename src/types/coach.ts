export interface StatReading {
  label: string
  value: string
}

export interface CoachAnalysis {
  extractedStats: StatReading[]
  summary: string
  nextSteps: string[]
}

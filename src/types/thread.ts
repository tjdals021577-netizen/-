import type { CriterionScore, RevisionFlag } from './domain.js'

export interface ThreadDraft {
  text: string
}

export interface ThreadFormatDraft {
  format: string
  text: string
}

export interface ThreadReview {
  totalScore: number
  summary: string
  criteriaScores: CriterionScore[]
  flags: RevisionFlag[]
}

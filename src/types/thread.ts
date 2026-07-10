import type { CriterionScore, RevisionFlag } from './domain'

export interface ThreadDraft {
  text: string
}

export interface ThreadReview {
  totalScore: number
  summary: string
  criteriaScores: CriterionScore[]
  flags: RevisionFlag[]
}

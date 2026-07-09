import type { CriterionScore } from './domain'

export type BlogRole = 'seo' | 'copywriting' | 'experience'

export type FlagSeverity = 'info' | 'check' | 'risk'

export interface RevisionFlag {
  quote: string
  reason: string
  severity: FlagSeverity
}

export interface BlogReview {
  role: BlogRole
  totalScore: number
  summary: string
  criteriaScores: CriterionScore[]
  flags: RevisionFlag[]
}

export interface BlogDraft {
  title: string
  body: string
  photoPlacements: string[]
}

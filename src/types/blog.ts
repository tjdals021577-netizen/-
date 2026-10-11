import type { CriterionScore, RevisionFlag } from './domain.js'

export type BlogRole = 'seo' | 'copywriting' | 'experience'

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

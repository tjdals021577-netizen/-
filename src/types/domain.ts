export type AgentRole = 'planning' | 'editing' | 'strategy'

export interface TranscriptCue {
  start: number // seconds
  end: number // seconds
  text: string
}

export interface RubricCriterion {
  id: string
  label: string
  weight: number // point value, criteria for a role sum to 100
  description: string
}

export interface CriterionScore {
  criterionId: string
  score: number // 0..weight
  comment: string
}

export type CutAction = 'cut' | 'keep_tight' | 'keep'

export interface CutSuggestion {
  startSec: number
  endSec: number
  action: CutAction
  reason: string
}

export type EmphasisType =
  | 'caption'
  | 'zoom_punch_in'
  | 'sfx'
  | 'freeze_frame'
  | 'b_roll'
  | 'thumbnail_moment'

export interface EmphasisSuggestion {
  timeSec: number
  type: EmphasisType
  label: string
  reason: string
}

export interface AgentReview {
  role: AgentRole
  totalScore: number // 0..100
  summary: string
  criteriaScores: CriterionScore[]
  cutSuggestions: CutSuggestion[]
  emphasisSuggestions: EmphasisSuggestion[]
  risks: string[]
}

export interface ReviewResult {
  reviews: AgentReview[]
  averageScore: number
  passed: boolean
  generatedAt: string
}

export const PASS_THRESHOLD = 90

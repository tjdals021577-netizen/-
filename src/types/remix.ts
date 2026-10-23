import type { CriterionScore, RevisionFlag } from './domain.js'

export interface RemixPlan {
  title: string
  hooks: string[]
  outline: string
  benchmarkNotes: string[]
}

// 유튜브 기획안 채점 결과 — 대표님 유튜브 자료 기반 루브릭(remixRubric.ts)으로
// 채점한다. 블로그와 동일한 공용 타입(CriterionScore·RevisionFlag)을 재사용.
export interface RemixReview {
  totalScore: number
  summary: string
  criteriaScores: CriterionScore[]
  flags: RevisionFlag[]
}

export interface BrainFinding {
  source: string
  insight: string
}

// content-brain(유튜브·스레드 소재) 추가 필드 — 마잘남 유튜브 "작업물 공개형"용
// (재설계 지시서 8번). 확인 안 된 항목은 빈 배열로 둔다(억지로 채우지 않음).
export interface BrainWorkAngle {
  problem: string // 사업자들이 스레드에서 막히는 문제
  showInVideo: string // 이번 주 작업 영상에서 보여줄 수정 포인트
}

export interface BrainRebuttal {
  myth: string // 유행하는 스레드 통념·조언
  counterDirection: string // 반박 근거 방향
}

export interface BrainReference {
  titleType: string // 제목 유형(원문 복사 금지)
  thumbnailPattern: string
  hookPattern: string // 첫 10초 후킹 방식
  source: string
}

export interface BrainReport {
  findings: BrainFinding[]
  summary: string
  recommendations: string[]
  workAngles?: BrainWorkAngle[]
  rebuttals?: BrainRebuttal[]
  references?: BrainReference[]
}

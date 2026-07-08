import type { AgentReview, EmphasisSuggestion } from '../types/domain'

export interface Segment {
  start: number
  end: number
}

const MIN_GAP_BETWEEN_CUTS = 0.2 // 이보다 가까운 컷 구간은 하나로 합침
const MIN_KEEP_SEGMENT = 0.15 // 이보다 짧은 유지 구간은 버림

/** 여러 에이전트의 cut(action="cut") 제안을 병합해 잘라낼 구간 목록을 만든다. */
export function mergeCutRanges(
  reviews: AgentReview[],
  duration: number,
): Segment[] {
  const raw = reviews
    .flatMap((r) => r.cutSuggestions)
    .filter((c) => c.action === 'cut')
    .map((c) => ({
      start: Math.max(0, Math.min(c.startSec, c.endSec)),
      end: Math.min(duration, Math.max(c.startSec, c.endSec)),
    }))
    .filter((s) => s.end - s.start > 0.05)
    .sort((a, b) => a.start - b.start)

  const merged: Segment[] = []
  for (const seg of raw) {
    const last = merged[merged.length - 1]
    if (last && seg.start - last.end <= MIN_GAP_BETWEEN_CUTS) {
      last.end = Math.max(last.end, seg.end)
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}

/** 잘라낼 구간의 여집합(유지 구간)을 duration 기준으로 계산한다. */
export function computeKeepSegments(
  cutRanges: Segment[],
  duration: number,
): Segment[] {
  const keep: Segment[] = []
  let cursor = 0
  for (const cut of cutRanges) {
    if (cut.start - cursor > MIN_KEEP_SEGMENT) {
      keep.push({ start: cursor, end: cut.start })
    }
    cursor = Math.max(cursor, cut.end)
  }
  if (duration - cursor > MIN_KEEP_SEGMENT) {
    keep.push({ start: cursor, end: duration })
  }
  // 컷 제안이 하나도 없으면 원본 전체를 유지
  if (keep.length === 0 && cutRanges.length === 0) {
    return [{ start: 0, end: duration }]
  }
  return keep
}

/** 원본 타임코드를 컷 편집 후의 새 타임라인 위치로 변환. 잘려나간 구간이면 null. */
export function remapTime(keepSegments: Segment[], t: number): number | null {
  let offset = 0
  for (const seg of keepSegments) {
    if (t >= seg.start && t <= seg.end) {
      return offset + (t - seg.start)
    }
    offset += seg.end - seg.start
  }
  return null
}

export interface RemappedEmphasis extends EmphasisSuggestion {
  newTimeSec: number
}

/** 3인 에이전트의 강조 제안을 병합하고, 컷 편집 후 새 타임라인으로 재배치한다. */
export function mergeAndRemapEmphasis(
  reviews: AgentReview[],
  keepSegments: Segment[],
): RemappedEmphasis[] {
  const all = reviews.flatMap((r) => r.emphasisSuggestions)
  const remapped: RemappedEmphasis[] = []

  for (const e of all) {
    const newTimeSec = remapTime(keepSegments, e.timeSec)
    if (newTimeSec === null) continue // 컷된 구간의 강조 포인트는 제외
    remapped.push({ ...e, newTimeSec })
  }

  // 0.75초 이내 + 같은 타입은 중복으로 보고 하나만 남김
  remapped.sort((a, b) => a.newTimeSec - b.newTimeSec)
  const deduped: RemappedEmphasis[] = []
  for (const e of remapped) {
    const last = deduped[deduped.length - 1]
    if (last && last.type === e.type && e.newTimeSec - last.newTimeSec < 0.75) {
      continue
    }
    deduped.push(e)
  }
  return deduped
}

export function totalKeepDuration(keepSegments: Segment[]): number {
  return keepSegments.reduce((s, seg) => s + (seg.end - seg.start), 0)
}

import type { TranscriptCue } from '../types/domain'

function timeToSeconds(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
  )
}

const SRT_TIME = /(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/

function parseTimeToken(token: string): number | null {
  const m = SRT_TIME.exec(token)
  if (!m) return null
  return timeToSeconds(m[1], m[2], m[3], m[4])
}

/** .srt 또는 .vtt 자막 텍스트를 TranscriptCue 배열로 파싱한다. */
export function parseSubtitleFile(content: string): TranscriptCue[] {
  const normalized = content.replace(/\r\n/g, '\n')
  const blocks = normalized.split(/\n\n+/)
  const cues: TranscriptCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeLineIdx === -1) continue
    const [startTok, endTokRaw] = lines[timeLineIdx].split('-->')
    const start = parseTimeToken(startTok.trim())
    const end = parseTimeToken(endTokRaw.trim())
    if (start === null || end === null) continue
    const text = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!text) continue
    cues.push({ start, end, text })
  }
  return cues
}

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 프롬프트에 넣을 "[mm:ss-mm:ss] 텍스트" 형식으로 직렬화 */
export function cuesToPromptText(cues: TranscriptCue[]): string {
  return cues
    .map((c) => `[${formatTimecode(c.start)}-${formatTimecode(c.end)}] ${c.text}`)
    .join('\n')
}

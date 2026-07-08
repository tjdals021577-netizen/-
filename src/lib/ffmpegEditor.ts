import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import type { Segment } from './editPlan'
import type { RemappedEmphasis } from './editPlan'

const CORE_BASE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'

let ffmpegSingleton: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

export async function getFFmpeg(
  onLog?: (message: string) => void,
): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton
  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg()
      if (onLog) {
        ffmpeg.on('log', ({ message }) => onLog(message))
      }
      const coreURL = await toBlobURL(
        `${CORE_BASE_URL}/ffmpeg-core.js`,
        'text/javascript',
      )
      const wasmURL = await toBlobURL(
        `${CORE_BASE_URL}/ffmpeg-core.wasm`,
        'application/wasm',
      )
      await ffmpeg.load({ coreURL, wasmURL })
      ffmpegSingleton = ffmpeg
      return ffmpeg
    })()
  }
  return loadPromise
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '’')
    .replace(/%/g, '\\%')
    .slice(0, 40)
}

function buildCaptionFilter(captions: RemappedEmphasis[]): string | null {
  const relevant = captions.filter(
    (c) => c.type === 'caption' || c.type === 'thumbnail_moment',
  )
  if (relevant.length === 0) return null

  const filters = relevant.map((c) => {
    const start = c.newTimeSec
    const end = c.newTimeSec + 1.6
    const label = escapeDrawtext(c.label || c.reason || '강조')
    const color = c.type === 'thumbnail_moment' ? 'yellow' : 'white'
    return `drawtext=text='${label}':enable='between(t\\,${start.toFixed(2)}\\,${end.toFixed(2)})':x=(w-text_w)/2:y=h-140:fontsize=48:fontcolor=${color}:borderw=4:bordercolor=black:box=1:boxcolor=black@0.55:boxborderw=10`
  })
  return filters.join(',')
}

export interface ProgressCallback {
  (phase: string, ratio: number): void
}

export async function renderEditedVideo(params: {
  inputFile: File
  keepSegments: Segment[]
  emphasis: RemappedEmphasis[]
  onProgress?: ProgressCallback
  onLog?: (message: string) => void
}): Promise<Blob> {
  const { inputFile, keepSegments, emphasis, onProgress, onLog } = params
  const ffmpeg = await getFFmpeg(onLog)

  const ext = inputFile.name.split('.').pop() || 'mp4'
  const inputName = `input.${ext}`
  await ffmpeg.writeFile(inputName, await fetchFile(inputFile))

  onProgress?.('cutting', 0)
  const segmentNames: string[] = []
  for (let i = 0; i < keepSegments.length; i++) {
    const seg = keepSegments[i]
    const outName = `seg_${String(i).padStart(3, '0')}.mp4`
    await ffmpeg.exec([
      '-ss',
      seg.start.toFixed(3),
      '-to',
      seg.end.toFixed(3),
      '-i',
      inputName,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      outName,
    ])
    segmentNames.push(outName)
    onProgress?.('cutting', (i + 1) / keepSegments.length)
  }

  const concatList = segmentNames.map((n) => `file '${n}'`).join('\n')
  await ffmpeg.writeFile('concat.txt', concatList)

  const captionFilter = buildCaptionFilter(emphasis)
  const finalName = 'final.mp4'

  onProgress?.('rendering', 0)
  if (captionFilter) {
    await ffmpeg.exec([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'concat.txt',
      '-vf',
      captionFilter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      finalName,
    ])
  } else {
    await ffmpeg.exec([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'concat.txt',
      '-c',
      'copy',
      finalName,
    ])
  }
  onProgress?.('rendering', 1)

  const data = await ffmpeg.readFile(finalName)
  const bytes = new Uint8Array(data as Uint8Array)
  return new Blob([bytes], { type: 'video/mp4' })
}

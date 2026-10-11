import type { ReferenceMediaType } from '../types/reference.js'

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// 이미지를 캔버스로 축소해 JPEG base64로 반환한다 — 원본(수 MB)을 그대로 저장하면
// localStorage·Supabase·비전 토큰이 다 무거워진다. 긴 변 maxDim(기본 1400px)로 줄이면
// 스레드 스크린샷 글자는 읽히면서 용량은 5~15배 줄어든다. 실패하면 원본 base64로 폴백.
export async function fileToDownscaledBase64(
  file: File,
  maxDim = 1400,
  quality = 0.82,
): Promise<{ imageBase64: string; mediaType: ReferenceMediaType }> {
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('이미지 로드 실패'))
      el.src = dataUrl
    })
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 미지원')
    ctx.drawImage(img, 0, 0, w, h)
    const out = canvas.toDataURL('image/jpeg', quality)
    return { imageBase64: out.slice(out.indexOf(',') + 1), mediaType: 'image/jpeg' }
  } catch {
    // 폴백: 원본 그대로(비전은 되지만 용량은 큼)
    const base64 = await fileToBase64(file)
    return { imageBase64: base64, mediaType: mediaTypeOf(file) ?? 'image/png' }
  }
}

// 이미 저장된 base64 이미지(원본 풀사이즈일 수 있음)를 축소해 다시 base64로.
// 재요청처럼 저장된 원본을 비전에 보낼 때 요청이 너무 무거워 실패하는 걸 막는다.
// 실패하면 원본 base64를 그대로 반환(폴백).
export async function downscaleBase64Image(
  imageBase64: string,
  mediaType: ReferenceMediaType,
  maxDim = 1400,
  quality = 0.82,
): Promise<{ imageBase64: string; imageMediaType: ReferenceMediaType }> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('이미지 로드 실패'))
      el.src = `data:${mediaType};base64,${imageBase64}`
    })
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    if (scale >= 1) return { imageBase64, imageMediaType: mediaType } // 이미 작으면 그대로
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 미지원')
    ctx.drawImage(img, 0, 0, w, h)
    const out = canvas.toDataURL('image/jpeg', quality)
    return { imageBase64: out.slice(out.indexOf(',') + 1), imageMediaType: 'image/jpeg' }
  } catch {
    return { imageBase64, imageMediaType: mediaType }
  }
}

export function mediaTypeOf(file: File): ReferenceMediaType | null {
  if (file.type === 'image/png') return 'image/png'
  if (file.type === 'image/jpeg') return 'image/jpeg'
  if (file.type === 'image/webp') return 'image/webp'
  return null
}

// PDF 여부 — 대행 온보딩에서 구글폼·레퍼런스를 PDF로 대체할 때 이미지와 구분한다.
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

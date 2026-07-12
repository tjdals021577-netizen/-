import type { ReferenceMediaType } from '../types/reference'

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

export function mediaTypeOf(file: File): ReferenceMediaType | null {
  if (file.type === 'image/png') return 'image/png'
  if (file.type === 'image/jpeg') return 'image/jpeg'
  if (file.type === 'image/webp') return 'image/webp'
  return null
}

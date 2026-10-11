export type ReferenceMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ReferenceImage {
  id: string
  label: string
  imageBase64: string
  mediaType: ReferenceMediaType
  createdAt: string
}

import type { Brand } from './brand.js'

export type ContentPhotoMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

// 블로그 콘텐츠에 실제로 쓸 사진 — 스타일 참고용인 reference_images(레퍼런스
// 라이브러리)와는 목적이 다르다. 이건 "이 날짜 이 브랜드 글에 넣을 실제 사진"을
// calendar_entries가 만들어지기 전에 미리 받아두기 위한 것이라, 캘린더 항목 id가
// 아직 없을 수 있는 미래 날짜 기준(date+brand+channel)으로 연결한다.
export interface ContentPhoto {
  id: string
  date: string // YYYY-MM-DD — 이 사진을 쓸 콘텐츠의 날짜
  brand: Brand
  channel: 'blog'
  label: string
  imageBase64: string
  mediaType: ContentPhotoMediaType
  createdAt: string
}

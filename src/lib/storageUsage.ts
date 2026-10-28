// 대시보드 "저장 용량" 카드용 — 이미지 테이블에 쌓인 개수를 세어서 예상
// 용량을 보여준다. Supabase 무료 한도(500MB)에서 base64 이미지가 용량을 가장
// 많이 먹으므로, 대표님이 용량이 얼마나 찼는지 눈으로 지켜볼 수 있게 한다.
//
// 정확한 바이트 합계는 별도 DB 함수가 필요하지만, 여기서는 추가 SQL 없이
// 개수 × 평균 크기로 "추정치"를 보여준다(지켜보기 용도로 충분). 개수는
// PostgREST의 count=exact로 정확히 가져온다.

function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.trim().replace(/[^\x20-\x7E]/g, '')
  return cleaned || undefined
}
const SUPABASE_URL = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

// 스크린샷 base64 한 장의 평균 저장 크기(대략) — 실제는 0.1~1MB로 편차가 있어
// 어디까지나 추정용. 보수적으로 약간 크게 잡아 "생각보다 적네"보다 "여유 있네"가
// 되도록 한다.
const AVG_IMAGE_MB = 0.45
const FREE_LIMIT_MB = 500

export interface StorageUsage {
  contentPhotos: number
  referenceImages: number
  totalImages: number
  estimatedMb: number
  limitMb: number
  percent: number
}

async function countRows(table: string): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return 0
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
      method: 'HEAD',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    })
    // content-range 헤더: "0-0/1234" 형식 — 슬래시 뒤가 전체 개수.
    const range = res.headers.get('content-range')
    if (!range) return 0
    const total = range.split('/')[1]
    const n = Number(total)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export async function fetchStorageUsage(): Promise<StorageUsage | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  const [contentPhotos, referenceImages] = await Promise.all([
    countRows('content_photos'),
    countRows('reference_images'),
  ])
  const totalImages = contentPhotos + referenceImages
  const estimatedMb = Math.round(totalImages * AVG_IMAGE_MB * 10) / 10
  const percent = Math.min(100, Math.round((estimatedMb / FREE_LIMIT_MB) * 100))
  return {
    contentPhotos,
    referenceImages,
    totalImages,
    estimatedMb,
    limitMb: FREE_LIMIT_MB,
    percent,
  }
}

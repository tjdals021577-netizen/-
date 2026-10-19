// 매주 월요일 새벽(vercel.json 참고)에 돌면서, 발행에 쓰고 나면 다시 필요 없는 블로그 발행용
// 사진(content_photos)을 정리한다. Supabase 무료 500MB 한도에서 base64 이미지가 가장 큰 용량을
// 차지하므로, 오래된 것을 주기적으로 지워 용량이 계속 차오르는 걸 막는다.
//
// 대표님 결정: 5개월(=약 150일) 지난 블로그 사진만 삭제한다. 레퍼런스 라이브러리(reference_images)는
// 대표님이 일부러 모아둔 참고 자료라 건드리지 않는다. content_photos는 특정 날짜의 블로그에 한 번
// 쓰이고 끝나는 일회성이라 5개월이면 이미 발행이 끝난 지 한참 지난 것이어서 안전하다.
// (2026-10: 함수 개수 한도 때문에 api/cron/cleanup.ts → api/cron/[task].ts의 'cleanup'으로 옮김. 주소는 그대로.)
import { supabaseDelete } from './supabaseAdmin.js'

const RETENTION_DAYS = 150 // 약 5개월

// KST 기준으로 "오늘 - 150일"의 날짜(YYYY-MM-DD). content_photos.date는 날짜 문자열 비교로 충분하다.
function cutoffDateKst(): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const cutoff = new Date(kstNow.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return cutoff.toISOString().slice(0, 10)
}

export async function runCleanup(): Promise<Record<string, unknown>> {
  const cutoff = cutoffDateKst()
  try {
    // date가 cutoff보다 과거(lt)인 블로그 사진만 삭제. 필터가 반드시 있으므로 전체 삭제 위험이 없다
    // (supabaseDelete 안전장치도 이중으로 막는다).
    const deleted = await supabaseDelete('content_photos', `date=lt.${cutoff}`)
    return { ok: true, table: 'content_photos', cutoff, deleted, note: `${cutoff} 이전 블로그 사진 ${deleted}건 정리` }
  } catch (err) {
    return { ok: false, cutoff, error: err instanceof Error ? err.message : String(err) }
  }
}

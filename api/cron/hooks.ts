// 구글시트("웹에 게시" 공개 CSV)에 모아둔 "터진 후킹·CTA"를 읽어 Supabase의
// reference_hooks 테이블에 저장한다. 스레드 위원회·대행이 글을 쓸 때 이 후킹의
// "구조·틀"을 참고해 우리 주제로 치환한다. 매일 1회 갱신(시트가 늘어나면 자동 반영).
//
// 설정: Vercel 환경변수 HOOK_SHEET_CSV_URLS 에 "웹에 게시" CSV 주소들을 콤마로
// 구분해 넣는다(시트마다 파일 → 공유 → 웹에 게시 → CSV). 미설정이면 조용히 건너뜀.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { supabaseInsert } from '../_lib/supabaseAdmin.js'
import { fetchHooksFromCsvUrls } from '../_lib/sheetHooks.js'
import { requireCronAuth, sendJson } from '../_lib/cronHandler.js'

// 후킹 문장으로 결정적 id를 만든다 — 같은 문장은 재실행해도 같은 id라
// merge-duplicates 업서트로 중복 없이 갱신된다(시트에서 지운 건 남지만, 문구가
// 바뀌면 새 행으로 들어온다 — 라이브 참고용이라 이 정도 정합성이면 충분).
function hookId(hook: string): string {
  return createHash('sha1').update(hook.trim()).digest('hex').slice(0, 20)
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return

  const urlsRaw = process.env.HOOK_SHEET_CSV_URLS
  if (!urlsRaw || !urlsRaw.trim()) {
    sendJson(res, 200, { ok: true, note: 'HOOK_SHEET_CSV_URLS 미설정 — 건너뜀' })
    return
  }
  const urls = urlsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  try {
    const hooks = await fetchHooksFromCsvUrls(urls)
    const nowIso = new Date().toISOString()
    let saved = 0
    for (const h of hooks) {
      await supabaseInsert('reference_hooks', {
        id: hookId(h.hook),
        hook: h.hook,
        industry: h.industry ?? null,
        structure: h.structure ?? null,
        cta: h.cta ?? null,
        updated_at: nowIso,
      })
      saved++
    }
    sendJson(res, 200, { ok: true, sheets: urls.length, saved })
  } catch (err) {
    sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

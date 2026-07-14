// 카카오 로그인 최초 연결용 — 사람이 브라우저로 인가 URL을 방문해서 로그인
// 동의하면 카카오가 이 엔드포인트로 ?code=...를 붙여 리다이렉트한다. 그 code를
// access_token/refresh_token으로 교환해서 refresh_token을 Supabase에 저장하고,
// 바로 테스트 메시지를 하나 보내서 연결이 실제로 됐는지 그 자리에서 확인시켜준다.
// CRON_SECRET 인증이 없다 — OAuth 콜백은 원래 공개 엔드포인트이고, 코드 자체가
// 1회용/단명 토큰이라 안전하다(표준 OAuth 콜백 패턴).
import type { IncomingMessage, ServerResponse } from 'node:http'
import { exchangeKakaoCode, sendKakaoMemoToSelf } from './_lib/kakao.js'
import { supabaseInsert } from './_lib/supabaseAdmin.js'
import { sendText } from './_lib/cronHandler.js'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '', `https://${req.headers.host}`)
  const code = url.searchParams.get('code')
  if (!code) {
    sendText(res, 400, '카카오 로그인 인가 코드(code)가 없습니다. 로그인 URL로 다시 접속해주세요.')
    return
  }
  const restApiKey = process.env.KAKAO_REST_API_KEY
  if (!restApiKey) {
    sendText(res, 500, 'KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }
  const redirectUri = `https://${req.headers.host}/api/kakao-setup`
  try {
    const { accessToken, refreshToken } = await exchangeKakaoCode({ restApiKey, redirectUri, code })
    await supabaseInsert('kakao_tokens', {
      id: 'default',
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
    })
    await sendKakaoMemoToSelf({
      accessToken,
      text: '✅ 카카오 알림 연결 완료!\n이제 매일 아침 08시에 업메리·마잘남 브리핑을 카톡으로 받아요.',
    })
    sendText(res, 200, '연결 성공! 카카오톡을 확인해보세요. 이 창은 닫아도 됩니다.')
  } catch (err) {
    sendText(res, 500, `연결 실패: ${err instanceof Error ? err.message : String(err)}`)
  }
}

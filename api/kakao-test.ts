// 이미 연결된 카카오 계정으로 테스트 메시지 한 건만 보낸다(로그인 다시 안 해도 됨,
// Claude API도 안 씀 — 순수하게 카카오 메시지 전송 파이프라인만 확인하는 용도).
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getKakaoAccessToken, sendKakaoMemoToSelf } from './_lib/kakao.js'
import { sendText } from './_lib/cronHandler.js'

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const restApiKey = process.env.KAKAO_REST_API_KEY
  if (!restApiKey) {
    sendText(res, 500, 'KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }
  try {
    const accessToken = await getKakaoAccessToken(restApiKey, process.env.KAKAO_CLIENT_SECRET)
    if (!accessToken) {
      sendText(res, 400, '카카오 연결이 안 돼 있습니다. /api/kakao-setup으로 먼저 연결하세요.')
      return
    }
    await sendKakaoMemoToSelf({ accessToken, text: '테스트 메시지입니다 📩' })
    sendText(res, 200, '테스트 메시지 전송 완료! 카카오톡을 확인해보세요.')
  } catch (err) {
    sendText(res, 500, `전송 실패: ${err instanceof Error ? err.message : String(err)}`)
  }
}

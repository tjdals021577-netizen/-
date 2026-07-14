// 카카오 로그인으로 "나에게 보내기" 메시지를 보낸다. REST API 키 하나로 인가
// 코드를 access_token/refresh_token으로 교환하고(최초 1회, api/kakao-setup.ts),
// 이후에는 refresh_token으로 매번 access_token을 새로 발급받아 메시지를 보낸다
// (refresh_token은 Supabase kakao_tokens 테이블에 저장 — 갱신될 때마다 덮어씀).
import { supabaseSelect, supabaseInsert } from './supabaseAdmin.js'

const TOKEN_URL = 'https://kauth.kakao.com/oauth/token'
const SEND_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send'

interface KakaoTokenRow {
  refresh_token: string
}

export async function exchangeKakaoCode(params: {
  restApiKey: string
  clientSecret?: string
  redirectUri: string
  code: string
}): Promise<{ accessToken: string; refreshToken: string }> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: params.restApiKey,
    redirect_uri: params.redirectUri,
    code: params.code,
  }
  if (params.clientSecret) body.client_secret = params.clientSecret
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  if (!res.ok) {
    throw new Error(`카카오 토큰 발급 실패: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { access_token: string; refresh_token: string }
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}

// 저장된 refresh_token으로 access_token을 새로 발급받는다. 카카오가 새
// refresh_token을 같이 내려주면(만료 임박 시 로테이션) Supabase에도 갱신해서
// 계속 자동 갱신되게 한다 — 사람이 다시 로그인할 필요 없음.
export async function getKakaoAccessToken(
  restApiKey: string,
  clientSecret?: string,
): Promise<string | null> {
  const rows = await supabaseSelect<KakaoTokenRow>(
    'kakao_tokens',
    'id=eq.default&select=refresh_token',
  )
  const refreshToken = rows[0]?.refresh_token
  if (!refreshToken) return null

  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    client_id: restApiKey,
    refresh_token: refreshToken,
  }
  if (clientSecret) body.client_secret = clientSecret
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  if (!res.ok) {
    throw new Error(`카카오 토큰 갱신 실패: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { access_token: string; refresh_token?: string }
  if (data.refresh_token) {
    await supabaseInsert('kakao_tokens', {
      id: 'default',
      refresh_token: data.refresh_token,
      updated_at: new Date().toISOString(),
    })
  }
  return data.access_token
}

export async function sendKakaoMemoToSelf(params: { accessToken: string; text: string }): Promise<void> {
  const templateObject = {
    object_type: 'text',
    text: params.text,
    link: { web_url: 'https://kakao.com', mobile_web_url: 'https://kakao.com' },
  }
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
  })
  if (!res.ok) {
    throw new Error(`카카오 메시지 전송 실패: ${res.status} ${await res.text()}`)
  }
}

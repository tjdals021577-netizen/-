import { startWorkLog, syncWorkLogFromSupabase } from './workLog.js'
import { syncApprovalsFromSupabase } from './approvalStore.js'
import type { Brand } from '../types/brand.js'
import type { DispatchableAgent } from '../agents/dispatch.js'

// 팀 채팅 "일 시키기"를 서버(/api/dispatch)에서 실행시키는 브라우저 측 진입점.
//
// 예전엔 생성·채점을 브라우저(그 탭)에서 직접 돌려서, 작업 도중 탭을 벗어나거나
// 새로고침하면 통째로 죽었다("처리 중… 11분"이 끝없이 뜨던 문제). 이제는 서버가
// 끝까지 돌려 결과를 Supabase에 직접 쓰므로, 대표님은 탭을 꺼도 되고 나중에
// 들어오면 결재함에 결과가 올라와 있다.
//
// 흐름: ①즉시 로컬 'running' 버블을 만들어 바로 피드백을 준다(같은 id를 서버에
// 넘김). ②서버가 그 id로 최종 상태(완료/보류/오류)를 Supabase에 upsert한다.
// ③응답이 오면 권위 있는 상태를 동기화해 로컬 임시 버블을 덮어쓴다. 응답이
// 도달하지 못해도(탭이 닫힘) 서버가 이미 다 써놨으므로, 다음 진입 시 동기화로 뜬다.
export async function dispatchJobRemote(params: {
  agent: DispatchableAgent
  brand: Brand
  instruction: string
  previousOutput?: { title: string; content: string }
}): Promise<void> {
  const { agent, brand, instruction, previousOutput } = params
  // 로컬 임시 'running' 기록 — 즉각적인 "처리 중" 버블용. 서버가 같은 id로
  // 완료 행을 써서 동기화 때 이 행이 그대로 완료로 바뀐다.
  const logId = startWorkLog({ agent, brand, kind: '수동 지시(팀 채팅)', note: instruction })

  const password = import.meta.env.VITE_APP_PASSWORD
  let res: Response
  try {
    res = await fetch('/api/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(password ? { 'X-App-Password': password } : {}),
      },
      body: JSON.stringify({ agent, brand, instruction, logId, previousOutput }),
    })
  } catch {
    // 네트워크가 끊기거나 탭이 백그라운드로 내려가 fetch가 죽어도, 서버는 계속
    // 돌아 결과를 Supabase에 쓴다 — 여기선 조용히 넘어간다(로컬 running 버블은
    // 다음 동기화나 자동 '시간 초과' 정리로 회복됨). 사용자에게 오류로 알리지
    // 않는다 — 실제로는 서버에서 작성이 진행 중이기 때문.
    return
  }

  // 서버가 이미 최종 상태를 Supabase에 썼다 — 권위 있는 상태를 당겨와 로컬
  // 임시 running 버블을 같은 id의 완료/보류/오류 행으로 덮어쓴다.
  await Promise.all([syncWorkLogFromSupabase(), syncApprovalsFromSupabase()])

  if (!res.ok) {
    let msg = `서버 오류 (${res.status})`
    try {
      const data = (await res.json()) as { error?: unknown }
      if (typeof data.error === 'string') msg = data.error
    } catch {
      // 본문 파싱 실패 시 상태코드 메시지 유지.
    }
    throw new Error(msg)
  }
}

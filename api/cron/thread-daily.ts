// 매일 아침(07:40 KST, vercel.json 참고) 마잘남 스레드 위원회가 대표님이
// 실제 쓰던 마스터 프롬프트 그대로 8개 형식(7가지 형식 + 질문형 후킹 버전)
// 시안을 자동으로 만들어서 팀채팅에 올려둔다.
// 사람이 결재/발행할 필요 없는 참고용 시안이라 캘린더·결재함에는 넣지 않고
// work_log에만 남긴다(대표님 요청: "팀채팅에만 쌓아두기").
// 스레드는 마잘남 전용 채널이라(업메리는 스레드 미운영) 마잘남만 처리한다.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateThreadFullFormatSet } from '../../src/agents/runThreadReview.js'
import { THREAD_FULL_FORMATS } from '../../src/agents/threadPrompts.js'
import type { VisionImageInput } from '../../src/lib/claude.js'
import { supabaseSelect, supabaseInsert } from '../_lib/supabaseAdmin.js'
import { fetchHookReferenceBlock } from '../_lib/sheetHooks.js'
import { requireCronAuth, haltIfPaused, sendJson, sendText } from '../_lib/cronHandler.js'

const BRAND = '마잘남'
// 하루에 8개는 다 못 쓴다는 대표님 결정 — 형식 8개 풀에서 매일 5개씩
// 순환(다음날엔 다음 5개)해서 비용을 ~40% 줄이면서 유형은 골고루 돌게 함.
const DAILY_FORMAT_COUNT = 5

// 대표님이 지정한 주제 축(스레드·브랜딩·1인사업) 안에서 매일 다른 각도로
// 돌아가며 쓰게 한다 — 브레인 리서치가 아직 없을 때도 항상 쓸 거리가 있게.
const TOPIC_POOL = [
  '스레드로 개인 브랜딩을 시작하려는 1인사업가가 가장 먼저 오해하는 것',
  '팔로워보다 중요한 것 — 1인사업가의 스레드 수익 구조 만들기',
  '스레드 글이 안 터지는 1인사업가들의 공통적인 실수',
  '1인사업가가 스레드에서 신뢰를 쌓아 첫 고객을 만드는 과정',
  '스레드 브랜딩, 남을 따라하지 않고 나만의 색깔을 찾는 법',
  '1인사업가가 스레드 글 하나로 상담 문의를 받기까지',
  '스레드에서 꾸준함이 왜 화려한 스킬보다 강한가',
]

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function dayOfYear(): number {
  const now = new Date()
  const start = Date.UTC(now.getUTCFullYear(), 0, 0)
  return Math.floor((now.getTime() - start) / 86_400_000)
}

function pickTopicOfTheDay(pool: string[]): string {
  return pool[dayOfYear() % pool.length]
}

// 순환 배열에서 오늘 기준으로 count개를 겹치지 않게 골라온다 — 매일 시작
// 위치가 하루씩 밀려서 모든 형식이 골고루 돌아간다.
function pickRotatingFormats(count: number): string[] {
  const offset = (dayOfYear() * count) % THREAD_FULL_FORMATS.length
  return Array.from(
    { length: Math.min(count, THREAD_FULL_FORMATS.length) },
    (_, i) => THREAD_FULL_FORMATS[(offset + i) % THREAD_FULL_FORMATS.length],
  )
}

interface ReferenceImageRow {
  id: string
  image_base64: string
  media_type: 'image/png' | 'image/jpeg' | 'image/webp'
}

// 레퍼런스 라이브러리는 "잘 터진 글" 캡처를 모아두는 용도라, 라벨로 골라낼
// 필요 없이 최근 등록된 것들을 그대로 쓴다 — 라이팅 시스템 프롬프트가 이
// 글들의 "후킹 문장 구조"만 재사용하고 주제만 이번 topic에 맞게 바꿔쓰도록
// 지시한다(threadPrompts.ts의 buildThreadFullFormatSystemPrompt 참고).
// 레퍼런스 조회 실패(테이블 없음 등)가 시안 생성 전체를 막으면 안 된다 —
// 2026-07-15 아침 첫 실행에서 reference_images 테이블이 라이브 DB에 아직
// 없어서(404 PGRST205) 시안 8개가 통째로 실패한 사고가 실제로 있었다.
// 레퍼런스는 어디까지나 보너스 재료라, 실패하면 그냥 없이 진행한다.
async function pickReferenceImages(): Promise<VisionImageInput[]> {
  try {
    const rows = await supabaseSelect<ReferenceImageRow>(
      'reference_images',
      'order=created_at.desc&limit=3&select=id,image_base64,media_type',
    )
    return rows.map((r) => ({ imageBase64: r.image_base64, imageMediaType: r.media_type }))
  } catch {
    return []
  }
}

function buildDetailHtml(drafts: { format: string; text: string }[]): string {
  return drafts
    .map((d) => `<b>[${d.format}]</b><br/>${d.text.replace(/\n/g, '<br/>')}`)
    .join('<br/><br/>')
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  if (haltIfPaused(res)) return
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  const topic = pickTopicOfTheDay(TOPIC_POOL)
  const nowIso = new Date().toISOString()

  try {
    const referenceImages = await pickReferenceImages()
    const formats = pickRotatingFormats(DAILY_FORMAT_COUNT)
    // 구글시트에서 동기화된 터진 후킹·CTA 레퍼런스(구조만 참고해 마잘남 주제로 치환).
    const hookReference = await fetchHookReferenceBlock()
    const drafts = await generateThreadFullFormatSet({ apiKey, topic, referenceImages, formats, hookReference })

    await supabaseInsert('work_log', {
      id: makeId(),
      agent: 'buzz',
      brand: BRAND,
      kind: '아침 유형별 시안(자동)',
      status: 'done',
      status_label: '완료',
      started_at: nowIso,
      ended_at: nowIso,
      note: `주제: ${topic} · 시안 ${drafts.length}개 (참고 이미지 ${referenceImages.length}장)`,
      detail_html: buildDetailHtml(drafts),
    })
    sendJson(res, 200, { ok: true, topic, draftCount: drafts.length, referenceCount: referenceImages.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await supabaseInsert('work_log', {
        id: makeId(),
        agent: 'buzz',
        brand: BRAND,
        kind: '아침 유형별 시안(자동)',
        status: 'error',
        status_label: '오류',
        started_at: nowIso,
        ended_at: new Date().toISOString(),
        note: '자동 생성 실패',
        detail_html: message,
      })
    } catch {
      // 에러 로그 저장 자체가 실패해도 크론 응답은 내려준다
    }
    sendJson(res, 200, { ok: false, error: message })
  }
}

// 매일 아침(07:40 KST, vercel.json 참고) 마잘남 스레드 위원회가 "오늘 바로
// 쓸 수 있는" 유형별 시안 5개를 자동으로 만들어서 팀채팅에 올려둔다.
// 사람이 결재/발행할 필요 없는 참고용 시안이라 캘린더·결재함에는 넣지 않고
// work_log에만 남긴다(대표님 요청: "팀채팅에만 쌓아두기").
// 스레드는 마잘남 전용 채널이라(업메리는 스레드 미운영) 마잘남만 처리한다.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateThreadVariantsWithReferences } from '../../src/agents/runThreadReview.js'
import { BRAND_CONTEXT } from '../../src/types/brand.js'
import type { VisionImageInput } from '../../src/lib/claude.js'
import { supabaseSelect, supabaseInsert } from '../_lib/supabaseAdmin.js'
import { requireCronAuth, sendJson, sendText } from '../_lib/cronHandler.js'

const BRAND = '마잘남'
const VARIANT_COUNT = 5

// 저자가 검증했다고 밝힌 7가지 유형 중, 하루에 5개를 돌아가며 골고루
// 써보게 한다(매일 같은 5개면 금방 소재가 마른다) — 날짜 기준으로 하루씩
// 밀어서 순환시킨다.
const TEMPLATE_TYPES = ['공감형', '숫자형', '통찰형', '반전형', '팁형', '스토리형', '궁금증유발형']

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

// 순환 배열에서 오늘 기준으로 count개를 겹치지 않게 골라온다.
function pickRotating<T>(pool: T[], count: number): T[] {
  const offset = dayOfYear() % pool.length
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(offset + i) % pool.length])
}

interface ReferenceImageRow {
  id: string
  label: string | null
  image_base64: string
  media_type: 'image/png' | 'image/jpeg' | 'image/webp'
}

const REFERENCE_KEYWORDS = ['스레드', '브랜딩', '1인', '사업', '카피']

// 레퍼런스 라이브러리에서 라벨이 이번 주제 축(스레드·브랜딩·1인사업)과
// 맞는 걸 우선 고르고, 없으면 최근 등록된 것 몇 장으로 대체한다 — 매번
// 사람이 수동으로 첨부하지 않아도 "구조"를 참고할 재료를 자동으로 붙여준다.
async function pickReferenceImages(): Promise<VisionImageInput[]> {
  const rows = await supabaseSelect<ReferenceImageRow>(
    'reference_images',
    'order=created_at.desc&limit=20&select=id,label,image_base64,media_type',
  )
  const matched = rows.filter((r) => {
    const label = r.label ?? ''
    return REFERENCE_KEYWORDS.some((kw) => label.includes(kw))
  })
  const chosen = (matched.length > 0 ? matched : rows).slice(0, 2)
  return chosen.map((r) => ({ imageBase64: r.image_base64, imageMediaType: r.media_type }))
}

function buildDetailHtml(drafts: { text: string }[]): string {
  return drafts.map((d, i) => `<b>시안 ${i + 1}</b><br/>${d.text.replace(/\n/g, '<br/>')}`).join('<br/><br/>')
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireCronAuth(req, res)) return
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    sendText(res, 500, 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
    return
  }

  const types = pickRotating(TEMPLATE_TYPES, VARIANT_COUNT)
  const topic = pickRotating(TOPIC_POOL, 1)[0]
  const nowIso = new Date().toISOString()

  try {
    const referenceImages = await pickReferenceImages()
    const drafts = await generateThreadVariantsWithReferences({
      apiKey,
      topic,
      brandVoice: BRAND_CONTEXT[BRAND],
      referenceImages,
      variantCount: VARIANT_COUNT,
      note: `5개 시안은 아래 유형을 순서대로 하나씩 사용해서 서로 다르게 써주세요(유형끼리 절대 겹치지 않게): ${types.join(
        ', ',
      )}. 각 시안의 text 맨 앞줄에 "[유형]" 형태로 어떤 유형인지 표시하고(예: [공감형]) 줄바꿈 후 본문을 이어서 쓰세요.`,
    })

    await supabaseInsert('work_log', {
      id: makeId(),
      agent: 'buzz',
      brand: BRAND,
      kind: '아침 유형별 시안 5개(자동)',
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
        kind: '아침 유형별 시안 5개(자동)',
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

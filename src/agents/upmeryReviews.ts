// 업메리 후기 보관함 — 대표님이 팀채팅(Claude 구독)으로 보내 준 수강생 후기 캡처를 Claude가 읽고, 개인정보를
// 가린 사진(public/reviews/)과 함께 여기 정리한다(2026-10, API 비용 0 — 서버 AI가 캡처를 읽지 않음).
// · 매일 블로그 주제(upmeryTopicBank)가 "후기 사례글" 날이면 아직 안 쓴 후기 1건을 꺼내 그 사례로 글을 쓴다
//   (쓴 후기는 근무기록 메모 "후기 r001"로 표시 → 다시 안 씀).
// · 여기 있는 숫자·문장은 UPMERY_VERIFIED_FACTS에 자동으로 붙어 "검증된 사실"이 된다(지어낸 숫자 검사 통과).
// ★ 이름·전화번호·카톡 ID·프로필 사진은 넣지 않는다. 인용은 원문 말투를 살리되 오타만 다듬는다.
// ★ 새 후기 추가 = 이 배열 맨 뒤에 다음 번호로 + 사진을 public/reviews/upmery-rNNN.png로.

export interface UpmeryReview {
  id: string
  // 입금·대화 날짜(캡처에 보이는 것). 블로그엔 "10월 수강생"처럼 월 단위로만 쓴다.
  date: string
  // 누구인지(캡처로 알 수 있는 만큼만 — 모르면 '수강생').
  who: string
  // 시작 전 상황·걱정(캡처에 있는 것만).
  before?: string
  // 걸린 기간·과정(캡처에 있는 것만).
  process?: string
  // 결과(캡처에 보이는 입금·상담 사실).
  result: string
  // 수강생이 한 말 — 블로그 인용 원문(오타만 다듬음).
  quotes: string[]
  // 대표님 답장(있으면).
  reply?: string
  // 글 제목·주제로 쓸 한 줄.
  headline: string
  // 이 후기로 쓰기 좋은 글 각도.
  angle: string
  // 가린 캡처(웹 경로)와 설명.
  image: string
  imageAlt: string
  // 글쓰기 주의(같은 사람 여부 불확실 등).
  caution?: string
}

export const UPMERY_REVIEWS: UpmeryReview[] = [
  {
    id: 'r001',
    date: '2026-03-25',
    who: '3월 수강생(이미 상담을 시작한 분)',
    result: '같은 손님에게 처음으로 재상담 요청을 받음 — 오픈채팅 송금으로 상담료 3만 원 입금(2026-03-25)',
    quotes: ['언니 나 재상담 들어왔어요..... 덜덜덜덜덜', '나도 단골이 생기는 건가'],
    reply: '오 오늘도 벌었다!',
    headline: '처음 재상담 들어온 날, 단골이 생긴다는 것',
    angle: '단골·재상담 — 첫 상담보다 두 번째 상담이 더 의미 있는 이유',
    image: '/reviews/upmery-r001.png',
    imageAlt: '재상담 상담료 3만 원 입금 알림과 수강생 카톡(이름·프로필 가림)',
  },
  {
    id: 'r002',
    date: '2026-10-20',
    who: '10월 수강생, 아이를 키우는 엄마',
    before: '아이를 키우면서 할 수 있는 일이 없고, 나이 때문에 새로 배우는 것도 걱정이 많았음',
    process: '시작한 지 하루 만에 첫 문의 → 이어서 첫 수익',
    result: '첫 상담 수익 3만 원 입금(2026-10-20)',
    quotes: [
      '현실적으로.. 아가 키우면서 할 수 있는 일도 없고 나이가 드니 배움의 걱정도 많았는데 ㅠㅠ',
      '시작한 지 하루 만에 문의가 들어온 것도 신기했는데 첫 수익까지 생기니까.. 감동입니다!!',
      '금액을 떠나서도 내가 직접 해내서 번 돈이라 이렇게 뿌듯하고 감동일 줄 몰랐습니다!!',
      '처음이라 모르는 것도 많았는데 하나하나 알려주시고 이끌어주셔서 너무 감사합니다',
    ],
    headline: '아이 키우며 시작해 하루 만에 첫 문의, 첫 수익까지',
    angle: '육아 중 엄마 — "할 수 있는 일이 없다"던 걱정에서 첫 수익의 뿌듯함까지',
    image: '/reviews/upmery-r002.png',
    imageAlt: '첫 상담료 3만 원 입금 알림과 수강생 감사 카톡(이름·프로필 가림)',
  },
  {
    id: 'r003',
    date: '2026-10-17',
    who: '10월 수강생',
    result: '토요일 저녁 상담료 3만 원 입금 직후 상담 시작(2026-10-17)',
    quotes: ['쌤 저 상담 다녀올게요!!!!!'],
    headline: '"쌤 저 상담 다녀올게요" 입금 알림 뜨고 1분 뒤',
    angle: '상담 직전의 설렘 — 입금 알림이 오고 바로 상담 들어가는 하루 장면',
    image: '/reviews/upmery-r003.png',
    imageAlt: '상담료 3만 원 입금 알림과 "상담 다녀올게요" 카톡(이름·프로필 가림)',
    caution: 'r005와 같은 날 저녁 — 같은 분인지 확인 안 됨. 한 사람의 하루 합계로 쓰지 말 것.',
  },
  {
    id: 'r004',
    date: '2026-10-20',
    who: '10월 수강생',
    process: '알려 준 대로 홍보 계정을 세팅 → 연락이 오기 시작 → 첫 상담 진행',
    result: '상담료 5만 원 입금(2026-10-20)',
    quotes: [
      '진짜 너무 신기해요',
      '알려주신 대로 세팅했더니 연락 오는 것도 신기하고 진짜로 상담까지 진행해 보니 완전 신세계네요',
      '정말 많이 배웠고 앞으로도 많이 배우겠습니다',
    ],
    headline: '알려준 대로 세팅했더니 연락이 왔다, 첫 상담은 "신세계"',
    angle: '세팅 → 문의 → 첫 상담 — 손님이 오는 길을 만들면 생기는 일',
    image: '/reviews/upmery-r004.png',
    imageAlt: '상담료 5만 원 입금 알림과 수강생 카톡(이름·프로필 가림)',
  },
  {
    id: 'r005',
    date: '2026-10-17',
    who: '10월 수강생',
    result: '30분 상담 요청, 상담료 5만 원 입금(2026-10-17)',
    quotes: ['쌤 저 30분 상담 들어왔어요!! 댕겨오겠습니다'],
    reply: '역시! 굳',
    headline: '토요일 밤, "쌤 저 30분 상담 들어왔어요"',
    angle: '퇴근 후·주말 저녁에 들어오는 상담 — 30분 상담 단가',
    image: '/reviews/upmery-r005.png',
    imageAlt: '30분 상담료 5만 원 입금 알림과 수강생 카톡(이름·프로필 가림)',
    caution: 'r003과 같은 날 저녁 — 같은 분인지 확인 안 됨. 한 사람의 하루 합계로 쓰지 말 것.',
  },
]

export function findReview(id: string): UpmeryReview | undefined {
  return UPMERY_REVIEWS.find((r) => r.id === id)
}

function monthLabel(date: string): string {
  return `${Number(date.slice(5, 7))}월`
}

// UPMERY_VERIFIED_FACTS에 붙는 요약 — 숫자·문장이 "검증된 사실"로 인정되게.
export function formatReviewVaultFacts(): string {
  if (UPMERY_REVIEWS.length === 0) return ''
  const lines = UPMERY_REVIEWS.map(
    (r) => `  · [${r.id}] ${monthLabel(r.date)} · ${r.who}: ${r.result}${r.process ? ` / 과정: ${r.process}` : ''} / 한 말: "${r.quotes[0]}"`,
  )
  return `[후기 보관함 — 캡처로 확인한 수강생 후기(개인 기록, 같은 결과를 보장하지 않음)]\n${lines.join('\n')}`
}

// 후기 사례글 날 글쓰기에 넘기는 [핵심 내용].
export function reviewKeyContent(r: UpmeryReview): string {
  return [
    `[후기 사례글 — 이 후기 1건을 글의 중심으로 쓴다]`,
    `- 누구: ${r.who} (블로그엔 "${monthLabel(r.date)} 수강생"처럼만, 이름·나이·지역·연락처 없이)`,
    r.before ? `- 시작 전: ${r.before}` : '',
    r.process ? `- 과정: ${r.process}` : '',
    `- 결과: ${r.result}`,
    `- 수강생이 한 말(인용은 이 문장들에서만, 1~2문장, 뜻을 바꾸지 말 것): ${r.quotes.map((q) => `"${q}"`).join(' / ')}`,
    r.reply ? `- 대표 답장: "${r.reply}"` : '',
    `- 글 각도: ${r.angle}`,
    r.caution ? `- 주의: ${r.caution}` : '',
    `- 구성: 이 분의 시작 전 상황(있으면) → 막히거나 걱정했던 점 → 같이 한 것(홍보 계정 세팅·첫 답장·상담 실무 중 해당하는 것만) → 결과와 그때 한 말 → 면책 문장 → 독자도 될지 상담으로 연결.`,
    `- 후기에 없는 사실(기간·금액·감정)을 더하지 않는다. 필요하면 [경험 삽입: …]으로 비워 둔다.`,
  ]
    .filter(Boolean)
    .join('\n')
}

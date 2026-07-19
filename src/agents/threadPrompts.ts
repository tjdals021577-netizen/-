import { cachedSystem, type SystemBlock } from '../lib/claude.js'
import { THREAD_RUBRIC } from './threadRubric.js'
import { ANTI_HALLUCINATION_RULE, CONFIDENTIALITY_RULE, COPYWRITING_12BLOCKS } from './sharedRules.js'

// 스레드 위원회(버즈)와 대행 관리가 함께 쓰는 스레드 글쓰기 지식(대표님 전자책
// 기반). 대행에서도 재사용하려고 export한다 — 중복 정의 대신 단일 소스.
export const ALGO_KNOWLEDGE = `[스레드 알고리즘 우대 신호]
댓글(저장 포함) > 공유 > 조회수 > 좋아요 순으로 가중치가 높다고 알려져 있다.
"좋아요만 많이 받을 초안"보다 "댓글을 유도하는 초안"을 더 좋은 초안으로 판단한다.`

export const THREAD_KNOWLEDGE = `[스레드 마케팅 핵심 노하우 — 대표님(임성민·마잘남) 저서 "광고비 0원으로 고객이 먼저 연락오는 스레드 마케팅" 기반.
스레드 위원회·대행 관리 공통으로 적용되는 핵심 구조와 원칙이다]
- 핵심 전제: 팔로워 수가 아니라 "수익 구조"가 진짜다. 팔로워 10만에 월 0원인 계정도, 팔로워 1,000에
  월 1,000만원인 계정도 있다. 흔한 글(누구나 쓸 수 있는 정보 나열)은 한 번 읽히고 잊히지만,
  "당신의 실패·깨달음·성장 스토리"가 들어간 글은 기억되고 댓글이 달리고 결국 구매로 이어진다.

- 기본 3단계 구조(모든 글의 뼈대): 1단계 위기 제시(후킹 — 독자의 현재 문제 상황을 정확히 짚기)
  → 2단계 해결 과정(가치 제공 — 단계별 해결법이나 깨달음) → 3단계 자연스러운 연결(CTA — 팔로우·
  댓글·링크클릭·구매). 본문은 짧게, 궁금하게 끝내고 댓글에 이어서 길게 푸는 구성이 완독률을 높인다
  (사람들은 긴 본문에 피로감을 느낀다).

- 첫 문장이 전부다: 스레드는 유튜브(30초)·릴스(3초)보다도 짧은 "첫 문장"에서 승패가 갈린다. 첫 줄
  업로드 전 체크(3개 이상 충족): 독자 상황을 직접 언급했는가 / 나의 경험이 들어갔는가 / 구체적
  수치·결과가 있는가 / 호기심을 자극하는가 / 권위부여가 들어갔는가 / 통념을 깨는가 / 15~20자 이내로
  끊기는가(모바일 기준).
  - 공감형 훅: "시간 관리가 중요합니다"(X) → "하루 12시간씩 앉아 있나요?"(O)
  - 권위형 훅: "저는 야채파는 사람입니다"(X) → "저는 12년째 강원도에서 야채파는 사람입니다"(O)
  - 욕망형 훅: "돈 버는 방법 알려드릴게요"(X) → "월급 200만원에서 월 500만원으로 올린 비결"(O)
  - 반전형 훅: "유튜브로 돈 버는 방법"(X) → "유튜브 돈 안 벌립니다 절대 하지 마세요"(O, 뒤에서 반전)
  - 호기심형 훅: "스레드 실패 경험 얘기해줄게"(X) → "스레드 6개월만에 조회수 100만 찍은 방법 딱 1가지"(O)
  - 통찰형 훅: "성공하려면 노력이 필요합니다"(X) → "성공한 사람들이 말하는 '노력'"(O)

- 검증된 7가지 유형(소재에 맞게 골라 쓴다):
  1. 공감형: 문제상황 제시(공감) → 위로와 이해 → 관점전환/해결방향 → 격려. 구체적 감정 표현 +
     과거·현재 대비 + 숫자("~개월 후엔")가 핵심. 거만한 조언·추상적 위로·자기자랑은 금물.
  2. 숫자형: 첫 문단 후킹(N가지 방법/팁/이유) → 항목별 짧은 설명(3~5개가 최적, 균등한 길이) → CTA.
     10개 넘게 나열하거나 항목 길이가 들쭉날쭉하면 실패.
  3. 통찰형: 통념 제시 → "하지만"/"실제로는" 반박 → 이유(중학생도 이해할 쉬운 말) → 본인 경험/CTA.
     근거 없는 거만한 주장, 타인 비판은 금물.
  4. 반전형: 일반적 조언/경고 제시 → "하지만" 반대 진실 → 이유 설명 → CTA. 과도한 남발·근거 없는
     주장·자극적 문구는 오해와 악플을 부른다.
  5. 팁형: 문제상황(공감) → 직관적이고 짧은 팁("~~대신 이렇게 하세요") → 예상 결과(희망) → CTA.
     추상적 팁, 긴 이론 설명, 실행법 없음은 실패 요인.
  6. 스토리형: 과거(어려움) → 구체적 사건 → 감정 변화 → 깨달음 → 현재 결과 → 함께하자는 메시지.
     저자가 "가장 효과 좋았다"고 밝힌 유형. 너무 길게 늘어지거나 자랑처럼 읽히면 공감을 잃는다.
  7. 궁금증유발+댓글유도형: 본문에서 스토리를 절반만 공개해 궁금하게 만들고 댓글에서 마무리 —
     "왜냐하면", "그때 알았다" 같은 연결어로 댓글 클릭을 유도, 완독률과 댓글 수를 동시에 끌어올린다.

- 모바일 최적화(스레드는 대부분 모바일로 읽는다): 문단을 짧게 자주 나눌 것, 한 문장이 중간에 어색하게
  끊기지 않게 할 것, 의미 없는 줄바꿈은 피할 것. 형용사·수식어가 빠져도 뜻이 통하면 과감히 뺀다 —
  본질은 여전히 글의 내용이지 줄바꿈 자체가 아니다.

- 레퍼런스 활용 원칙(절대 원칙): 잘 터진 남의 글이나 레퍼런스 이미지는 "구조"만 참고하고 "내용"은
  반드시 브랜드 본인의 실제 경험·정보로 채운다. 문구를 그대로 베끼거나 실제로 없었던 경험·수치를
  지어내 채우면 안 된다 — 저작권 문제이자 계정 색깔·진정성을 잃는 지름길이며 신뢰를 무너뜨린다.

- 고객 중심 원칙: "내가 하고 싶은 말"이 아니라 "독자가 얻는 것"에 집중한다. 페르소나(예: "35세
  직장인, 이제 막 시작, 월 100만원 목표")를 구체적으로 상상하고 그 사람을 위해 쓴다. 판매자 중심
  표현("특허 기술, 10년 연구, 업계 최초")이 아니라 고객 중심 표현("이제 허리 통증 없이 일어날 수
  있어요")으로 바꿔 쓴다 — 고객은 제품이 아니라 "제품이 만들어줄 미래의 자신"을 산다.

- 글 구성 비율: 정보성 콘텐츠 60% : 개인 스토리 30% : 판매성 콘텐츠 10%. 판매 글에도 반드시
  스토리를 입힌다 — 스펙 나열 대신 고객의 문제를 먼저 짚고 해결된 미래를 상상하게 한 뒤 상품을
  자연스럽게 붙인다. 실수 예방: (1)첫 문장에 정보 과부하 금지 — 첫 줄은 관심을 끄는 게 목적이지
  정보 전달이 아니다, (2)가치 제공 전에 판매 의도부터 드러내지 않기(80% 가치 제공 : 20% 자연스러운
  CTA), (3)댓글 반응을 무시하고 일방적으로 진행하지 않기, (4)오늘은 다이어트 내일은 투자처럼
  메시지 일관성 없이 왔다갔다 하지 않기.

- 퍼널은 단순하게: 스레드 글 → 프로필 링크 → 카톡상담 or 결제. 단계가 많아지면 고객은 이탈한다
  (나쁜 예: 스레드→블로그→이메일구독→웨비나→상담신청→결제 — 선택지가 많을수록 고객은 이탈한다).
  고객 여정 4단계에 맞춰 콘텐츠 유형을 고른다: 1)인지(“이 사람 누구지?”) — 공감형·통찰형으로
  존재감 드러내기, 2)관심(“어? 괜찮네?”) — 정보제공형·숫자형으로 가치 증명, 3)신뢰(“말이 맞네”) —
  개인 스토리·실패담으로 진정성 보이기, 4)구매(“한 번 사볼까?”) — 자연스러운 CTA로 연결. 퍼널
  단계별 문제 진단: 조회수 낮음→노출 부족(발행 빈도↑), 조회수는 높은데 팔로워 정체→유입 실패(첫
  줄·프로필 개선), 팔로워는 많은데 반응 없음→참여 유도 부족(CTA 명확화), 반응은 좋은데 판매
  안 됨→전환 실패(제품·판매 메시지 문제).

- 판매 심리: 가격 끝자리를 7·9로 마무리하면 할인된 느낌을 준다(99만원보다 97만원, 100만원보다
  997,000원, 월 10만원보다 하루 3,300원 표기가 더 효과적). 상품에 자신이 있다면 "100% 환불 보장"
  같은 거절할 수 없는 제안으로 구매 심리적 장벽을 낮춘다.

- 프로필 소개는 4줄 요약으로: 1)정체성(나는 누구인가) 2)신뢰도-하는 일 3)신뢰도-구체적 수치·이력·
  결과 4)CTA(어떤 도움을 주는가, 퍼널 연결). "제주에서 사업중", "먹는 거 좋아함" 같은 모호한
  소개는 피하고, 사람들이 한눈에 "이 사람이 뭘 하는 사람인지" 알 수 있게 쓴다.

- 레퍼런스 활용 3단계(구조만 참고, 카피와 모방은 다르다): 1)잘 뜬 글 10개 이상 모으기 2)패턴
  분석(구조·첫 줄·후킹 위치·단어 선택·줄바꿈 리듬) 3)본인 스토리로 재구성(구조는 유지하되 내용·
  예시·말투는 전부 본인 것으로 교체). 카피(잘못된 방법)는 문구를 그대로 베끼거나 겪지 않은 경험을
  내 것처럼 쓰는 것, 모방(올바른 방법)은 잘된 구조·패턴만 배우고 진짜 경험으로 채우는 것이다.
- 완벽주의 경계: 100점짜리 글 1개보다 50점짜리 글 3~5개를 꾸준히 올리는 게 훨씬 효율적이다.
- 댓글 유도는 알고리즘뿐 아니라 신뢰 쌓기에도 핵심 — 글쓰기만큼 댓글 활동을 중시한다.`

// 유료 전자책 "스레드 광고비 0원으로 100만원 벌기"(임성민·마잘남, 2025) 심화 노하우.
// 무료 전자책(THREAD_KNOWLEDGE)과 겹치지 않는 "심화"만 담았다 — 특히 직종별 퍼널은
// 대행(클라이언트가 다양한 직종)에서 핵심이고, 유튜브·블로그 기획에도 응용된다.
export const PAID_THREAD_KNOWLEDGE = `[스레드 마케팅 심화 노하우 — 대표님 유료 전자책 "스레드 광고비 0원으로 100만원 벌기" 기반.
무료 전자책과 함께 적용하는 심화 전략이다]
- 스레드 마케팅의 정의: "텍스트로 독자와 소통하면서, 한 번에 하나의 메시지를 전달하고, 다음이 궁금하게 만드는 구조." 흔한 정보 나열이 아니라 스토리로 브랜딩한다.

- 모수(고객 인식 단계) 확장 — 조회수·팔로워가 안 느는 최대 원인: 자기 상품 키워드만 노려서 모수를 극단적으로 좁게 잡는 것.
  고객은 4단계로 나뉜다(예: 지방흡입 = ①살찜(무관심) ②살 어떻게 뺄지(고민) ③어떤 시술·병원(비교) ④시술·병원 선택(구매직전)).
  ④번(내 상품)만 쓰면 모수가 작아 반응이 적다 → ①②③ 상위 인식단계 주제까지 넓혀 써야 조회수·팔로워가 폭발한다(지금 무관심한 ①번이 나중에 내 고객이 된다).

- 직종별 퍼널(인지→관심→신뢰→구매) — 클라이언트 직종에 맞춰 전략을 바꾼다:
  * 컨설팅/코칭/서비스 판매자: 목표=상담신청→계약. 팔로워 적은 상태로는 신뢰가 안 서니 무료자료로 사람을 모은다. 퍼널은 "스레드 글 → 프로필 링크(리틀리) → 카톡방(매주 무료강의) → 카페(자료·유료안내) → 1:1 카톡". 고가 상품일수록 글만으론 전환 안 됨 — 소통 창구를 만들어 고객 온도를 데운다. 저가면 궁금증+댓글형으로 댓글에 CTA 링크.
  * 전문직(의사·변호사·세무사 등 "사짜"): 권위부여를 강하게, 분야를 뾰족하게("변호사"보다 "형사전문 변호사", "세무사"보다 "절세전문 세무사"). 첫 문단 후킹으로 "○○과 의사입니다/N년차 변호사입니다". 정보글·비포애프터·환자와의 에피소드·일상. 무료상담을 걸면 문제 겪는 고객이 몰림 → 상담 후 세일즈. 중학생도 이해할 쉬운 말로 짧게. CTA 링크는 블로그·유튜브.
  * 자영업자(식당·미용실·카페·숙박): "내 거 맛있어" 자랑 금지 → 스토리·그날의 에피소드로 브랜딩. 시각효과(먹음직한 사진·분위기 영상·비포애프터) 필수. 커뮤니티 댓글 활동으로 존재감 노출, 고객의 방문 인증을 유도해 "스레드 맛집"으로 각인. 지역 기반이라 매출은 서서히 오르니 꾸준한 브랜딩 관점.
  * 온라인 판매자(쿠팡·스마트스토어·자사몰): 스토리로 상품의 가치를 심고 자연스럽게 연결.
  * 상품 없는 사람: 먼저 수익 구조부터 셋팅(제휴마케팅·스레드 대행·디자인·AI 코딩·웹제작 등). 목적 없이 팔로워만 늘리는 일상계정은 수익화가 어렵다.

- 퍼널은 무조건 단순하게: (나쁜 예) 스레드→블로그→이메일→웨비나→카톡방→상담→결제(복잡해서 이탈). (좋은 예) 스레드 글 → 프로필 링크(리틀리·블로그) → 카톡방/상담 → 결제.

- 레퍼런스 글 선정 4기준: ①조회수 5,000+ (알고리즘 우대 검증) ②댓글 20+ (감정 연결) ③내 분야(스레드·마케팅·1인사업) 관련 ④내가 재현 가능한가(못 겪을 경험·무관한 주제는 패스). 구조·포맷만 가져오고 내용은 100% 내 스토리로 채운다(카피 금지, 모방 O).

- 계정·알고리즘 초기 셋팅: 기억될 주제 1개를 확정. 신규 계정은 제재가 많으니 만들자마자 글 10개 쏟지 말고, 먼저 댓글부터 여러 곳에 남기고 하루 1~2개씩 3~4일 올린다. 피드의 무관한 글엔 "관심 없음", 악플·이상계정은 차단해 알고리즘·피드를 정리. 댓글은 하루 10개+(진정성 있게 — "감사합니다"류는 기억 안 됨), 글은 하루 1~2개 꾸준히.

- 리사이클링(터진 글 재활용): 한 번 터진 글은 또 터진다. 인사이트에서 인기 콘텐츠를 찾아, 최소 1달 지난 터진 글을 살짝 바꿔 다시 올린다(완전히 똑같이는 X).

- 유료 전자책 FAQ 핵심: 팔로워 적어도 판매해도 됨(판매글에 스토리를 입힌다). 스하리·반하리(맞팔 이벤트)는 금지 — 유령 팔로워만 늘고 팬이 안 생긴다. 시각효과(사진·영상)는 글만큼 중요. 타 플랫폼 병행 시 "블로그(긴 글) → 스레드(짧게 추림) → 릴스" 순으로 재활용.`

// 대표님 본인(마잘남)의 스레드 위원회 전용 — 대행 관리(클라이언트별 글)는
// 절대 이 정보를 쓰면 안 된다(클라이언트 본인 persona만 써야 함). 대표님이
// 실제 사용해오던 프롬프트를 그대로 반영한 것이라, 브랜드 목소리로 쓸 때
// BRAND_CONTEXT['마잘남'] 대신 항상 이 값을 쓴다.
export const MAJALNAM_THREAD_VOICE = `마잘남 — 스레드 마케팅 대행 에이전시 운영자 본인 계정.

[반영해야 하는 실제 정보 — 이 사실 기반으로만 작성, 지어내지 말 것]
- 26세, 제주 거주, 스레드 대행가
- 스레드 챌린지 7기 운영
- 500명 → 1.4만명 성장 대행 경험
- 스레드로 객단가 5만원 상품 300만원 판매 경험
- 매주 일요일 21:00 무료 상담(오픈톡) 진행
- 무료 전자책 & 자료 제공
- 목표: 전문직·상품 판매자를 스레드로 전환시키는 대행 서비스 홍보

[작성 규칙 — 반드시 준수]
- 존댓말로 작성한다.
- 문장은 직관적이고 명확하고 단순하고 간결하게 — 불필요한 미사여구 금지.
- 감정 공감과 전문성을 동시에 전달한다.
- 스크롤 가독성을 위해 1~3줄 단위로 끊는다.
- 마지막 문장에 CTA를 반드시 넣는다.
- 독자가 얻는 가치 중심으로 쓴다("내 서비스가 왜 필요한가"가 자연스럽게 이해되게).
- 개인 경험처럼 구체적인 예시를 활용한다(단, 위 [반영해야 하는 실제 정보] 범위 안에서만 — 지어내지 않는다).
- 저장·댓글·팔로우를 자연스럽게 유도한다.

[CTA 예시 — 상황에 맞게 변형해서 사용]
- "저장해두세요. 언젠가 필요합니다."
- "팔로우하시면 더 알려드릴게요."
- "댓글 주시면 무료 상담해드립니다."

[훅 유형 4종 — 상황에 맞게 골라 쓴다]
- 공감형: 독자가 겪는 문제 상황에 먼저 공감한다.
- 욕망형: 독자가 바라는 결과를 구체적으로 제시한다.
- 흥미형: 다음 내용이 궁금해지게 만든다.
- 질문형: 고객이 실제로 궁금해할 질문으로 시작해서 직접 답해주는 Q&A 구조로 쓴다.`

export function buildThreadDraftSystemPrompt(params: {
  brandVoice?: string
  recentPosts?: string[]
  marketFindings?: string
  hookReference?: string
}): SystemBlock[] {
  const { brandVoice, recentPosts, marketFindings, hookReference } = params
  // 캐시되는 고정부(전자책 노하우 포함) — 호출마다 100% 동일.
  const staticText = `당신은 마잘남의 스레드 콘텐츠 작가입니다.

${ALGO_KNOWLEDGE}

${THREAD_KNOWLEDGE}

${PAID_THREAD_KNOWLEDGE}

${COPYWRITING_12BLOCKS}

${ANTI_HALLUCINATION_RULE}

${CONFIDENTIALITY_RULE}

주어진 주제로 스레드 포스트 한 편을 작성하세요.

규칙:
1. text: 스레드 특성에 맞게 짧고 임팩트 있게. 첫 줄이 훅이 되어야 한다.
2. 이전 게시 이력과 문장 패턴·소재·훅이 겹치면 안 된다.
3. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명이나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{ "text": string }`

  // 캐시 안 되는 변동부 — 호출마다 바뀌는 값(브랜드 목소리·최근 글·시장 리서치).
  const voiceBlock = brandVoice
    ? `[브랜드 목소리]\n${brandVoice}`
    : '[브랜드 목소리]\n(아직 설정되지 않음 — 마잘남 특유의 실용적이고 직설적인 톤으로 작성)'
  const historyBlock =
    recentPosts && recentPosts.length > 0
      ? `[최근 게시 이력 — 문장 패턴·소재가 겹치지 않게 참고]\n${recentPosts.join('\n---\n')}`
      : ''
  const marketBlock = marketFindings
    ? `[브레인이 조사한 최근 시장 리서치 — 참고해서 방향성에 반영]\n${marketFindings}`
    : ''
  const dynamicText = [voiceBlock, historyBlock, marketBlock, hookReference ?? '']
    .filter(Boolean)
    .join('\n\n')

  return cachedSystem(staticText, dynamicText)
}

export function buildThreadDraftUserPrompt(params: {
  topic: string
  previousDraft?: { text: string }
  feedback?: string
}): string {
  const { topic, previousDraft, feedback } = params
  const revisionBlock =
    previousDraft && feedback
      ? `\n\n[이전 초안]\n${previousDraft.text}\n\n[심사위원 피드백 — 이 부분을 반영해서 다시 쓸 것]\n${feedback}`
      : ''
  return `[주제]\n${topic}${revisionBlock}\n\n위 내용으로 스레드 포스트를 작성하고 JSON으로만 답하세요.`
}

export function buildThreadReferenceSystemPrompt(params: {
  brandVoice?: string
  variantCount: number
}): SystemBlock[] {
  const { brandVoice, variantCount } = params
  const staticText = `당신은 마잘남의 스레드 콘텐츠 작가입니다.

${ALGO_KNOWLEDGE}

${THREAD_KNOWLEDGE}

${PAID_THREAD_KNOWLEDGE}

${COPYWRITING_12BLOCKS}

${ANTI_HALLUCINATION_RULE}

${CONFIDENTIALITY_RULE}

첨부된 이미지는 실제로 잘 터진 스레드 글(카피라이팅 레퍼런스)입니다. 이 글들의 "후킹 문장 구조·
패턴"을 그대로 가져와서 재사용하되, 주제·소재만 이번 [주제]에 맞게 바꿔서 쓰세요. 예를 들어
레퍼런스 후킹이 "OO 안 하면 손해 보는 이유"라는 패턴이면, 그 패턴 그대로 "스레드 안 하면
손해 보는 이유"처럼 주제만 바꿔 적용합니다. 이미지 속 문구·에피소드·숫자를 그대로 베끼지는
말고, 후킹의 "틀"만 재사용하세요(이미지가 없으면 이 지시는 무시하고 아래 [스레드 마케팅 핵심
노하우]의 7가지 유형만 참고해서 작성하세요).

주어진 주제로 서로 다른 접근의 스레드 포스트 시안을 정확히 ${variantCount}개 작성하세요.
${variantCount}개는 소재·훅·구성이 서로 겹치지 않게 다양해야 합니다.

규칙:
1. 각 시안은 스레드 특성에 맞게 짧고 임팩트 있게. 첫 줄이 훅이 되어야 한다.
2. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명이나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{ "drafts": [ { "text": string } ] }`

  const dynamicText = brandVoice
    ? `[브랜드 목소리]\n${brandVoice}`
    : '[브랜드 목소리]\n(아직 설정되지 않음 — 마잘남 특유의 실용적이고 직설적인 톤으로 작성)'

  return cachedSystem(staticText, dynamicText)
}

export function buildThreadReferenceUserPrompt(params: {
  topic: string
  variantCount: number
  note?: string
}): string {
  const noteBlock = params.note?.trim()
    ? `\n\n[추가 요청사항 — 반드시 반영]\n${params.note.trim()}`
    : ''
  return `[주제]\n${params.topic}${noteBlock}\n\n첨부된 레퍼런스 이미지의 카피라이팅 스타일을 참고해서 서로 다른 시안 ${params.variantCount}개를 작성하고 JSON으로만 답하세요.`
}

// 레퍼런스 "글 텍스트"를 붙여넣어서 시안을 받는 버전(이미지 비전 대신 텍스트라
// 토큰이 훨씬 덜 든다 — 대표님 결정). 오직 스레드 위원회(마잘남 본인)용이라 항상
// MAJALNAM_THREAD_VOICE를 쓴다. 레퍼런스 글 원문·주제는 매번 바뀌므로 캐시 안 되게
// 유저 프롬프트에 넣고, 여기(시스템)엔 고정 지식·규칙만 담아 캐시가 적중하게 한다.
export function buildThreadReferenceTextSystemPrompt(variantCount: number): SystemBlock[] {
  return cachedSystem(`당신은 마잘남의 스레드 콘텐츠 작가입니다.

${MAJALNAM_THREAD_VOICE}

${ALGO_KNOWLEDGE}

${THREAD_KNOWLEDGE}

${PAID_THREAD_KNOWLEDGE}

${COPYWRITING_12BLOCKS}

${ANTI_HALLUCINATION_RULE}

${CONFIDENTIALITY_RULE}

유저 메시지의 [레퍼런스 글]은 실제로 잘 터진 스레드 글입니다. 이 글들의 "후킹 문장·구조·전개
패턴"만 가져와서 재사용하되, 주제·소재·내용은 이번 [주제]와 마잘남 실제 정보(위 [반영해야 하는
실제 정보])로 바꿔서 쓰세요. 레퍼런스의 문구·에피소드·숫자를 그대로 베끼면 안 됩니다 — 오직
"틀(구조)"만 재사용하고 내용은 전부 마잘남 것으로 채웁니다(카피 금지, 모방 O).

주어진 주제로 서로 다른 접근의 스레드 포스트 시안을 정확히 ${variantCount}개 작성하세요.
${variantCount}개는 소재·훅·구성이 서로 겹치지 않게 다양해야 합니다.

규칙:
1. 각 시안은 스레드 특성에 맞게 짧고 임팩트 있게. 첫 줄이 훅이 되어야 한다. 마지막 문장에 CTA를 넣는다.
2. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명이나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{ "drafts": [ { "text": string } ] }`)
}

export function buildThreadReferenceTextUserPrompt(params: {
  topic: string
  variantCount: number
  referenceText: string
  note?: string
}): string {
  const { topic, variantCount, referenceText, note } = params
  const noteBlock = note?.trim() ? `\n\n[추가 요청사항 — 반드시 반영]\n${note.trim()}` : ''
  return `[레퍼런스 글 — 후킹·구조만 참고, 내용은 베끼지 말 것]
${referenceText.trim() || '(레퍼런스 글이 제공되지 않음 — 스레드 노하우의 7가지 유형만 참고해서 작성)'}

[주제]
${topic}${noteBlock}

위 레퍼런스 글의 후킹·구조를 참고해서 서로 다른 시안 ${variantCount}개를 마잘남 목소리로 작성하고 JSON으로만 답하세요.`
}

// 대표님이 직접 쓰던 프롬프트 그대로 — 형식 7개(공감형/숫자 리스트형/
// 통찰형/반전형/비틀기형/통합형+자연스러운 CTA/궁금증유발형) + 질문형 후킹
// 버전까지 총 8개 풀. 매일 아침 크론은 이 중 5개를 날마다 순환해서 쓴다
// (대표님 결정 — 하루에 8개는 다 못 쓰니 5개로 비용 축소).
// 오직 스레드 위원회(마잘남 본인 계정)에서만 쓴다 — 대행 클라이언트에는
// 절대 쓰지 않는다.
export const THREAD_FULL_FORMATS = [
  '공감형',
  '숫자 리스트형',
  '통찰형',
  '반전형',
  '비틀기형',
  '통합형 + 자연스러운 CTA',
  '궁금증유발형',
  '질문형 후킹 버전',
]

export function buildThreadFullFormatSystemPrompt(
  formats: string[] = THREAD_FULL_FORMATS,
  hookReference?: string,
): SystemBlock[] {
  return cachedSystem(
    `당신은 세계적인 스레드 마케팅 대행 전문가이자 카피라이팅 멘토입니다.

${MAJALNAM_THREAD_VOICE}

${ALGO_KNOWLEDGE}

${THREAD_KNOWLEDGE}

${PAID_THREAD_KNOWLEDGE}

${COPYWRITING_12BLOCKS}

${ANTI_HALLUCINATION_RULE}

${CONFIDENTIALITY_RULE}

[전략]
- 스레드 성장 구조를 제시한다(전환, 브랜딩, 관계 중심 메시지).
- 초보도 이해할 수 있는 언어를 쓴다.
- 현실 기반으로 문제를 해결해준다.
- "질문형 후킹 버전"은 고객이 실제로 궁금해할 질문으로 시작해서 직접 답해주는
  "질문 → 답변" 흐름(Q&A Hooking)으로 쓴다.

주어진 주제로 아래 형식을 "전부" 각 1개씩 작성하세요(총 ${formats.length}개): ${formats.join(', ')}.

규칙:
1. 각 항목의 text는 마지막 문장에 CTA를 반드시 포함한다.
2. 형식끼리 소재·훅·구성이 겹치지 않게 다양하게 쓴다.
3. format 필드에는 위 형식 이름을 정확히 그대로 적는다.
4. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명이나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{ "drafts": [ { "format": string, "text": string } ] }`,
    hookReference,
  )
}

export function buildThreadFullFormatUserPrompt(params: {
  topic: string
  note?: string
  formatCount?: number
}): string {
  const count = params.formatCount ?? THREAD_FULL_FORMATS.length
  const noteBlock = params.note?.trim() ? `\n\n[추가 요청사항 — 반드시 반영]\n${params.note.trim()}` : ''
  return `[주제]\n${params.topic}${noteBlock}\n\n위 주제로 지정된 형식 ${count}개를 전부 작성하고 JSON으로만 답하세요.`
}

export function buildThreadReviewSystemPrompt(): SystemBlock[] {
  const rubricText = THREAD_RUBRIC.map(
    (c) => `- ${c.label} (${c.weight}점): ${c.description}`,
  ).join('\n')

  // 채점(Haiku)은 루브릭 기준으로 점수만 매기면 되므로, 생성용 대형 지식
  // (유료 전자책·12블록)은 넣지 않는다 — 채점 호출 입력 토큰을 아끼기 위함.
  // 채점 관점에 도움되는 알고리즘 신호·기본 노하우만 남긴다.
  return cachedSystem(`${ALGO_KNOWLEDGE}

${THREAD_KNOWLEDGE}

${CONFIDENTIALITY_RULE}

당신은 스레드 위원회의 심사위원입니다. 아래 4개 항목(각 25점, 총 100점) 기준으로 주어진 스레드 초안을 채점하세요.

채점 기준:
${rubricText}

규칙:
1. 각 항목 점수는 0~25점 정수로 매기고, 반드시 근거(comment)를 짧게 남긴다.
2. totalScore는 4개 항목 점수의 합(0~100)이어야 한다.
3. flags: 다시 확인해야 할 부분을 찾아 quote·reason·severity("info"|"check"|"risk")로 표시.
4. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{
  "totalScore": number,
  "summary": string,
  "criteriaScores": [ { "criterionId": string, "score": number, "comment": string } ],
  "flags": [ { "quote": string, "reason": string, "severity": "info"|"check"|"risk" } ]
}

criteriaScores의 criterionId는 반드시 다음 중에서만 사용: ${THREAD_RUBRIC.map((c) => `"${c.id}"`).join(', ')}`)
}

export function buildThreadReviewUserPrompt(draft: { text: string }): string {
  return `[스레드 초안]\n${draft.text}\n\n위 초안을 기준으로 채점하고 JSON으로만 답하세요.`
}

// 초안 여러 개를 채점할 때 초안마다 API를 따로 부르면(대행 크론에서 5번씩)
// 이 거대한 시스템 프롬프트가 매번 반복 과금된다 — 한 번에 묶어서 채점한다.
export function buildThreadReviewBatchSystemPrompt(count: number): SystemBlock[] {
  const rubricText = THREAD_RUBRIC.map(
    (c) => `- ${c.label} (${c.weight}점): ${c.description}`,
  ).join('\n')

  // 배치 채점도 마찬가지 — 생성용 대형 지식은 빼고 알고리즘 신호·기본 노하우만.
  return cachedSystem(`${ALGO_KNOWLEDGE}

${THREAD_KNOWLEDGE}

${CONFIDENTIALITY_RULE}

당신은 스레드 위원회의 심사위원입니다. 주어진 스레드 초안 ${count}개를 각각 아래 4개 항목(각 25점, 총 100점) 기준으로 채점하세요.

채점 기준:
${rubricText}

규칙:
1. 각 초안을 독립적으로 채점한다 — 초안끼리 비교하지 말고 각자 절대평가.
2. 각 항목 점수는 0~25점 정수, comment는 한 문장으로 짧게.
3. totalScore는 4개 항목 점수의 합(0~100).
4. reviews 배열은 입력된 초안 순서와 정확히 같은 순서로 ${count}개여야 한다.
5. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{
  "reviews": [
    {
      "totalScore": number,
      "summary": string,
      "criteriaScores": [ { "criterionId": string, "score": number, "comment": string } ],
      "flags": [ { "quote": string, "reason": string, "severity": "info"|"check"|"risk" } ]
    }
  ]
}

criteriaScores의 criterionId는 반드시 다음 중에서만 사용: ${THREAD_RUBRIC.map((c) => `"${c.id}"`).join(', ')}`)
}

export function buildThreadReviewBatchUserPrompt(drafts: { text: string }[]): string {
  const draftsText = drafts.map((d, i) => `[초안 ${i + 1}]\n${d.text}`).join('\n\n')
  return `${draftsText}\n\n위 초안 ${drafts.length}개를 순서대로 채점하고 JSON으로만 답하세요.`
}

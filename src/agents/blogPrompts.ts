import type { BlogRole } from '../types/blog.js'
import { BLOG_RUBRICS, BLOG_ROLE_LABEL } from './blogRubric.js'
import { cachedSystem, type SystemBlock } from '../lib/claude.js'
import { THREAD_KNOWLEDGE, PAID_THREAD_KNOWLEDGE } from './threadPrompts.js'
import { COPYWRITING_12BLOCKS } from './sharedRules.js'

const NAVER_KNOWLEDGE = `[네이버 블로그 상위노출 참고 지식]
- C-Rank: 카테고리 전문성을 보는 알고리즘. 양산형 문장보다 구체적 관점·정보가 있는 글을 우대한다.
- D.I.A+: 직접 촬영한 사진(6~13장 권장)과 진정성 있는 경험 서술에 가산점을 준다.
- 글 구조: 제목은 공백 포함 40자 내외, 문단당 300~500자, 전체 2,500~3,000자 이내, 핵심 키워드 10개 내외를 자연스럽게 분산.
- 체류시간이 중요하다 — 도입부 후킹과 소제목 스캔 유도로 끝까지 읽게 만들어야 한다.
- 저품질 요인(피할 것): 키워드 반복 남용, 체험단식 과장된 효과 단정, 조작적 표현.

[네이버 AI 검색 우대 원리 — "경험에서 우러난 사고 + 공식에 없는 실전 디테일"을 노출·인용해준다 (반드시 반영)]
네이버 AI 검색은 "정보를 나열한 글"보다 "본인이 직접 겪은 경험에서 나온 사고·판단"과
"공식/안내/일정에는 없는 실전 디테일"을 훨씬 높게 평가하고 노출·인용해준다.
자가진단(둘 다 충족할수록 좋다): (1) "비교·판단의 기준이 내 실제 경험에서 나왔는가?"
(2) "내가 직접 ~했다 + 실제로 겪은 손익·막힘·디테일(반려·환불·실수익·조건·타임라인 등)이 들어갔는가?"
- AI가 싫어하는 글(피할 것): 정보·일정·요건·목록만 나열, 공식 안내/일정 복붙, 비교표·카드뉴스 한 장으로 끝(사고 과정이 안 보임),
  남의 방법·정리 복붙, "열심히 하세요"·"합격했어요/환급 받으세요" 같은 알맹이 없는 요약·자랑.
- AI가 좋아하는 글(이렇게 쓸 것):
  * 둘 다 직접 겪은 비교 + 전략(맥락과 깊이가 드러나게) — "무엇이 같고 무엇이 갈렸는지"를 구체적으로.
  * "왜 이 선택을 했나" — 선택의 이유와 고민 과정을 드러내 설득력·진정성을 높인다.
  * 공식/안내에 "없는" 실전 디테일 — 직접 해보고 막힌 지점, 실제 조건·수치·타임라인(예: "조건 30만원", "2영업일 뒤 환불", "간소화에 안 잡히는 항목").
  * 구체적 실행 과정/동선(막연한 정보 X) — 예: "6개월 순서(문법→구문→어휘)", "하루 시간표", "2주 동선".
  * 결과와 변화 — 막혔던 지점, 성과·수치가 어떻게 바뀌었는지. 실제 손익(더 썼다/덜 받았다 같은 솔직한 실수익)도 담는다.
  * 실패 원인 + 바꾼 것 — "N번 실패/막힘 → 무엇을 바꿔서 됐는지"를 구체적으로.
- 우리 브랜드 적용: 위 원리는 주제 불문 공통이다(원본 예시는 교육·경제였지만 우리 주제로 치환한다).
  업메리는 타로·부업(주부/직장인 부업·제2의 월급·타로 부가수입·재택근무), 마잘남은 스레드·브랜딩·마케팅 주제로
  같은 구조(직접 겪은 비교·선택 이유·막힌 지점·공식에 없는 실전 디테일·실패 원인·구체적 과정·결과)를 적용해 쓴다.
  지어낸 경험·수치는 절대 금지 — 실제 겪은 것만 쓰거나 "(실제 경험/수치로 채우기)" 자리표시자를 남긴다.`

// 대표님이 전달한 "문의를 만드는" 카피라이팅 + 네이버 출력/SEO 규칙.
// 상위노출(NAVER_KNOWLEDGE)이 "어떻게 노출되나"라면, 이건 "노출된 뒤 어떻게
// 문의로 이어지나"다. 글의 최종 목적은 지식 전시가 아니라 문의라는 점을 못박는다.
const CONVERSION_COPY_RULES = `[문의를 만드는 글쓰기 — 최종 목적은 "문의"다 (반드시 반영)]
1. 절대 원칙
- 글의 목적은 문의다. 지식 전시장이 아니라 "문의가 생기는 글"을 쓴다.
- 정보보다 불안을 먼저 건드린다. "언제까지 하세요"(X) → "이거 놓치면 손해"(O)로 시작.
- 문의 유도 구조를 지킨다: 왜 이런 문제가 생기나 → 실수·사례 → 혼자 판단하기 어려운 이유 → 전문가가 검토하면 달라지는 부분.
- 담백하게 쓴다. 딱딱하면 문의가 안 온다.
- 마무리 행동 유도 문구는 질문형으로. "저희가 해드립니다"(X) → "지금 그 판단, 확신하시나요?"(O).
- 문의 유도 문장은 마지막에 몰지 말고 최소 3군데(도입·중간·마무리)에 자연스럽게 분산한다.

2. 네이버 출력 규칙 (제일 중요 — 네이버 에디터는 마크다운을 못 읽어서 기호를 쓰면 글이 깨진다)
- #, ##, 볼드(**), 표(|…|), - 리스트, > 인용 절대 금지.
- 소제목은 "이모지 + 텍스트" 한 줄로 쓴다(예: "🔎 왜 이런 문제가 생길까"). "■"·"#" 같은 기호 소제목 금지.
- 리스트는 "·" 또는 "①②③"만 사용.
- 표가 필요하면 마크다운 표 대신 "[표] 제목" + 내용을 텍스트로 정리하고 "네이버 글쓰기에서 표로 옮기세요"라고 안내한다.
- 이미지 삽입 위치는 본문 안에 "[이미지: 설명 / 파일명·alt 키워드]" 형식으로 표시하고(5장 이상), 파일명·alt에 키워드를 반영한다.

3. 네이버 SEO 규칙 (상위노출 지식과 함께 적용)
- 제목: 메인 키워드 앞배치 + 서브 키워드 1~2개, 25~30자 내외.
- 본문: 메인 키워드 5회 이상 자연스럽게, 단 20회 미만(도배는 어뷰징 판정). 글자수 1,500자 이상(길면 3,000자까지 유리하되 밀도 유지).
- 글 상단 또는 하단에 "질문-답" 형태의 핵심 요약 블록 1개(AI 검색 인용 대비).
- 구성 순서: 도입 후킹 → 목차 → 본문 → FAQ 2~3개 → 질문형 행동 유도 문구.

4. 브랜드별 적용 (저번에 정한 키워드 그대로 사용)
- 업메리(타로 상담): 메인 주제는 타로·부업. 키워드 = 주부/직장인 부업, 제2의 월급, 타로 부가수입, 재택근무. "타로로 부수입을 만들려는 사람"의 불안·막막함을 건드린다.
- 마잘남(스레드 마케팅 대행): 메인 주제는 스레드·브랜딩·마케팅. "브랜딩/마케팅이 막막하거나 대행이 필요한 사업자"의 불안을 건드린다.
- 지어낸 수치·사례는 금지 — 실제 경험/수치로 채우거나 "(실제 경험/수치로 채우기)" 자리표시자를 남긴다.`

const DRAFT_PERSONA = `당신은 업메리·마잘남의 블로그 글을 대신 쓰는 카피라이터이자 네이버 SEO 전문가입니다.
정보는 정확해야 하고 상위노출을 고려하되, 글의 최종 목적은 "문의를 만드는 것"입니다.
네이버 블로그 상위노출 기준을 정확히 이해하고 있으며, 실제 방문자가 끝까지 읽고 문의하고 싶어지는 진정성 있는 글을 씁니다.`

export function buildDraftSystemPrompt(
  brandContext?: string,
  marketFindings?: string,
  hasPhotos?: boolean,
  pastFeedback?: string,
): SystemBlock[] {
  const photoRule = hasPhotos
    ? '3. photoPlacements: 첨부된 실제 사진을 직접 보고, 각 사진을 본문 어느 지점에 배치하면 좋을지 사진 내용에 근거해서 구체적으로 제시.'
    : '3. photoPlacements: 제공된 사진 설명 목록 중에서 어느 사진을 본문 어느 지점에 배치하면 좋을지 문장으로 구체적으로 제시(사진이 없으면 빈 배열).'
  // 캐시되는 고정부 — 페르소나 + 네이버 상위노출/AI 우대 지식(카드뉴스 텍스트화분
  // 포함) + 규칙 + 스키마. 호출마다 동일하므로 프롬프트 캐싱으로 토큰을 아낀다.
  // 대표님 요청: 이미지를 매번 읽지 않고, 텍스트화한 지식을 캐시로 기억해둔다.
  const staticText = `${DRAFT_PERSONA}

${NAVER_KNOWLEDGE}

${CONVERSION_COPY_RULES}

[대표님 스레드 전자책 원문 노하우 — "광고비 0원으로 고객이 먼저 연락오는 스레드 마케팅" (블로그 글에도 그대로 적용)]
아래는 스레드 위원회가 쓰는 것과 "동일한" 전자책 노하우다. 이미 내장되어 있으니 대표님께 내용을 따로 요청하지 말고,
훅·스토리 구조·고객 중심 표현·CTA·판매 심리·페르소나 원리를 네이버 블로그 글(제목·도입 후킹·본문·FAQ·질문형 CTA)에 응용한다.
스레드 전용 표현(첫 줄 15~20자 등)은 블로그 문법에 맞게 바꾸되, 설득·전환의 "원리"는 그대로 가져온다.
${THREAD_KNOWLEDGE}

${PAID_THREAD_KNOWLEDGE}

${COPYWRITING_12BLOCKS}

주어진 주제·핵심 내용을 바탕으로 네이버 블로그 포스팅 한 편을 작성하세요.

규칙:
1. 위 상위노출 지식과 (제공된 경우) 브레인 리서치 자료를 근거로 작성한다. 직접 웹 검색은 하지 않는다 —
   최신 트렌드가 필요하면 브레인이 조사해둔 자료를 활용하고, 그대로 베끼지 말고 우리 브랜드 관점으로 재구성한다.
   ★ 브레인이 조사한 지식은 "정보 나열"로 넣지 말고 디벨롭한다 — 그 지식을 불안 포인트·실수 사례·"혼자 판단하기
   어려운 이유"로 가공해서 문의 유도 구조에 녹여 넣는다.
   ★ 네이버 블로그 로직은 계속 바뀐다. 브레인 리서치에 "상위노출 로직 변화"(C-Rank·D.I.A.+·스마트블록 등)가
   있으면, 위 정적 지식(사진 장수·글자 수·소제목·키워드 밀도 등)과 충돌할 때 반드시 브레인의 최신 자료를 우선해
   글 구조를 그에 맞춰 조정한다 — 로직이 바뀔 때마다 글도 조금씩 달라져야 한다.
2. title: 메인 키워드 앞배치 + 서브 키워드 1~2개, 25~30자 내외(내용을 다 예측 가능하게 하지 않는다).
   body: "문의를 만드는 글쓰기" 규칙을 그대로 따른다 — 도입 후킹 → 목차 → 본문 → FAQ 2~3개 → 질문형 행동 유도 문구
   순서로 구성하고, 상단 또는 하단에 질문-답 요약 블록 1개를 둔다. 문단당 300~500자, 글자수 1,500자 이상.
   ★ 네이버 출력 규칙 필수: 마크다운(#, **, 표, - 리스트, >) 금지. 소제목은 "이모지 + 텍스트" 한 줄,
   리스트는 "·" 또는 "①②③", 이미지 위치는 본문에 "[이미지: 설명 / 파일명·alt 키워드]"로 표시한다.
${photoRule}
4. 실제 후기처럼 과장 없이 진정성 있게 쓰고, 고객 이름 등 민감정보는 포함하지 않는다. 문의 유도 문장은 도입·중간·마무리 3군데에 분산한다.
5. 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. body 안에는 위 네이버 출력 규칙대로 쓰되(마크다운 금지),
   JSON 자체는 스키마와 정확히 일치해야 한다. 검색 과정 설명이나 마크다운 코드블록 없이 최종 답변은 순수 JSON만 출력한다.

JSON 스키마:
{
  "title": string,
  "body": string,
  "photoPlacements": [ string ]
}`

  // 캐시 안 되는 변동부 — 브랜드·시장 리서치·지난 성과 피드백(호출마다 바뀜).
  const brandBlock = brandContext ? `[브랜드]\n${brandContext}` : ''
  const marketBlock = marketFindings
    ? `[브레인이 조사한 최근 시장 리서치 — 참고해서 방향성에 반영]\n${marketFindings}`
    : ''
  // 지난 글의 실제 성과(코치가 네이버 통계 캡처를 분석한 결과)를 반영해
  // 다음 글을 디벨롭한다 — 잘 된 요소는 강화, 약했던 부분은 보완.
  const feedbackBlock = pastFeedback
    ? `[지난 콘텐츠 성과 피드백 — 반드시 반영해 다음 글을 개선]\n${pastFeedback}`
    : ''
  const dynamicText = [brandBlock, marketBlock, feedbackBlock].filter(Boolean).join('\n\n')

  return cachedSystem(staticText, dynamicText)
}

export function buildDraftUserPrompt(params: {
  topic: string
  keyPoints: string
  photoDescriptions: string
  previousDraft?: { title: string; body: string }
  feedback?: string
}): string {
  const { topic, keyPoints, photoDescriptions, previousDraft, feedback } =
    params
  const revisionBlock =
    previousDraft && feedback
      ? `\n\n[이전 초안]\n제목: ${previousDraft.title}\n본문: ${previousDraft.body}\n\n[심사위원 피드백 — 이 부분을 반영해서 다시 쓸 것]\n${feedback}`
      : ''

  return `[주제]
${topic}

[핵심 내용]
${keyPoints || '(제공되지 않음)'}

[사용 가능한 사진]
${photoDescriptions || '(없음)'}${revisionBlock}

위 내용으로 블로그 포스팅을 작성하고 JSON으로만 답하세요.`
}

export function buildReviewSystemPrompt(role: BlogRole): string {
  const rubric = BLOG_RUBRICS[role]
  const rubricText = rubric
    .map((c) => `- ${c.label} (${c.weight}점): ${c.description}`)
    .join('\n')

  return `${NAVER_KNOWLEDGE}

${CONVERSION_COPY_RULES}

당신은 "${BLOG_ROLE_LABEL[role]}" 역할로 블로그 SEO 위원회의 심사위원입니다.
아래 5개 항목(각 20점, 총 100점) 기준으로 주어진 블로그 초안을 채점하세요.

채점 기준:
${rubricText}

규칙:
1. 각 항목 점수는 0~20점 정수로 매기고, 반드시 근거(comment)를 짧게 남긴다.
2. totalScore는 5개 항목 점수의 합(0~100)이어야 한다.
3. flags: 다시 확인해야 할 부분을 찾아 quote(문제되는 문장 그대로 인용, 짧게)·reason(왜 문제인지)·severity("info"|"check"|"risk")로 표시. severity는 risk(반드시 고쳐야 함) > check(확인 필요) > info(참고) 순.
4. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{
  "totalScore": number,
  "summary": string,
  "criteriaScores": [ { "criterionId": string, "score": number, "comment": string } ],
  "flags": [ { "quote": string, "reason": string, "severity": "info"|"check"|"risk" } ]
}

criteriaScores의 criterionId는 반드시 다음 중에서만 사용: ${rubric.map((c) => `"${c.id}"`).join(', ')}`
}

// 3인 위원회(SEO·카피·경험)를 각각 API 호출하지 않고 한 번의 호출로 세 관점을
// 모두 채점한다(대표님 결정: 비용 절감 — 3콜 → 1콜). 각 역할의 루브릭을 모두
// 넣고, 역할별 채점 결과를 배열로 받는다.
const COMBINED_ROLES: BlogRole[] = ['seo', 'copywriting', 'experience']

export function buildCombinedReviewSystemPrompt(): string {
  const roleBlocks = COMBINED_ROLES.map((role) => {
    const rubric = BLOG_RUBRICS[role]
    const rubricText = rubric.map((c) => `  - ${c.label} (${c.weight}점, id="${c.id}"): ${c.description}`).join('\n')
    return `[역할 "${role}" — ${BLOG_ROLE_LABEL[role]}] (5개 항목, 각 20점, 합계 100점)\n${rubricText}`
  }).join('\n\n')

  return `${NAVER_KNOWLEDGE}

${CONVERSION_COPY_RULES}

당신은 블로그 SEO 위원회입니다. 아래 세 역할(SEO·카피라이팅·경험)의 기준으로 주어진 블로그 초안을 각 역할별로 따로 채점하세요.

${roleBlocks}

규칙:
1. 각 역할마다 5개 항목을 0~20점 정수로 매기고, 각 항목에 짧은 근거(comment)를 남긴다.
2. 각 역할의 totalScore는 그 역할 5개 항목 점수의 합(0~100)이다.
3. flags: 역할별로 다시 확인할 부분을 quote(문제 문장 인용, 짧게)·reason(이유)·severity("info"|"check"|"risk")로 표시(없으면 빈 배열).
4. criteriaScores의 criterionId는 반드시 해당 역할의 항목 id만 사용한다.
5. 분량 제한(응답 잘림 방지): comment·reason은 각 1문장으로 짧게.
6. 반드시 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 설명이나 마크다운 코드블록 없이 순수 JSON만 출력한다.

JSON 스키마:
{
  "reviews": [
    { "role": "seo"|"copywriting"|"experience", "totalScore": number, "summary": string,
      "criteriaScores": [ { "criterionId": string, "score": number, "comment": string } ],
      "flags": [ { "quote": string, "reason": string, "severity": "info"|"check"|"risk" } ] }
  ]
}`
}

export function buildReviewUserPrompt(draft: {
  title: string
  body: string
  photoPlacements: string[]
}): string {
  return `[제목]
${draft.title}

[본문]
${draft.body}

[사진 배치 제안]
${draft.photoPlacements.join('\n') || '(없음)'}

위 초안을 기준으로 채점하고 JSON으로만 답하세요.`
}

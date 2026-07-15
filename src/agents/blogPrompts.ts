import type { BlogRole } from '../types/blog.js'
import { BLOG_RUBRICS, BLOG_ROLE_LABEL } from './blogRubric.js'

const NAVER_KNOWLEDGE = `[네이버 블로그 상위노출 참고 지식]
- C-Rank: 카테고리 전문성을 보는 알고리즘. 양산형 문장보다 구체적 관점·정보가 있는 글을 우대한다.
- D.I.A+: 직접 촬영한 사진(6~13장 권장)과 진정성 있는 경험 서술에 가산점을 준다.
- 글 구조: 제목은 공백 포함 40자 내외, 문단당 300~500자, 전체 2,500~3,000자 이내, 핵심 키워드 10개 내외를 자연스럽게 분산.
- 체류시간이 중요하다 — 도입부 후킹과 소제목 스캔 유도로 끝까지 읽게 만들어야 한다.
- 저품질 요인(피할 것): 키워드 반복 남용, 체험단식 과장된 효과 단정, 조작적 표현.`

const DRAFT_PERSONA = `당신은 업메리·마잘남의 블로그 콘텐츠 작가입니다. 네이버 블로그 상위노출 기준을 정확히 이해하고 있으며,
동시에 실제 방문자가 끝까지 읽고 싶어지는 진정성 있는 글을 씁니다.`

export function buildDraftSystemPrompt(
  brandContext?: string,
  marketFindings?: string,
  hasPhotos?: boolean,
): string {
  const brandBlock = brandContext ? `\n[브랜드]\n${brandContext}\n` : ''
  const marketBlock = marketFindings
    ? `\n[브레인이 조사한 최근 시장 리서치 — 참고해서 방향성에 반영]\n${marketFindings}\n`
    : ''
  const photoRule = hasPhotos
    ? '3. photoPlacements: 첨부된 실제 사진을 직접 보고, 각 사진을 본문 어느 지점에 배치하면 좋을지 사진 내용에 근거해서 구체적으로 제시.'
    : '3. photoPlacements: 제공된 사진 설명 목록 중에서 어느 사진을 본문 어느 지점에 배치하면 좋을지 문장으로 구체적으로 제시(사진이 없으면 빈 배열).'
  return `${DRAFT_PERSONA}
${brandBlock}${marketBlock}
${NAVER_KNOWLEDGE}

주어진 주제·핵심 내용을 바탕으로 네이버 블로그 포스팅 한 편을 작성하세요.

규칙:
1. 웹 검색은 "꼭 필요할 때만, 목적을 정해서" 한다(최대 3회). 이 주제로 실제 상위노출되는 글의
   제목 패턴·소재·정보 밀도가 정말 필요할 때만 확인하고, 이미 아는 것으로 충분하면 검색하지 않는다.
   이것저것 폭넓게 뒤지지 말고 핵심 목적에만 검색을 쓴다(불필요한 검색은 비용 낭비). 검색한 내용은
   그대로 베끼지 말고 우리 브랜드 관점으로 재구성한다.
2. title: 공백 포함 40자 내외, 핵심 키워드를 앞쪽에 배치하되 내용을 다 예측 가능하게 하지 않는다.
   body: 문단당 300~500자, H2/H3 느낌의 소제목(줄 앞에 "■" 등으로 표시)으로 구분, 전체 2,500~3,000자 이내.
${photoRule}
4. 실제 후기처럼 과장 없이 진정성 있게 쓰고, 고객 이름 등 민감정보는 포함하지 않는다.
5. 아래 JSON 스키마와 정확히 일치하는 JSON만 출력한다. 검색 과정 설명이나 마크다운 코드블록 없이
   최종 답변은 순수 JSON만 출력한다.

JSON 스키마:
{
  "title": string,
  "body": string,
  "photoPlacements": [ string ]
}`
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

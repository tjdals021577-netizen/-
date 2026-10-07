import type { RubricCriterion } from '../types/domain.js'

// 대표님 유튜브 채널 전략(remixPrompts.ts의 MAJALNAM_YT_STRATEGY = 작업물 공개형)에
// 맞춘 채점 기준. 6항목 합계 100점. 블로그와 동일하게 PASS_THRESHOLD(90) 기준.
// ★항목 id·배점은 유지(파싱 호환), 설명만 새 전략에 맞춤 — 생성·채점을 정렬해야
// "항상 미달"을 막는다.
export const REMIX_RUBRIC: RubricCriterion[] = [
  {
    id: 'title_click',
    label: '제목 원인지목력',
    weight: 20,
    description:
      '제목이 "결과 약속"(예: ~하는 법)이 아니라 "원인 지목형"("안 되는 이유 / 공통점 / 이것 때문에")인가. 내용을 다 예측 못하게 물음표를 만들고 클릭 이유가 분명한가. 수익 인증·금액 제목이 아닌가.',
  },
  {
    id: 'thumbnail_direction',
    label: '썸네일(진단서)',
    weight: 15,
    description:
      '썸네일이 "진단서" 느낌(상대 계정 화면 캡처 + 빨간 표시 하나)으로 무게중심이 명확하고 제목과 정합적인가. 주 피사체는 하나인가. ★수익 인증·금액 썸네일이 아닌가★.',
  },
  {
    id: 'opening_hook',
    label: '초반 후킹',
    weight: 20,
    description:
      '도입 1분(0~40초) 안에 공감·문제제기와 "문제 해결 신호"가 들어가고, 혼잣말이 아니라 "한 사람(구체적 타깃=사장님/1인사업가)에게 말 걸듯" 구어체로 주파수를 맞추는가.',
  },
  {
    id: 'script_structure',
    label: '콘텐츠 유형 구조',
    weight: 20,
    description:
      '3유형(계정 진단 60%·메인 / 대행 뒷단 / 반박형) 중 무엇인지 밝히고 그 구조에 충실한가(진단형이면 프로필·최근 글 5개·"문의 안 오는 이유 한 가지"로 압축). 핵심 정보를 아끼지 않고 다 말하는가("자세한 건 컨설팅에서" 떡밥·리스트 강의형이 아닌가).',
  },
  {
    id: 'algorithm_retention',
    label: '알고리즘·시청지속',
    weight: 15,
    description:
      '유사성+최신성이 드러나고, 시청지속을 끌 구성(궁금증 유지·의외성)과 좋아요·댓글·구독 유도가 자연스럽게 설계됐는가. "작업물 공개형"이라 끝까지 보게 되는가.',
  },
  {
    id: 'brand_identity',
    label: '포지션·고정 CTA',
    weight: 10,
    description:
      '포지션이 "일하는 대행사(작업물 공개형)"로 드러나고 강의팔이 방어 문구가 없는가. 마지막이 고정 CTA("진단받고 싶은 계정은 아래 폼으로. 영상에 쓸 수도 있고, 안 쓰더라도 답은 드립니다.")로 끝나는가. 주제가 스레드 마케팅 범위를 지키고 지어낸 수치가 없는가.',
  },
]

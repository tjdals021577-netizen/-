import type { RubricCriterion } from '../types/domain.js'

// 대표님 유튜브 실전 자료(remixPrompts.ts의 YOUTUBE_KNOWLEDGE)를 그대로 채점
// 기준으로 옮긴 것. 6항목 합계 100점. 블로그와 동일하게 PASS_THRESHOLD(90) 기준.
export const REMIX_RUBRIC: RubricCriterion[] = [
  {
    id: 'title_click',
    label: '제목 클릭력',
    weight: 20,
    description:
      '"혜택 있는 의문형"인가(단순 의문 X). 타깃 키워드가 앞에 배치되고, 내용을 다 예측하지 못하게 시청자 머릿속에 물음표를 만드는가. 클릭할 이유가 분명한가.',
  },
  {
    id: 'thumbnail_direction',
    label: '썸네일 방향성',
    weight: 15,
    description:
      '기대심리/증거제시/의문형성/공감형성 4범주 중 하나로 무게중심이 명확하고 제목과 정합적인가. 주 피사체는 하나이고 이미지에서 이야기가 읽히는가.',
  },
  {
    id: 'opening_hook',
    label: '초반 후킹',
    weight: 20,
    description:
      '도입 1분(0~40초) 안에 공감·문제제기와 "문제 해결 신호"가 들어가고, 혼잣말이 아니라 "한 사람(구체적 타깃)에게 말 걸듯" 구어체로 주파수를 맞추는가.',
  },
  {
    id: 'script_structure',
    label: '정보형 6단계 구조',
    weight: 20,
    description:
      '유인·문제제기 → 공감 예시 → 해결방법+보상 → 행동유도 → 암시·독려 → 기대·다음영상 흐름이 충실한가. "문제는 일반적, 솔루션은 특별하게" 공식과 공감+정보가 살아있는가.',
  },
  {
    id: 'algorithm_retention',
    label: '알고리즘·시청지속',
    weight: 15,
    description:
      '유사성+최신성이 드러나고, 시청지속을 끌 구성(궁금증 유지·의외성·다음 영상 추천으로 완결)과 좋아요·댓글·구독 유도가 자연스럽게 설계됐는가.',
  },
  {
    id: 'brand_identity',
    label: '마잘남 정체성',
    weight: 10,
    description:
      '주제가 "스레드 마케팅·퍼스널 브랜딩(1인사업가 대상)" 범위를 벗어나지 않고, 자료에 없는 수치·경험을 지어내지 않았는가.',
  },
]

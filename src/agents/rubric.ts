import type { AgentRole, RubricCriterion } from '../types/domain.js'

// 현재 유튜브 편집자/PD/그로스 담당자들이 실무에서 실제로 쓰는 체크리스트를 기반으로 구성한 채점 기준.
// 역할별로 5개 항목 x 20점 = 100점.

export const RUBRICS: Record<AgentRole, RubricCriterion[]> = {
  planning: [
    {
      id: 'hook',
      label: '오프닝 후킹',
      weight: 20,
      description:
        '영상 시작 3~5초 안에 무엇을 보게 될지, 왜 끝까지 봐야 하는지가 명확한가. 결론/충격 장면을 앞으로 당기는 "선공개" 편집이 되어 있는가.',
    },
    {
      id: 'story_alignment',
      label: '기획 의도 일치',
      weight: 20,
      description:
        '실제 컷 구성이 기획안(주제, 메시지, 톤앤매너)과 일치하는가. 삼천포로 빠지는 구간이 잘려나갔는가.',
    },
    {
      id: 'audience_fit',
      label: '타겟 시청자 공감 포인트',
      weight: 20,
      description:
        '타겟 시청자가 공감/몰입할 만한 리액션, 사례, 언어가 살아있는가. 불필요하게 타겟과 먼 드립/전문 용어가 남아있지 않은가.',
    },
    {
      id: 'info_fun_balance',
      label: '정보-재미 밸런스',
      weight: 20,
      description:
        '정보 전달 구간과 재미(리액션, 밈, 텐션) 구간이 번갈아 배치되어 지루한 구간이 길게 이어지지 않는가.',
    },
    {
      id: 'cta_flow',
      label: 'CTA/다음 영상 유도',
      weight: 20,
      description:
        '구독/좋아요/다음 영상 유도가 내용 흐름을 끊지 않고 자연스러운 타이밍(초반 티저 또는 엔딩)에 배치되어 있는가.',
    },
  ],
  editing: [
    {
      id: 'cut_rhythm',
      label: '컷 타이밍 & 리듬',
      weight: 20,
      description:
        '무편집 구간(긴 정적 쇼트) 없이 평균 쇼트 길이가 콘텐츠 톤에 맞게 리드미컬한가. 점프컷이 튀지 않고 리듬을 만드는가.',
    },
    {
      id: 'silence_filler_removal',
      label: '침묵/군더더기 제거',
      weight: 20,
      description:
        '"어, 음, 그" 같은 필러와 긴 침묵, NG성 구간이 충분히 제거되었는가.',
    },
    {
      id: 'caption_design',
      label: '자막/강조 자막 디자인',
      weight: 20,
      description:
        '핵심 키워드에 색상/크기 강조 자막이 들어가고, 자막 타이밍이 대사와 정확히 싱크되는가.',
    },
    {
      id: 'sfx_bgm_sync',
      label: '효과음/BGM 싱크',
      weight: 20,
      description:
        '리액션, 전환, 강조 포인트에 효과음이 붙어있고 BGM 볼륨/무드가 장면 텐션과 맞는가.',
    },
    {
      id: 'visual_variation',
      label: '화면 전환/펀치인 활용',
      weight: 20,
      description:
        '줌인(펀치인), 화면 분할, B-roll 삽입 등으로 같은 앵글이 8~10초 이상 지속되지 않는가.',
    },
  ],
  strategy: [
    {
      id: 'retention_curve',
      label: '초반 리텐션 커브',
      weight: 20,
      description:
        '첫 15~30초 이탈을 막는 구성인가 (질문 던지기, 결과 선공개, 강한 비주얼).',
    },
    {
      id: 'pattern_interrupt',
      label: '패턴 인터럽트 주기',
      weight: 20,
      description:
        '5~8초 주기로 화면/사운드/구도에 변화를 줘서 스크롤 이탈을 방지하는가.',
    },
    {
      id: 'thumbnail_moment',
      label: '썸네일/클립 각',
      weight: 20,
      description:
        '숏폼 클립이나 썸네일로 바로 쓸 수 있는 강한 표정/텍스트 포인트가 최소 1곳 이상 확보되는가.',
    },
    {
      id: 'loopability_ending',
      label: '엔딩 루프/다음 액션',
      weight: 20,
      description:
        '엔딩이 도입부와 연결되거나 다음 영상 시청을 자연스럽게 유도해 세션 시간을 늘리는가.',
    },
    {
      id: 'keyword_exposure',
      label: '검색/알고리즘 키워드 노출',
      weight: 20,
      description:
        '스크립트/자막에 타겟 키워드가 자연스럽게 반복 노출되어 추천 알고리즘과 검색에 유리한가.',
    },
  ],
}

export const ROLE_LABEL: Record<AgentRole, string> = {
  planning: '기획 PD',
  editing: '편집자',
  strategy: '전략/그로스',
}

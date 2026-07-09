import type { RubricCriterion } from '../types/domain'
import type { BlogRole } from '../types/blog'

// 네이버 블로그 상위노출(C-Rank/D.I.A+) 리서치를 반영한 채점 기준.
// 역할별로 5개 항목 x 20점 = 100점.

export const BLOG_RUBRICS: Record<BlogRole, RubricCriterion[]> = {
  seo: [
    {
      id: 'title_optimization',
      label: '제목 최적화',
      weight: 20,
      description:
        '제목이 공백 포함 40자 내외이고 핵심 키워드가 앞쪽에 배치되어 있는가. 내용을 다 예측 가능하게 만들지 않고 궁금증을 유발하는가.',
    },
    {
      id: 'structure',
      label: '본문 구조',
      weight: 20,
      description:
        '문단당 300~500자, 전체 2,500~3,000자 이내인가. H2/H3 소제목으로 스캔하기 쉽게 구조화되어 있는가.',
    },
    {
      id: 'keyword_distribution',
      label: '키워드 분산',
      weight: 20,
      description:
        '핵심 키워드 10개 내외가 본문에 자연스럽게 분산되어 있는가. 과도한 반복(키워드 스터핑)이 없는가.',
    },
    {
      id: 'c_rank_expertise',
      label: 'C-Rank 전문성 신호',
      weight: 20,
      description:
        '카테고리 전문성이 드러나는 구체적 관점·정보가 담겨 있는가. 양산형 문장이 아닌가.',
    },
    {
      id: 'dia_signals',
      label: 'D.I.A+ 신호',
      weight: 20,
      description:
        '사진 배치 제안이 충분한가(6~13장 권장). 직접 경험한 것처럼 읽히는 진정성 있는 서술인가.',
    },
  ],
  copywriting: [
    {
      id: 'opening_hook',
      label: '도입부 후킹',
      weight: 20,
      description:
        '첫 문장에서 계속 읽고 싶게 만드는가. 시작부터 정보 나열로 지루하지 않은가.',
    },
    {
      id: 'dwell_time_design',
      label: '체류시간 설계',
      weight: 20,
      description:
        '정보 밀도와 스캔하기 쉬운 구성으로 끝까지 읽게 만드는가.',
    },
    {
      id: 'emotional_resonance',
      label: '공감 포인트',
      weight: 20,
      description: '독자가 공감할 수 있는 사례·경험이 자연스럽게 녹아있는가.',
    },
    {
      id: 'cta_flow',
      label: 'CTA 흐름',
      weight: 20,
      description:
        '문의·방문·예약 등 행동 유도가 내용 흐름을 끊지 않고 자연스러운 타이밍에 배치되어 있는가.',
    },
    {
      id: 'readability',
      label: '가독성',
      weight: 20,
      description: '문장 길이와 리듬이 좋은가. 같은 접속사·표현이 반복되지 않는가.',
    },
  ],
  experience: [
    {
      id: 'authenticity',
      label: '진정성',
      weight: 20,
      description: '과장 없이 실제 경험처럼 읽히는 톤으로 서술되어 있는가.',
    },
    {
      id: 'sensitive_info',
      label: '민감정보 체크',
      weight: 20,
      description: '실명, 연락처 등 민감정보 노출 위험이 없는가.',
    },
    {
      id: 'low_quality_avoidance',
      label: '저품질 회피',
      weight: 20,
      description:
        '조작적 표현, 근거 없는 효과 단정, 체험단식 양산 문장이 없는가.',
    },
    {
      id: 'photo_persuasion',
      label: '사진 배치 설득력',
      weight: 20,
      description: '제안된 사진 배치 위치가 글의 설득력을 높이는 지점에 있는가.',
    },
    {
      id: 'brand_tone',
      label: '브랜드 톤앤매너',
      weight: 20,
      description: '전문성과 신뢰감이 느껴지는 톤을 유지하고 있는가.',
    },
  ],
}

export const BLOG_ROLE_LABEL: Record<BlogRole, string> = {
  seo: 'SEO',
  copywriting: '카피/후킹',
  experience: '고객경험',
}

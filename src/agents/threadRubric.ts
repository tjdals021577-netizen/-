import type { RubricCriterion } from '../types/domain'

// 스레드 위원회(버즈) 품질 게이트 — 4개 항목 x 25점 = 100점.
export const THREAD_RUBRIC: RubricCriterion[] = [
  {
    id: 'intuitiveness',
    label: '직관성',
    weight: 25,
    description:
      '첫 줄만 읽어도 무슨 이야기인지 바로 이해되는가. 맥락 설명 없이도 훅이 꽂히는가.',
  },
  {
    id: 'clarity',
    label: '명확성',
    weight: 25,
    description: '전달하려는 메시지가 하나로 명확한가. 여러 주장이 섞여 흐려지지 않는가.',
  },
  {
    id: 'simplicity',
    label: '단순함',
    weight: 25,
    description: '불필요한 수식어·전문용어 없이 쉬운 문장으로 되어 있는가.',
  },
  {
    id: 'conciseness',
    label: '간결성',
    weight: 25,
    description: '군더더기 문장 없이 필요한 말만 남아있는가. 스레드 분량에 맞게 짧은가.',
  },
]

export const THREAD_ROLE_LABEL = '품질 게이트'

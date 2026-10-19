// 블로그 자동화 브랜드 설정 — 같은 파이프라인(키워드 → 글쓰기 → 자동 수정 → 채점 → 고쳐 쓰기)을
// 브랜드별 내용(프롬프트·말투·검증된 사실·키워드·주제·채점표)만 바꿔 끼워 쓴다(2026-10 업메리 추가).
import type { SystemBlock } from '../lib/claude.js'
import type { RubricCriterion } from '../types/domain.js'
import type { BlogRole } from '../types/blog.js'
import type { ReaderStage } from '../types/blogBrain.js'
import type { Brand } from '../types/brand.js'
import {
  buildMajalnamReviewSystem,
  buildMajalnamWriterSystem,
  buildMajalnamWriterUser,
  KEYWORD_SYSTEM,
  MAJALNAM_BLOG_TOPICS,
  MAJALNAM_CORE_KEYWORDS,
  MAJALNAM_REVIEW_RUBRICS,
  MAJALNAM_VERIFIED_FACTS,
} from './majalnamBlogPrompts.js'
import {
  buildUpmeryReviewSystem,
  buildUpmeryWriterSystem,
  buildUpmeryWriterUser,
  UPMERY_BLOG_TOPICS,
  UPMERY_CORE_KEYWORDS,
  UPMERY_CTA_DEFAULT,
  UPMERY_DISCLAIMER,
  UPMERY_KEYWORD_SYSTEM,
  UPMERY_REVIEW_RUBRICS,
  UPMERY_VERIFIED_FACTS,
} from './upmeryBlogPrompts.js'

export interface WriterUserParams {
  topic: string
  mainKeyword: string
  subKeywords: string[]
  readerStage: ReaderStage
  keyContent?: string
  photos?: string
  previousDraft?: { title: string; body: string }
  feedback?: string
}

export interface BlogBrandConfig {
  brand: Brand
  topics: string[]
  coreKeywords: string[]
  keywordSystem: string
  writerSystem: (p: { researchBlock?: string; ctaLink?: string }) => SystemBlock[]
  writerUser: (p: WriterUserParams) => string
  reviewSystem: (researchBlock?: string) => SystemBlock[]
  rubrics: Record<BlogRole, RubricCriterion[]>
  verifiedFacts: string
  // 진단·상담 링크 환경변수 이름과 기본값(없으면 노란 자리표시자).
  ctaEnvKey: string
  ctaDefault?: string
  // 수익 얘기를 하는 브랜드의 필수 면책 문장(없으면 자동으로 붙인다).
  disclaimer?: string
  // 글쓰기 "임팩트 목표"에 쓰는 브랜드별 예시.
  impactExamples: { intro: string; heading: string }
}

const MAJALNAM: BlogBrandConfig = {
  brand: '마잘남',
  topics: MAJALNAM_BLOG_TOPICS,
  coreKeywords: MAJALNAM_CORE_KEYWORDS,
  keywordSystem: KEYWORD_SYSTEM,
  writerSystem: buildMajalnamWriterSystem,
  writerUser: buildMajalnamWriterUser,
  reviewSystem: buildMajalnamReviewSystem,
  rubrics: MAJALNAM_REVIEW_RUBRICS,
  verifiedFacts: MAJALNAM_VERIFIED_FACTS,
  ctaEnvKey: 'BLOG_CTA_LINK',
  impactExamples: { intro: '조회수 500, 3일, 2,000만 원', heading: '## 남의 계정 글 3,000개 쓰고 안 것' },
}

const UPMERY: BlogBrandConfig = {
  brand: '업메리',
  topics: UPMERY_BLOG_TOPICS,
  coreKeywords: UPMERY_CORE_KEYWORDS,
  keywordSystem: UPMERY_KEYWORD_SYSTEM,
  writerSystem: buildUpmeryWriterSystem,
  writerUser: buildUpmeryWriterUser,
  reviewSystem: buildUpmeryReviewSystem,
  rubrics: UPMERY_REVIEW_RUBRICS,
  verifiedFacts: UPMERY_VERIFIED_FACTS,
  ctaEnvKey: 'BLOG_CTA_LINK_UPMERY',
  ctaDefault: UPMERY_CTA_DEFAULT,
  disclaimer: UPMERY_DISCLAIMER,
  impactExamples: { intro: '20분 3만 원, 22시간 만에 첫 문의, 통장 0원', heading: '## 강의비 1,000만 원 쓰고 알게 된 것' },
}

export function getBlogBrandConfig(brand: Brand): BlogBrandConfig {
  return brand === '업메리' ? UPMERY : MAJALNAM
}

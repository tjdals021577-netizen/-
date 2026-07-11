# 콘텐츠 생성 에이전트

전부 브라우저에서 Anthropic API를 BYOK(사용자가 직접 키 입력)로 직접 호출한다.
서버가 없어서 지금은 전부 "버튼을 눌러야" 실행됨(자동 스케줄은 Phase 4 크론 참고).

## 라이터 (블로그)
- 화면: `src/components/BlogComposer.tsx` (운영실 → 블로그 탭)
- 로직: `src/agents/runBlogReview.ts`, `src/agents/blogPrompts.ts`, `src/agents/blogRubric.ts`
- 흐름: 초안 생성 → SEO/카피/고객경험 3인 위원회가 각 100점 만점 채점 → 평균 90점 이상 통과,
  아니면 피드백 반영해서 재생성
- 완료 시 자동으로 `결재함`(승인 대기) + `캘린더`(channel: blog)에 등록됨

## 버즈 (스레드)
- 화면: `src/components/ThreadComposer.tsx` (운영실 → 스레드 탭)
- 로직: `src/agents/runThreadReview.ts`, `src/agents/threadPrompts.ts`, `src/agents/threadRubric.ts`
- 흐름: 라이터와 비슷하지만 위원회가 1인, 기준 4개(직관성·명확성·단순함·간결성) × 25점
- 대행 클라이언트용 스레드도 같은 로직 재사용 (`AgencyScreen.tsx`에서 직접 호출)

## 리믹서 (유튜브 기획)
- 화면: `src/components/RemixComposer.tsx` (운영실 → 유튜브 기획 탭)
- 로직: `src/agents/runRemix.ts`, `src/agents/remixPrompts.ts`
- 채점 없음 — 훅 후보 3개 + 대본 구성안 + 벤치마킹 근거만 생성. 촬영·편집은 별도(사람이 함)

## 브레인 (시장 벤치마킹)
- 화면: `src/components/BrainPanel.tsx` (운영실 → 브레인 탭)
- 로직: `src/agents/runBrain.ts`, `src/agents/brainPrompts.ts`
- **Claude의 서버사이드 웹서치 도구**(`callClaudeJsonWithWebSearch`, `src/lib/claude.ts`)를 사용 —
  실제로 인터넷 검색해서 답함. 브랜드별 채널 정보(`BRAND_CHANNELS`)를 컨텍스트로 같이 넘김

## 코치 (스크린샷 분석)
- 화면: `src/components/CoachPanel.tsx` (대시보드 화면 안에 포함)
- 로직: `src/agents/runCoach.ts`, `src/agents/coachPrompts.ts`
- **비전(이미지) 분석** — 네이버 블로그 통계 등 스크린샷을 업로드하면 Claude가 직접 읽어서
  지표 추출 + 분석 + 다음 액션 제안. 사람이 이미지를 올려야 해서 자동화 불가능

## 모닝 (데일리 브리핑)
- 화면: `src/components/MorningPanel.tsx` (대시보드 화면 안에 포함)
- 로직: `src/agents/runMorning.ts`, `src/agents/morningPrompts.ts`
- 그날 근무기록(`getWorkLog`)을 모아서 요약 — 웹서치나 비전 없이 순수 텍스트 합성만.
  오늘 아직 안 만들었으면 패널 상단에 리마인드 배너가 뜸

## 공통 인프라
- `src/lib/claude.ts` — Anthropic 호출 3종(`callClaudeJson`, `callClaudeJsonWithWebSearch`,
  `callClaudeVisionJson`) 전부 여기서 관리. 서버(`/api/cron`)에서도 그대로 재사용 중
  (환경 독립적인 순수 함수라 가능)
- `src/lib/workLog.ts` — 모든 에이전트 실행 기록의 단일 저장소(공용 근무기록)
- `src/lib/budgetGuard.ts` — 일일 $5 예산 캡, 초과 시 신규 호출 차단
- `src/types/brand.ts` — `BRAND_CONTEXT`(브랜드 톤 — 아직 플레이스홀더, 나중에 실제 톤으로 교체 예정),
  `BRAND_CHANNELS`(업메리=블로그만, 마잘남=스레드+블로그+유튜브)

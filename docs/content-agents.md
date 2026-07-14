# 콘텐츠 생성 에이전트

전부 브라우저에서 Anthropic API를 BYOK(사용자가 직접 키 입력)로 직접 호출한다.
서버가 없어서 지금은 전부 "버튼을 눌러야" 실행됨(자동 스케줄은 Phase 4 크론 참고).

## 라이터 (블로그)
- 화면: `src/components/BlogComposer.tsx` (운영실 → 블로그 탭)
- 로직: `src/agents/runBlogReview.ts`, `src/agents/blogPrompts.ts`, `src/agents/blogRubric.ts`
- 흐름: 초안 생성 → SEO/카피/고객경험 3인 위원회가 각 100점 만점 채점 → 평균 90점 이상 통과,
  아니면 피드백 반영해서 재생성
- 완료 시 자동으로 `결재함`(승인 대기) + `캘린더`(channel: blog)에 등록됨
- **브레인 리서치 자동 반영**: 같은 브랜드로 브레인을 먼저 실행해두면, 그 결과가 자동으로
  초안 생성 프롬프트에 참고 자료로 들어간다(아래 "브레인 → 다른 에이전트 연동" 참고).
  화면에 "🧠 브레인 최신 리서치 반영됨"이 보이면 적용 중이라는 뜻.
- **실제 웹서치 사용**(2026-07-12부터): 리믹서와 동일하게 `callClaudeJsonWithWebSearch`로
  이 주제의 실제 상위노출 글 구조를 검색한 뒤 참고해서 쓴다.
- **실제 사진 첨부 지원**: "사용 가능한 사진"에 파일을 올리면(텍스트 설명 대신) 비전 호출로
  전환되어 AI가 사진을 직접 보고 배치를 제안한다 — 이 경우엔 사진 근거가 검색보다 우선이라
  웹서치는 같이 못 쓴다(둘 다 하려면 나중에 `callClaudeVisionJson`에 웹서치 도구를 추가해야 함).

## 버즈 (스레드)
- 화면: `src/components/ThreadComposer.tsx` (운영실 → 스레드 탭)
- 로직: `src/agents/runThreadReview.ts`, `src/agents/threadPrompts.ts`, `src/agents/threadRubric.ts`
- 흐름: 라이터와 비슷하지만 위원회가 1인, 기준 4개(직관성·명확성·단순함·간결성) × 25점
- 대행 클라이언트용 스레드도 같은 로직 재사용 (`AgencyScreen.tsx`에서 직접 호출)
- **레퍼런스 이미지 모드**: 설정 탭 레퍼런스 라이브러리에서 이미지를 골라 첨부하면, 채점/재생성
  루프 대신 `generateThreadVariantsWithReferences()`(비전 호출)로 스타일만 참고한 시안 3개를
  한 번에 받는다 — API를 반복 호출하지 않고 사람이 직접 고르는 용도. 대행 클라이언트는 온보딩
  시 레퍼런스를 지정해두면 매일 초안 5개 생성에도 자동 반영되고("레퍼런스로 재요청" 버튼으로
  마음에 안 들 때 새 레퍼런스 넣어 시안 3개를 다시 받을 수도 있음).
- 브레인 리서치는 라이터와 동일하게 자동 반영됨.
- **대표님 저서 지식 반영**(2026-07-13부터): `src/agents/threadPrompts.ts`의 `THREAD_KNOWLEDGE` —
  대표님이 직접 쓴 스레드 마케팅 전자책("0원에서 1억 만든 스레드 비법") 내용을 요약해서 초안 생성·
  레퍼런스 모드·채점 시스템 프롬프트에 전부 넣어둠(신뢰 퍼널, 7가지 훅 템플릿, 정보:판매 7:3 비율,
  단순한 퍼널, 레퍼런스는 구조만 참고 등). `NAVER_KNOWLEDGE`/`YOUTUBE_KNOWLEDGE`와 같은 패턴.
- **대행 클라이언트 매일 자동 생성**(2026-07-14부터): `api/cron/agency.ts` — 매일 07:30 KST에
  진행 중인(일시중단 아닌) 클라이언트마다 사람이 대시보드에서 "오늘 초안 5개 생성" 버튼을 누른 것과
  동일한 결과(초안 5개 + 채점 + 결재함/캘린더 등록)를 자동으로 만든다. 클라이언트에 레퍼런스 이미지가
  등록돼 있으면 그 스타일을 그대로 참고해서 쓴다. `src/lib/agencyStore.ts`의
  `syncClientsFromSupabase()`가 화면 진입 시 이 결과를 Supabase에서 끌어와 보여준다.
- **초안이 마음에 안 들 때 — 이미 있음**: `AgencyScreen.tsx`의 "레퍼런스로 재요청" 버튼 —
  새 레퍼런스 이미지(라이브러리에서 고르거나 그 자리에서 업로드)를 넣으면 그 스타일에 맞춰
  시안 3개를 다시 받는다(`generateThreadVariantsWithReferences`). 텍스트를 그 자리에서 직접
  고쳐 쓰는 인라인 편집 기능은 아직 없음 — "새 레퍼런스로 다시 받기" 방식만 지원.

## 리믹서 (유튜브 기획)
- 화면: `src/components/RemixComposer.tsx` (운영실 → 유튜브 기획 탭)
- 로직: `src/agents/runRemix.ts`, `src/agents/remixPrompts.ts`
- 채점 없음 — 훅 후보 3개 + 대본 구성안 + 벤치마킹 근거만 생성. 촬영·편집은 별도(사람이 함)
- **실제 웹서치 사용**(2026-07-12부터): 예전엔 지식베이스 기준 추측이었는데, 이제
  `callClaudeJsonWithWebSearch`로 실제 유튜브에서 비슷한 채널·영상의 최근 반응을 검색한 뒤
  그걸 근거로 훅/구성안/벤치마킹 노트를 작성한다. 브레인 리서치도 자동 반영됨.

## 브레인 (시장 벤치마킹)
- 화면: `src/components/BrainPanel.tsx` (운영실 → 브레인 탭)
- 로직: `src/agents/runBrain.ts`, `src/agents/brainPrompts.ts`
- **Claude의 서버사이드 웹서치 도구**(`callClaudeJsonWithWebSearch`, `src/lib/claude.ts`)를 사용 —
  실제로 인터넷 검색해서 답함. 브랜드별 채널 정보(`BRAND_CHANNELS`)를 컨텍스트로 같이 넘김

## 브레인 → 다른 에이전트 연동 (`src/lib/brainStore.ts`)
- 브레인이 조사를 마치면(수동 실행이든 팀 채팅 지시든) 결과가 브랜드별로 `localStorage`에
  구조화 저장된다(최근 10건까지, `formatBrainFindingsForPrompt()`로 프롬프트용 텍스트 변환).
- 라이터·버즈·리믹서가 생성을 시작할 때 **같은 브랜드의 가장 최근 브레인 리포트를 자동으로
  찾아서** 시스템 프롬프트에 "브레인이 조사한 최근 시장 리서치" 블록으로 끼워 넣는다.
  추천 순서: **브레인으로 먼저 리서치 → 그 다음 라이터/버즈/리믹서 실행** (직접 명시 안 해도 자동 반영됨).
- **한계**: 이건 브라우저 localStorage 기반이라 **같은 컴퓨터·같은 브라우저 세션**에서만
  적용된다. 매달 1일 자동으로 도는 브레인 크론(`api/cron/brain.ts`)의 결과는 Supabase
  `brain_reports` 테이블에는 저장되지만, 프론트엔드가 아직 Supabase에서 리포트를 읽어오는
  기능은 없어서 크론이 만든 리포트는 화면에서 "자동 반영"되지 않는다(수동으로 브레인 탭에서
  다시 돌리면 그 결과는 반영됨). 필요하면 나중에 프론트엔드가 Supabase에서 최신 브레인 리포트를
  읽어오도록 확장 가능.

## 코치 (스크린샷 분석)
- 화면: `src/components/CoachPanel.tsx` (대시보드 화면 안에 포함)
- 로직: `src/agents/runCoach.ts`, `src/agents/coachPrompts.ts`
- **비전(이미지) 분석** — 네이버 블로그 통계 등 스크린샷을 업로드하면 Claude가 직접 읽어서
  지표 추출 + 분석 + 다음 액션 제안. 사람이 이미지를 올려야 해서 자동화 불가능

## 모닝 (데일리 브리핑)
- 화면: `src/components/MorningPanel.tsx` (대시보드 화면 안에 포함, 수동 실행 시 "오늘" 기준)
- 자동: `api/cron/morning.ts`가 매일 08:00 KST에 실행 — "어제(전날) 00:00~23:59 KST" 전체
  근무기록을 요약해서 전달한다(2026-07-12 수정 전에는 "오늘 자정~지금"만 봐서 아침엔
  기록이 거의 비어있는 버그가 있었음)
- 로직: `src/agents/runMorning.ts`, `src/agents/morningPrompts.ts`
- 근무기록(`getWorkLog`)을 모아서 요약 — 웹서치나 비전 없이 순수 텍스트 합성만.
  오늘 아직 안 만들었으면 패널 상단에 리마인드 배너가 뜸
- **다음 단계(레이더 연동 후)**: 레이더(GA4/유튜브/메타/아임웹 등 실제 발행 콘텐츠 성과 데이터)가
  연결되면, 모닝이 "어제 뭘 했는지" 요약뿐 아니라 "그 콘텐츠들 반응이 어땠는지 보고 다음엔
  어떤 방향이 좋을지" 추천까지 매일 아침 자동으로 주도록 확장할 예정 — 지금은 레이더 자격증명이
  없어서 아직 구현 안 함(외부 계정 연동 이후 진행).

## 공통 인프라
- `src/lib/claude.ts` — Anthropic 호출 3종(`callClaudeJson`, `callClaudeJsonWithWebSearch`,
  `callClaudeVisionJson`) 전부 여기서 관리. 서버(`/api/cron`)에서도 그대로 재사용 중
  (환경 독립적인 순수 함수라 가능)
- `src/lib/workLog.ts` — 모든 에이전트 실행 기록의 단일 저장소(공용 근무기록)
- `src/lib/budgetGuard.ts` — 일일 $5 예산 캡, 초과 시 신규 호출 차단
- `src/types/brand.ts` — `BRAND_CONTEXT`(브랜드 톤 — 아직 플레이스홀더, 나중에 실제 톤으로 교체 예정),
  `BRAND_CHANNELS`(업메리=블로그만, 마잘남=스레드+블로그+유튜브)

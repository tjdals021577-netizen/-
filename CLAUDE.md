# CLAUDE.md — 이 리포지토리에서 작업하는 새 세션을 위한 안내

> 이 파일은 Claude Code가 세션 시작 시 자동으로 읽습니다. 다른 컴퓨터/새 세션에서도
> 이 문서만 보면 프로젝트 맥락·규칙·빌드 방법을 바로 잡을 수 있게 유지합니다.

## 이 프로젝트가 뭔가
업메리·마잘남 **두 브랜드를 위한 AI 콘텐츠 운영 플랫폼**. (README.md는 초기 "3인 영상
편집 심사위원회" 시절 설명이라 현재와 다름 — 실제 현황은 이 파일과 `docs/`를 기준으로 볼 것.)
- **업메리**: 타로 상담 개인 사업 — 블로그만 운영.
- **마잘남**: 스레드 마케팅 대행 에이전시 — 스레드 + 블로그 + 유튜브 운영.
- 스택: React + Vite + TypeScript(프론트) · Vercel 서버리스(`api/`) · Supabase · Anthropic Claude.

## 향후 로드맵 (퍼널 → 자체 앱)
- 대표님이 유튜브 등 모든 퍼널을 **자체 앱 링크 하나로 통일**할 예정: `유튜브/스레드/블로그 → 앱 링크 → 구매는 아임웹`.
- 지금은 코드 변경 불필요: 콘텐츠에 구매 URL이 하드코딩돼 있지 않고(프롬프트는 퍼널 "전략"만),
  매출은 아임웹 주문 API(`api/_lib/imweb.ts`)로 이미 집계 → 결제가 아임웹이면 그대로 유효.
- **앱 완성 후 "다시 연동"할 것**(대표님 요청): ① 유입 귀속 — 앱 지표로 "어느 채널→앱 클릭→아임웹
  구매"를 잇기(현재 GA4는 사이트 유입만 봄), ② 스레드 프롬프트의 퍼널 예시 문구를 "→ 앱 링크"로 갱신,
  ③ 앱 주문 ↔ 아임웹 매출 매칭 확인.

## 브랜치 규칙 (중요)
- 모든 개발/커밋/푸시는 **`claude/video-editing-workflow-9yj1zg`** 브랜치에.
- `main`은 비어있고(Initial commit), **프로덕션은 이 피처 브랜치에서 배포**된다 → 푸시=배포.
- 요청 없이는 PR 만들지 말 것. 푸시는 `git push -u origin claude/video-editing-workflow-9yj1zg`.
- 커밋 메시지·코드·배포물 어디에도 **모델 ID(claude-...)를 넣지 말 것**(채팅 답변에만 사용).

## 빌드·검증 (커밋 전 반드시 통과)
```bash
npx tsc --noEmit                         # 1) 프론트 타입체크
# 2) api 타입체크 — 임시 tsconfig로 api/**/*.ts만
cat > tsconfig.apicheck.json <<'EOF'
{ "compilerOptions": { "module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022",
  "lib":["ES2022"],"strict":true,"noEmit":true,"esModuleInterop":true,"skipLibCheck":true,"types":["node"] },
  "include": ["api/**/*.ts"] }
EOF
npx tsc -p tsconfig.apicheck.json ; rm -f tsconfig.apicheck.json
npm run build                            # 3) 프로덕션 빌드(rolldown-vite)
npm run lint                             # 4) oxlint
```
- **알려진 무해한 오류(무시)**: api 타입체크에서 `src/lib/claude.ts`의 `import.meta.env` / `window`
  관련 오류(현재 5개)는 Vite가 런타임에 채우는 브라우저 전역이라 최소 api tsconfig에서만 나는
  오탐이다. 프론트 타입체크(`tsc --noEmit`)는 DOM 타입이 있어 깨끗하게 통과한다.
  그 파일 외 다른 api 오류가 새로 나면 진짜 오류.
- 샌드박스는 외부(라이브 서비스)로 못 나간다 — 실제 호출 대신 위 4단계로 검증한다.

## 모델·비용 규칙
- `CLAUDE_MODEL = 'claude-sonnet-5'` — 생성(글·기획).
- `CLAUDE_MODEL_CHEAP = 'claude-haiku-4-5'` — 채점·판단만(비용 절감). `src/lib/claude.ts`.
- 예산 가드: `src/lib/budgetGuard.ts`(일일 상한), 프록시에도 `DAILY_BUDGET_USD` 상한.
- `PASS_THRESHOLD = 90`(통과), `REWRITE_THRESHOLD = 80`(이 미만일 때만 1회 재작성) — `src/types/domain.ts`.

## 아키텍처 지도
- **`src/agents/`** — 채널별 프롬프트 빌더 + 러너.
  - `threadPrompts.ts` — 스레드 지식의 **단일 소스**. `THREAD_KNOWLEDGE`(무료 전자책),
    `PAID_THREAD_KNOWLEDGE`(유료 전자책 "스레드 광고비 0원으로 100만원 벌기" — 직종별 퍼널 등 심화),
    `ALGO_KNOWLEDGE`, `MAJALNAM_THREAD_VOICE`. 두 전자책 지식은 여기서 export해서
    **blog·youtube(remix)·agency가 import**해 재사용(이미지 재읽기 X, 캐시 프롬프트로 내장).
  - `blogPrompts.ts` / `runBlogReview.ts` — 네이버 블로그. "문의를 만드는" 카피 + SEO 규칙 +
    전자책 지식. 3인 위원회 채점은 `runBlogReviewsResilient`가 **1콜(Haiku)**로 통합.
  - `remixPrompts.ts` / `runRemix.ts` — 유튜브 기획(리믹서). 채점+미달 시 1회 재작성.
    생성 실패(JSON 안 나옴) 방지: 재시도 시 "JSON만" 강한 지시 덧붙임.
  - `agencyPrompts.ts` — 대행(클라이언트별). 직종별 퍼널이 특히 유효.
  - `runBrain.ts` — 웹서치 리서치. `BRAND_RESEARCH_FOCUS`(`src/types/brand.ts`)로 범위 제한.
  - `chatDecide.ts` — 팀채팅 대화형 판단(question/act/reply, `isRevision`). 전자책은 이미 내장이라
    "붙여달라" 되묻지 않게 명시. 직전 결과물(`getLastOutput`) 참고해 수정 요청 처리.
  - `dispatch.ts` — 팀채팅 "일 시키기" 경량 실행기. `previousOutput`으로 수정보완.
  - `sharedRules.ts` — 공통 규칙(기밀·안티할루시네이션).
- **`src/lib/`** — 상태 저장(localStorage 기반) + `claude.ts`(프록시 호출·프롬프트 캐싱
  `cachedSystem`·**취소 `cancelActiveClaudeCalls`**), `agentChatStore.ts`(메모리·직전 결과물),
  `budgetGuard.ts`, `remoteSync.ts`, `calendarStore`/`approvalStore`/`workLog`/`brainStore`/`contentFeedbackStore`.
- **`api/cron/`** — 서버 자동화(KST): `content-schedule` 06:00, `agency` 07:30, `thread-daily` 07:40,
  `radar` 07:50, `morning` 08:00, `brain`(월) 09:00, `cleanup`(월) 03:00. 스케줄은 `vercel.json`.
  - 주간: 월수금=마잘남 유튜브 1 / 화목토일=업메리·마잘남 블로그 각 1.
- **데이터 흐름**: 크론이 **Supabase**에 쓰고, 브라우저는 **localStorage**를 읽는다 →
  화면 진입 시 `remoteSync`가 당겨온다(그래서 방금 크론 결과가 안 보이면 새로고침/탭 재진입).

## 대표님이 직접 해야 하는 것(코드로 못 하는 것)
- Supabase SQL(1회): `alter table radar_snapshots add column if not exists daily_revenue jsonb not null default '[]';`
  그리고 `content_feedback` 테이블(이미 생성됨). 스키마는 `db/schema.sql` 참고.
- Vercel 환경변수(배포/로컬 실행에 필요): `docs/deployment.md`에 전체 목록.
  핵심: `ANTHROPIC_API_KEY`, `SUPABASE_*`, `VITE_SUPABASE_*`, `CRON_SECRET`, `GA4_*`,
  `IMWEB_*`, `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID_*`, `THREADS_ACCESS_TOKEN_*`, `VITE_APP_PASSWORD`.
  - ⚠️ `YOUTUBE_CHANNEL_ID_MAJALNAM`가 **실제 마잘남 채널 ID**인지 확인(동명 채널 오인 방지).

## 자료(전자책 등)
- 대표님(본인 소유) 전자책 2권의 원문 PDF·추출 텍스트가 **`docs/reference/`에 보관**돼 있다.
- 그 원문에서 뽑은 노하우는 **`threadPrompts.ts`의 상수로 텍스트화되어 내장**돼 있고
  (`THREAD_KNOWLEDGE`·`PAID_THREAD_KNOWLEDGE`·`ALGO_KNOWLEDGE`), 실제 생성에 쓰인다.
  지식을 고치려면 `docs/reference/`의 원문을 근거로 이 상수들을 수정한다.

## 더 자세한 문서
`docs/`: `content-agents.md`(에이전트), `data-and-brand.md`(데이터·브랜드),
`deployment.md`(배포·환경변수·크론·DB), `workflow.md`(워크플로우).

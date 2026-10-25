# CLAUDE.md — 이 리포지토리에서 작업하는 새 세션을 위한 안내

> 이 파일은 Claude Code가 세션 시작 시 자동으로 읽습니다. 다른 컴퓨터/새 세션에서도
> 이 문서만 보면 프로젝트 맥락·규칙·빌드 방법을 바로 잡을 수 있게 유지합니다.

## 이 프로젝트가 뭔가
업메리·마잘남 **두 브랜드를 위한 AI 콘텐츠 운영 플랫폼**. (README.md는 초기 "3인 영상
편집 심사위원회" 시절 설명이라 현재와 다름 — 실제 현황은 이 파일과 `docs/`를 기준으로 볼 것.)
- **업메리**(퀸퀸 타로): 타로 부업 수익화 1:1 컨설팅 — 블로그만 운영. 사람: **멘토님**(현직 타로 상담사, 홈페이지의 "저" — 93년생·1급·강의비 1,000만 원·12개월 할부)과
  **메인 강사님**(다른 분, 확인된 경력·숫자 아직 없음). **대표님 본인 이야기가 아님**(2026-10-25 정정) — 업메리 블로그·광고 문구는 "저희 업메리"가 멘토님을 3인칭(이름 없이 "멘토님")으로 소개하는 회사 시점. 후기 캡처의 노란 말풍선(답장) = 멘토님.
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
- `CLAUDE_MODEL_CHEAP = 'claude-haiku-5-5'` — 채점·키워드 판단만(비용 절감, 2026-10 4.5→5.5). `src/lib/claude.ts`.
  Haiku 5.5는 생각이 기본 ON이라 생각 토큰도 max_tokens에 포함 → 호출마다 `effort: 'low'` + 한도 여유.
- **생각 깊이(effort, 2026-10 비용 절감)**: Sonnet 5는 미설정 시 high로 깊게 생각하고 그 토큰도 출력 과금.
  마잘남 블로그 글쓰기: 06:00 자동은 `high`(2단계 분리로 글쓰기에 최대 230초 — 한 번에 하면 180초 안에 못 끝나 잘렸음),
  고쳐 쓰기·팀채팅은 `medium` / 모닝·팀채팅 판단·브레인 자료수집 `low` /
  유튜브 기획·대행·blog-brain 분석 `medium`.
  `callClaudeJson`·`callClaudeVisionJson`·`callClaudeJsonWithWebSearch`의 `effort` 옵션(→ `output_config.effort`).
- **응답 길이 한도(2026-10, 실사용 실패 2건 후)**: 현재 모델은 생각 토큰도 max_tokens에 포함 → 낮은 한도는
  JSON 잘림("JSON을 찾지 못했습니다")의 주원인. `claude.ts`의 `safeMaxTokens`가 모든 호출에 최소치 보장
  (깊은 생성 16k / 그 외 8k, 상한 20k). 잘린 응답은 `ClaudeTruncatedError`로 구분된다.
- **"대표님이 다시 확인하지 않게" 원칙**: 채점이 실패해도 글·시안은 버리지 않고 결재함에 올리며 "채점 없음 · 글 정상"
  으로 표시. 마잘남 블로그는 발행 전 자동 수정(`blogRuleCheck.autoFixDraft` — 제목 단정 표현 삭제·연락처 가림,
  제목 25~35자 벗어나면 `fixBlogTitle`로 싼 모델 교정) 후 결재함 상자에 "자동으로 고친 것 / 못 고친 것"을 표시.
  대행 크론은 생성 2회 시도 + 채점 실패 시 시안 보존 + 최종 실패는 근무기록(팀채팅)에 남김.
- 예산 가드: `src/lib/budgetGuard.ts`(일일 상한), 프록시에도 `DAILY_BUDGET_USD` 상한.
- `PASS_THRESHOLD = 85`(통과) — `src/types/domain.ts`. **마잘남 블로그는 미달이면 채점 지적을 넘겨 1회 자동 고쳐 쓰기 +
  재채점, 점수 오른 쪽 채택**(2026-10 대표님 결정, 300초 한도 안에서 시간 남을 때만 — `majalnamBlogPipeline.ts`).
  2026-10부터 **업메리 블로그도 같은 흐름**(아래 "업메리 블로그").
- **Vercel Hobby = 서버리스 함수 12개 한도(현재 12개 꽉 참).** `api/` 아래 `_`로 시작하지 않는
  새 .ts 파일을 만들면 배포가 전부 실패한다 → 새 기능은 기존 함수 안에 넣거나 `api/_lib/`에.
  가벼운 크론을 더 붙일 땐 **`api/cron/[task].ts`(동적 경로, 함수 1개)**에 작업 이름으로 추가하고 vercel.json에
  `/api/cron/<작업 이름>`을 넣는다(현재: cleanup · upmery-blog · upmery-blog-polish · meta-capi · ad-weekly · upmery-keywords).
- **Hobby 크론은 정해진 분이 아니라 "그 시간대 안 아무 때나" 실행된다** → 순서가 중요한 단계(1단계 글쓰기 → 2단계 다듬기)는
  시간대를 1시간 이상 띄운다.
- Claude 모델은 **assistant prefill 미지원** — `assistantPrefill`은 무시된다(JSON은 지시+extractJson).
- 멈춤/진행 스위치: `api/_lib/cronHandler.ts`의 `PAUSED_DEFAULT`(또는 env `AUTOMATION_PAUSED`).

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
  - `runBrain.ts` — **content-brain**(유튜브·스레드 소재 전용) 웹서치 리서치. `BRAND_RESEARCH_FOCUS`로 범위 제한.
    마잘남은 유튜브 작업물 공개형 소재(workAngles·rebuttals·references → `brain_reports.extras`).
  - **마잘남 블로그 재설계(2026-10, 대표님 지시서)** — 업메리도 같은 구조(아래 "업메리 블로그"). 옛 `blogPrompts.ts` 경로는 이제 안 씀.
    - `majalnamBlogPrompts.ts` — 대표님 원문 프롬프트 3개(1 글쓰기·2 키워드 생성·3 blog-brain 분석)
      **문구 그대로**. 발행 전 채점표도 1번의 15항목과 일치(`MAJALNAM_REVIEW_RUBRICS`).
    - `runMajalnamBlog.ts` — 키워드 생성(Haiku)·글쓰기(Sonnet)·blog-brain 분석(Sonnet) 호출+폴백.
    - **말투(2026-10 대표님 지시)**: `MAJALNAM_BLOG_PERSONA` — 대표 1인칭 "반존대"(해요체 + 짧은 반말 단문), 이모지 없음.
      대표님 스레드 글 3개에서 추출. 1인칭 경험은 `[대표 에피소드]`, 수치는 `[검증된 사실]`(`MAJALNAM_VERIFIED_FACTS` — 단일 소스)만.
      꾸밈 표시 6가지: `## `(01·02 번호 소제목)·`> `(요약)·`:: `(POINT 콜아웃)·`!! `(숫자 카드)·`[전]/[후]`(비포·애프터)·`**강조**`
      → `naverFormat.renderNaverBody`가 가운데 정렬 네이버용 HTML로 변환(주황 포인트 색). `blogRuleCheck.checkImpact`가
      꾸밈 요소 누락·숫자 부족·검증 안 된 숫자(돈·사람·% 단위)를 코드로 잡아 결재함 상자와 자동 고쳐 쓰기에 전달.
      **AI 티 금지**(대표님: "현실에서 사람들 블로그 쓰는 것처럼"): 프롬프트 `[AI 티 금지]` + `autoFixDraft`가 줄표(—)→쉼표·
      질문:/답:/Q./A. 라벨 자동 삭제(자리표시자 [...] 안은 안 건드림) + `checkAiTells`가 첫째·둘째·셋째, "A가 아니라 B" 반복,
      "결론적으로·그렇다면·지금 바로" 등을 잡아 자동 고쳐 쓰기에 전달. 결재함 "① 네이버 제목 복사 / ② 본문 복사(꾸밈 포함)" 버튼(`ApprovalScreen`).
      네이버 블로그 자동 발행은 하지 않는다(공식 글쓰기 API 불확실 + 자동 발행 감지 시 저품질·제재 위험).
    - `api/_lib/majalnamBlogPipeline.ts` — 06:00 크론·팀채팅 공용: 키워드 → 라이터(researchBlock 주입) → 채점.
      **두 번에 나눠 실행(2026-10 대표님 결정 A)**: 06:00 `content-schedule`은 `mode: 'draft'` — 깊게(high, 최대 230초) 쓰고
      자동 수정까지만 해서 결재함에 "채점 대기(8시대)"로 저장(상태는 HTML 주석 `MJBLOG-STATE:`에 숨김).
      **08시대** `hooks` 크론(시트 동기화 뒤, 크론 호출일 때만 — Vercel Hobby 크론은 "그 시간대 안 아무 때나" 실행돼
      06시대 글쓰기와 겹치지 않게 08시대로)이 `majalnamBlogPolish.ts` → `polishMajalnamBlog`로 채점 →
      미달이면 고쳐 쓰기(보통) → 재채점 후 **같은** 결재함·근무기록·캘린더 항목을 업데이트(승인·반려된 건 안 건드림).
      팀채팅은 `mode: 'full'`(보통으로 한 번에).
    - **업메리 블로그(2026-10, 대표님 "마잘남처럼 똑같이")**: 같은 파이프라인에 브랜드 설정만 바꿔 끼운다 —
      `src/agents/blogBrandConfig.ts`(`getBlogBrandConfig`) + `src/agents/upmeryBlogPrompts.ts`(대표님 홈페이지 2개에서 뽑은
      말투(`UPMERY_BLOG_PERSONA` = 회사 시점 "업메리 말투", `[멘토님 이야기]`)·`UPMERY_VERIFIED_FACTS`·수강생 기록·독자 단계·키워드·주제·채점표). CTA = 카카오톡 채널(`UPMERY_CTA_DEFAULT`,
      env `BLOG_CTA_LINK_UPMERY`로 교체 가능). 수익 글이라 면책 문장(`UPMERY_DISCLAIMER`) 필수 — 없으면 자동 추가.
      공용 1단계 작업 `api/_lib/blogDailyDraft.ts`(마잘남 content-schedule도 이걸 씀).
      일정: 업메리 1단계 **04시대**(`/api/cron/upmery-blog`) → 2단계 **07시대**(`/api/cron/upmery-blog-polish`).
      **2026-10-25부터 매일 자동 쓰기 꺼짐**(`UPMERY_BLOG_AUTO = false`, `src/lib/weeklySchedule.ts` — 대표님 "주제 리스트에서 골라
      내가 요청하면 써지게"). 04시대 크론은 건너뛰고, **블로그 탭 맨 위 "🗒️ 주제 목록"**(`src/components/UpmeryTopicList.tsx`,
      업메리 블로그일 때만)에서 골라 "이 주제로 쓰기" →
      (**2026-10-25 대표님 "기존 주제 없애고 새로 뽑은 걸로"**: 화면 주제는 ① 🔎 검색 많은 주제 ② 후기 사례글 ③ 직접 입력뿐. 손으로 만든
      질문·정보·멘토님 이야기 목록은 화면에서 뺐고 배열은 예전 "주제 qa:3" 표시·자동 크론 대비로만 남김. 오늘 추천 = 안 쓴 검색 주제 1순위 →
      없으면 안 쓴 후기. 이번 주 검색 목록이 없거나 6일 지났으면 화면을 열 때 자동으로 뽑음(`force: false`)) →
      `api/dispatch.ts` `action: 'upmery-blog-write'`(`topicKey` → `runUpmeryBlogForTopic`, 1단계 high, `approvalId` 반환) →
      화면이 이어서 `action: 'upmery-blog-polish'`(그 `approvalId`만 채점·고쳐 쓰기). 화면을 닫아 2단계를 못 했으면 07시대 다듬기 크론이
      최근 3일 안의 대기 글을 마무리한다. 주제 키 = `review:r002`·`qa:3`·`info:0`·`story:5`·`custom:…`(`planFromKey`), 쓴 주제는
      근무기록 메모 "후기 rNNN"·"주제 qa:3"으로 "썼음" 표시(`usedTopicKeysFromNotes`). **목록 순서를 바꾸면 키가 어긋나니 새 주제는 맨 뒤에만 추가.**
      **🔎 검색 많은 주제(2026-10-25, 대표님 "진짜 사람을 모아 올 주제?")** — 주제 목록 맨 위. `api/_lib/upmeryKeywordTopics.ts` +
      `src/agents/upmeryKeywordTopics.ts`: 네이버 검색광고 키워드도구(`fetchKeywordVolumeRows`, 시드 `UPMERY_KEYWORD_SEEDS` 15개 → 5개씩 3회)
      실제 월 검색량 → 코드 거르기(업메리 범위 + 운세 "보러 온" 사람·도박·대출 제외) → **Haiku 1회**가 업메리 손님 키워드만 골라 제목
      (목록에 없는 키워드는 버리고 검색량은 코드가 붙임) → 네이버 블로그 상위 3개 글 실측(글자·사진)으로 상위 글 강도(약함·보통·탄탄·미확인)
      → 점수 = min(검색량,5000) × 구간(300~5,000 우대) × 강도. 저장은 `blog_brain_reports`(brand `업메리 검색주제`, 새 테이블 없음).
      크론 `upmery-keywords`(매일 10시대, 이번 주 것 있으면 건너뜀) + 화면 "지금 새로 뽑기"(`dispatch` `upmery-keyword-topics-refresh`).
      **네이버 검색광고 키(`NAVER_AD_*`)가 없으면 아무것도 안 함(AI 0원)**. 키 = `kw:키워드|띄어쓴 키워드|제목` → 메인 키워드를 그 키워드로
      고정(`runMajalnamBlogPipeline`의 `mainKeyword`), 근무기록 "주제 kw:키워드". 그리고 키워드 단계 검색량 표가 브랜드별
      `volumeFilter`로 걸러진다(예전엔 마잘남 범위로만 걸러 업메리는 키가 있어도 늘 '없음'이었음).
      **주제 은행 + 후기 보관함(2026-10-25, 대표님 "주제가 항상 걱정, 후기 많음")** — 업메리는 고정 7주제 순환 대신
      `src/agents/upmeryTopicBank.ts`: 요일별 글 종류(일·월·수·금 **후기 사례글**, 화 질문 답변, 목 키워드 정보, 토 대표 이야기, AI 호출 없이 코드로 선택).
      후기 사례글 날엔 `src/agents/upmeryReviews.ts`(`UPMERY_REVIEWS`)에서 **아직 안 쓴 후기 1건**을 꺼내 [핵심 내용]으로 넘기고, 쓴 후기는
      근무기록 메모 "후기 r001"로 표시(2단계 다듬기도 유지) → 재사용 안 함. 후기가 떨어지면 질문 답변글 + 결재함에 "후기 더 보내 달라" 안내.
      후기는 **대표님이 이 Claude Code 채팅(구독)으로 캡처를 보내면 Claude가 읽고 정리**(서버 AI가 캡처를 읽지 않음 — API 0원):
      이름·전화·카톡 ID·프로필 사진 가림 확인, 메타데이터 제거 후 `public/reviews/upmery-rNNN.png`, 배열 맨 뒤에 다음 번호로 추가.
      사진은 `images` 배열(여러 장 가능, 없으면 `NO_PHOTO` — 글엔 "후기 캡처 — 이름·프로필 가려서" 자리만 표시). 현재 r001~r025,
      사진 파일은 r001~r009·r025만(r010~r024는 작업 도중에 받은 캡처라 파일로 저장되지 않음 — 대표님이 다시 보내면 붙일 것).
      같은 사람 후기는 `caution`에 묶어 표시(글에서 다른 사람처럼 쓰지 않게).
      보관함 내용은 `UPMERY_VERIFIED_FACTS`에 자동으로 붙어 검증된 사실이 된다. 결재함엔 가린 후기 사진 + "사진 저장" 버튼(네이버엔 대표님이 직접).
      팀채팅 라이터도 업메리면 같은 파이프라인. **주간 blog-brain도 업메리 포함**(`UPMERY_BLOG_BRAIN_SYSTEM` = 마잘남 원문 3번에서
      브랜드 내용만 교체, 키워드는 `UPMERY_CORE_KEYWORDS`) — brain 크론이 두 브랜드를 병렬로 분석, 각자 글쓰기에 반영.
      **채점 공정성(2026-10)**: 채점 AI에 `measureForReview`(코드 실측 — 메인 키워드·횟수·제목 위치·독자 단계·글자 수·소제목·
      문단 길이·사진 수·꾸밈 개수)를 넘기고, 채점 system에 `MAJALNAM_VERIFIED_FACTS` 전체 + 점수 기준선(기준 지킴 17~20 /
      아쉬움 14~16 / 위반 13↓)을 넣었다. 채점은 Haiku `medium`. (전엔 메인 키워드도 모르고 수치를 직접 세다 부당 감점)
    - `api/_lib/naverBlogData.ts` — blog-brain 수집. env에 네이버 키 있으면 A(검색API·검색광고API),
      없으면 B: **1순위 네이버 블로그 검색 결과 페이지 직접 읽기**(비용 0, 실제 네이버 순위 — 2026-10 웹서치만으론 상위글 0건),
      0건이면 2순위 웹서치(응답 건수·제외된 도메인을 근무기록에 남김). 어느 쪽이든 m.blog 본문을 코드로 실측(글자·사진·소제목·도입·FAQ·CTA).
      소제목(`measureSmartEditor`, 2026-10 중앙값 0 오측정 후): 소제목 컴포넌트가 있으면 그것만, 없으면 짧은 인용구 ·
      번호/기호로 시작하는 짧은 줄 · 본문보다 큰 글씨(19↑) · 한 줄 전체 굵은 글씨(15개 넘으면 강조로 보고 제외)를 센다.
    - `api/_lib/blogStore.ts` — `blog_keywords`·`blog_brain_reports`·`brain_reports.extras` 읽기/쓰기
      (테이블 없어도 안 깨지게 전부 방어).
  - `chatDecide.ts` — 팀채팅 대화형 판단(question/act/reply, `isRevision`). 전자책은 이미 내장이라
    "붙여달라" 되묻지 않게 명시. 직전 결과물(`getLastOutput`) 참고해 수정 요청 처리.
  - `dispatch.ts` — 팀채팅 "일 시키기" 경량 실행기. `previousOutput`으로 수정보완.
  - `sharedRules.ts` — 공통 규칙(기밀·안티할루시네이션).
- **`src/lib/`** — 상태 저장(localStorage 기반) + `claude.ts`(프록시 호출·프롬프트 캐싱
  `cachedSystem`·**취소 `cancelActiveClaudeCalls`**), `agentChatStore.ts`(메모리·직전 결과물),
  `budgetGuard.ts`, `remoteSync.ts`, `calendarStore`/`approvalStore`/`workLog`/`brainStore`/`contentFeedbackStore`.
- **`api/cron/`** — 서버 자동화(KST): `upmery-blog` 04시대(지금 꺼짐 — `UPMERY_BLOG_AUTO`), `content-schedule` 06:00(마잘남 블로그 1단계),
  `upmery-blog-polish` 07시대, `meta-capi` 07시대(업메리 리드 → 메타 전환), `hooks` 08시대(시트 동기화 + 마잘남 블로그 2단계),
  `radar` 07:50, `brain` 매일 09:00(주 1회 분량, 아래 참고), `cleanup`(월) 03:00. 스케줄은 `vercel.json`.
  - 2026-10 대표님 비용 절감으로 **스케줄에서 뺀 크론**(파일은 그대로 — vercel.json에 한 줄 추가하면 다시 켜짐):
    - `thread-daily`(07:40, 스레드 5포맷 자동): `{ "path": "/api/cron/thread-daily", "schedule": "40 22 * * *" }`
    - `morning`(08:00, 모닝 브리핑 + 카톡 발송): `{ "path": "/api/cron/morning", "schedule": "0 23 * * *" }`
    - `agency`(07:30, 스레드 대행 클라이언트 자동 시안, 2026-10 대표님 지시로 중단):
      `{ "path": "/api/cron/agency", "schedule": "30 22 * * *" }` — 대행 탭 "오늘 초안 생성"(수동)은 계속 가능
  - 주간(`src/lib/weeklySchedule.ts`): 마잘남 블로그 매일 — **2026-10-25부터 일시 중단**(`MAJALNAM_BLOG_AUTO = false`,
    대표님 "잠깐 꺼줘". 다시 켜려면 true로 바꿔 배포. 팀채팅 라이터 수동은 계속 가능, 주간 blog-brain 분석은 그대로 돈다). 업메리 블로그는 여기선 OFF — `[task].ts`의 upmery-blog 담당인데 그것도 `UPMERY_BLOG_AUTO = false`라 지금은 주제 목록 요청으로만 쓴다.
    **유튜브는 일시정지** — `YOUTUBE_ACTIVE = false`면 월·수·금 유튜브 기획과 content-brain(유튜브 소재 리서치)이
    함께 멈춘다. 대표님이 "유튜브 실행"하면 이 값만 true로 바꿔 배포(팀채팅 리믹서 수동 기획은 항상 가능).
    일시정지 동안 팀채팅을 열 때마다 "유튜브 기획은 언제 다시 들어가시나요?" 알림 카드가 뜬다
    (`TeamChatScreen.tsx`, 닫아도 다음 방문에 다시 뜸). true로 바꾸면 자동으로 사라진다.
  - `brain` = 한 함수에서 **blog-brain(마잘남·업메리) + content-brain(마잘남)** 병렬(함수 한도 때문에 분리 안 함)
    (content-brain은 `YOUTUBE_ACTIVE`일 때만). **매일 깨어나되 이번 주 분석이 없을 때만 일한다**
    (월요일 실패 시 다음 날 자동 재시도, 이미 있으면 Claude 호출 0). 테이블 확인 불가(SQL 전)면 월요일만.
    blog-brain 단계별 폴백: 웹서치 재시도(범위 축소) → 지난주 상위글 URL 재측정 → 분석 3회(마지막은 입력 축소),
    전부 760초 데드라인 안에서.
    **주당 최대 3회 실행 상한**(`MAX_RUNS_PER_WEEK`, 근무기록 행 수로 셈 — 성공·실패·예외 모두 1회) → 소진 시 다음 주 월요일 재개.
- **업메리 상담 신청(리드) → 메타 전환(2026-10 대표님 요청)**: CTA가 카톡뿐이라 광고 성과를 못 재서 만든 것.
  - 폼: `src/lib/leadFormSnippet.ts`가 아임웹 "코드" 블록용 HTML을 만든다(대시보드 "폼 설치 → 폼 코드 복사"가 Supabase 주소·
    공개 키·픽셀 ID를 채워 줌). 이름·전화·타로 경험·하루 시간·필수 동의(국외 이전 고지 포함) + URL의 utm_*·fbclid(첫 방문 값을
    localStorage에 기억) + _fbc/_fbp. 제출 = Supabase `leads`에 **공개 키로 직접 insert**(return=minimal) + 픽셀 `Lead`
    (eventID = 리드 ID) → 완료 페이지 이동(주소 없으면 그 자리에 카톡 채널 추가 버튼). 카톡 문의 링크는 보조로 남김.
  - `leads` RLS = **insert만**(조건으로 상태·전송 기록 조작 차단), 읽기·수정 정책 없음 → 목록·상태 변경은 `api/radar-refresh.ts`
    (본문 `action: 'leads' | 'lead-status'`, 앱 비밀번호 필수)가 service 키로 처리(`api/_lib/leads.ts`). 화면은 `LeadsPanel.tsx`
    (리드를 localStorage에 저장하지 않음). 상태: 신청 → 카톡 대화 → 통화 완료 → 결제 / 이탈(`src/types/lead.ts`).
  - 크론 `meta-capi`(07시대, `[task].ts`): 안 보낸 것만 메타 전환 API로 — 신청 `Lead`(event_id=리드 ID, 픽셀과 중복 제거)·
    통화 완료 `Contact`·결제 `Purchase`(금액 KRW, 결제로 바꿀 때 금액 필수). 전화번호는 82 국가번호 붙여 SHA-256. 7일 지난 건
    메타가 안 받아 처리됨 표시. 실패하면 표시 안 하고 다음 날 재시도. 근무기록엔 **건수만**(이름·전화 원문 금지).
    env `META_PIXEL_ID`·`META_CAPI_TOKEN`(없으면 건너뜀), 선택 `META_TEST_EVENT_CODE`(이벤트 관리자 테스트)·`META_GRAPH_VERSION`(기본 v23.0).
- **업메리 광고 퍼널 카드(2026-10 대표님 요청)**: 대시보드 "광고" 카드(`AdsPanel.tsx`, 새 탭 없음) — 채널별 노출 → 클릭 → 신청 →
  통화 → 결제 + 비용·신청당 비용·결제당 비용·ROAS, 기간 "어제까지 7일 / 30일". **AI 호출 없이 코드로만 집계**(`src/lib/adFunnel.ts`).
  - 메타 광고: `radar` 크론이 `api/_lib/metaAds.ts`(마케팅 API 읽기, 광고별·일별, 최근 30일 매일 다시 받음)로 수집 →
    `radar_snapshots` source `meta_ads`, 광고 줄 목록은 **`traffic_sources` 칸**에(새 컬럼 없음, 매출 칸 비움 — 다른 화면은 source로 걸러 읽음).
    env `META_AD_ACCOUNT_ID`·`META_ACCESS_TOKEN`(ads_read) — 없으면 건너뜀. GA4·아임웹 수집은 그대로.
  - 당근: API 없음 → 설정 화면 CSV 업로드(`DaangnCsvUpload.tsx`, 날짜·비용·노출·클릭 열 자동 인식, 같은 날짜는 덮어쓰고 쌓임) →
    `radar_snapshots` source `daangn_ads`(공개 키 insert, `src/lib/adStore.ts`).
  - 채널 = 리드 `utm_source` 소문자 통일 후 meta / daangn / threads / instagram / 기타(별칭은 `channelOf`). 통화 = 통화 완료 이상(결제 포함).
    메타 광고별 신청은 `utm_content`를 광고 ID 또는 광고 이름과 맞춤 → 메타 URL 매개변수에 `utm_content={{ad.id}}` 권장.
    합계 줄은 비용 데이터가 있는 유료 채널만(무료 유입을 섞으면 신청당 비용·ROAS가 부풀려짐).
- **애드 — 업메리 광고 운영 팀원(2026-10 대표님 요청)**: 목적 단 하나 = **결제당 비용 낮추기**. 매주 월 09시대 자동
  (`[task].ts` `ad-weekly`, 이번 주 리포트 있으면 건너뜀) + 팀채팅 수동(업메리 전용, "모두에게"에선 빠짐). `api/_lib/adAgent.ts`.
  - [검증된 사실] = 광고 대시보드 숫자(radar_snapshots meta_ads·daangn_ads) + leads + 메타 광고 세트·광고 상태(`fetchMetaAdStructure`)를
    코드로 만든 텍스트(`buildAdFacts`). 분석(Sonnet `medium`) → 끌 광고 / 늘릴 광고(세트 일 예산) / 새 소재 방향, 근거 숫자 1줄.
  - 코드 가드(`guardAnalysis`): **학습 중(최근 7일 이내 수정·생성 또는 메타 LEARNING) 세트와 그 안 광고는 제안에서 뺌**, 예산은 **±20%로 자름**
    (100원 단위, 현재 예산 쪽으로), 일 예산 없는 세트(CBO·기간 예산)는 뺌, 근거 숫자가 사실 밖이면 "확인 필요" 표시.
  - 문구(Sonnet `high`) 5세트(헤드라인 + 본문 3줄, 랜딩 = 상담 신청 폼 `UPMERY_AD_LANDING`) → 줄표 자동 수정 → **금지어 코드 검사**
    (`src/agents/adRuleCheck.ts`: 수익·금액 주장 / 읽는 사람 상황 단정 / 보장·100%·확실) + 채점(Haiku `medium`, 심사 안전성·후킹·랜딩 일치·
    명확성·AI 티, 세트당 100) → 걸렸거나 85 미만이면 **1회 고쳐 쓰기(high)** → 그래도 금지어가 남은 세트는 결재함에 안 올림.
  - 결재함 = 리포트 1건 + **[실행 대기]** 항목(끄기·예산)마다 1건(HTML 주석 `ADACTION:`). **광고 변경은 자동 실행 안 함** — 결재함에서
    그 항목을 승인할 때만 `api/dispatch.ts`(본문 `action: 'ad-execute'`) → `executeAdAction`이 Supabase에서 항목을 다시 읽고, 실행 직전
    학습 중 여부·현재 예산을 다시 확인해 메타 마케팅 API로 실행(7일 지난 제안은 실행 안 함, 성공해야 승인 처리). 토큰에 **ads_management** 필요.
- **데이터 흐름**: 크론이 **Supabase**에 쓰고, 브라우저는 **localStorage**를 읽는다 →
  화면 진입 시 `remoteSync`가 당겨온다(그래서 방금 크론 결과가 안 보이면 새로고침/탭 재진입).

## 대표님이 직접 해야 하는 것(코드로 못 하는 것)
- Supabase SQL(1회): `alter table radar_snapshots add column if not exists daily_revenue jsonb not null default '[]';`
  그리고 `content_feedback` 테이블(이미 생성됨). 스키마는 `db/schema.sql` 참고.
  마잘남 블로그 재설계용: `blog_keywords`·`blog_brain_reports` 테이블 + `brain_reports.extras` 컬럼(schema.sql 하단).
- 애드가 광고를 실제로 끄고·예산을 바꾸려면 `META_ACCESS_TOKEN`에 ads_read + **ads_management** 권한(시스템 사용자 토큰 권장).
  광고 문구의 랜딩 설명(`UPMERY_AD_LANDING`, `src/agents/adPrompts.ts`)은 아임웹 신청 페이지 문구를 바꾸면 같이 맞출 것.
- 업메리 광고 카드: Vercel env `META_AD_ACCOUNT_ID`·`META_ACCESS_TOKEN`(마케팅 API ads_read) 등록, 메타 광고 URL 매개변수
  `utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.id}}`, 당근 광고 링크엔 `utm_source=daangn`,
  당근 CSV는 설정 화면에서 주기적으로 올리기.
- 업메리 상담 신청(리드): Supabase SQL로 `leads` 테이블+정책(schema.sql 맨 아래 블록) 1회 실행, Vercel env `META_PIXEL_ID`·
  `META_CAPI_TOKEN` 등록, 아임웹에 폼 페이지(코드 블록)·완료 페이지 만들기, 메타 광고 링크에 UTM을 붙여 폼 페이지로 바로 연결.
- 선택 env(마잘남 블로그): `BLOG_CTA_LINK`(진단 폼, 없으면 자리표시자), 네이버 A모드용
  `NAVER_SEARCH_CLIENT_ID/SECRET`(검색API — 신규 발급은 네이버 클라우드로 이전됨),
  `NAVER_AD_API_KEY/SECRET_KEY/CUSTOMER_ID`(검색광고 키워드도구 — **업메리 "검색 많은 주제"에 필요**, searchad.naver.com 도구 → API 사용 관리, 무료).
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

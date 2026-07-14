# 배포 (Vercel + Supabase)

## 브랜치 — 중요
- **작업 브랜치**: `claude/video-editing-workflow-9yj1zg` (실제 코드가 전부 여기 있음)
- 저장소에 `main`이라는 브랜치도 존재하지만, **2026-07-08 최초 커밋에서 멈춰있는 빈 브랜치**다.
  절대 이쪽에 뭘 확인하거나 배포하지 말 것.
- GitHub 저장소의 실제 기본(default) 브랜치는 `claude/video-editing-workflow-9yj1zg`.

### 겪었던 문제 (2026-07-11)
Vercel 프로젝트를 처음 만들 때는 `claude/video-editing-workflow-9yj1zg`를 정상적으로
가져왔지만, **Project Settings → Environments → Production의 "지점 추적(브랜치 추적)"
설정이 `main`으로 남아있어서** 그 이후 새 커밋을 푸시해도 자동 배포가 전혀 안 걸렸다.
증상: 코드를 고쳐서 GitHub에 올려도 실제 사이트에 반영이 안 됨.

**확인 방법**: `git remote show origin`으로 두 브랜치의 최신 커밋을 비교, `main`이
한참 뒤처져 있으면 이 문제.

**해결**: Vercel → Project Settings → Environments → Production → 지점 추적을
`claude/video-editing-workflow-9yj1zg`로 변경 + 수동으로 한 번 Redeploy.

## 환경변수 (Vercel → Project Settings → Environment Variables, Production)

| 이름 | 용도 | 어디서 발급 |
|---|---|---|
| `VITE_SUPABASE_URL` | 프론트엔드가 Supabase에 dual-write할 때 사용 | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | 위와 동일 (Publishable key) | Supabase → Settings → API |
| `SUPABASE_URL` | `/api/cron/*` 서버 함수용 (프론트와 동일 URL) | 위와 동일 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 함수가 RLS 우회해서 읽고 쓸 때 사용 (Secret key) | Supabase → Settings → API |
| `ANTHROPIC_API_KEY` | `/api/cron/*`가 서버에서 직접 Claude 호출할 때 사용 | Anthropic 콘솔 |
| `CRON_SECRET` | Vercel Cron이 자동으로 `Authorization: Bearer $CRON_SECRET`을 붙여 호출 — 외부에서 함부로 못 부르게 막는 용도 | 아무 랜덤 문자열 (레포에 없음, 직접 생성) |
| `VITE_APP_PASSWORD` | (선택) 앱 전체 비밀번호 게이트. 안 넣으면 게이트 자체가 꺼짐 | 원하는 문자열 |

**주의**: `VITE_` 접두사가 붙은 값은 빌드 시 클라이언트 번들에 그대로 노출된다(원래 그렇게 설계됨 —
`VITE_SUPABASE_ANON_KEY`는 공개돼도 되는 키). `VITE_` 없는 값(`SUPABASE_SERVICE_ROLE_KEY`,
`ANTHROPIC_API_KEY`, `CRON_SECRET`)은 서버(`/api`)에서만 쓰이고 브라우저로 절대 안 나간다.

## 연결 확인 방법
사이트 접속 → **설정** 탭 → **"지금 연결 테스트"** 버튼. Supabase에 테스트 행 1건을
직접 넣어보고 성공/실패와 원인을 화면에 그대로 보여준다 (개발자 도구 필요 없음).
`src/lib/remoteSync.ts`의 `testSupabaseConnection()` 참고.

## 크론 작업 (`/api/cron`)
- `agency.ts`: 매일 07:30 KST(22:30 UTC) — 진행 중인 대행 클라이언트마다 초안 5개 자동 생성
  (레퍼런스 이미지 있으면 반영) + 결재함/캘린더 자동 등록
- `radar.ts`: 매일 07:50 KST(22:50 UTC) — GA4 방문자/유입경로 스냅샷을 브랜드별로 수집
- `morning.ts`: 매일 08:00 KST(23:00 UTC) — 브랜드별로 어제 근무기록 + 레이더 데이터를 모아 브리핑 생성
- `brain.ts`: 매월 1일 09:00 KST(00:00 UTC) — 브랜드별로 "이번 달 트렌드" 기본 주제로 웹서치 리서치
- 스케줄은 저장소 루트의 `vercel.json` 참고
- 이 넷은 전부 Supabase에 실제로 데이터가 쌓이고 있어야 의미가 있다(각자 `work_log`/`agency_clients`/
  `radar_snapshots` 등을 읽고 쓴다) — 즉 Supabase 연결이 실제로 되고 있는지 먼저 확인 필수
- `캘린` `코치`는 크론 없음: 캘린은 콘텐츠 생성 자체가 아직 로컬/수동이라 크론이 읽을 서버
  데이터가 마땅치 않고, 코치는 사람이 스크린샷을 직접 올려야 해서 애초에 자동화 불가능

### 레이더(GA4) 연결 — 2026-07-13 진행
서비스 계정(Google Cloud) 방식으로 연결한다. OAuth 로그인 없이 정적 키 하나로 끝나서 이 방식을 씀.

1. Google Cloud Console에서 프로젝트 생성 → **Analytics Data API** 활성화
2. IAM 및 관리자 → 서비스 계정 만들기(역할 부여 불필요) → 키 탭에서 JSON 키 생성/다운로드
3. GA4 속성(브랜드별로 각각) → 관리 → 속성 액세스 관리 → 서비스 계정 이메일을 **뷰어**로 추가
4. Vercel 환경변수에 아래 추가(전부 Production, Sensitive 체크):
   - `GA4_SERVICE_ACCOUNT_KEY` — 다운로드한 JSON 키 파일 **전체 내용**(브랜드 공용, 하나만 있으면 됨)
   - `GA4_PROPERTY_ID_UPMERY` — 업메리 GA4 속성 ID(숫자)
   - `GA4_PROPERTY_ID_MAJALNAM` — 마잘남 GA4 속성 ID(숫자)
5. 새 브랜드를 추가로 연결하려면 그 브랜드 GA4 속성에도 같은 서비스 계정을 뷰어로 추가하고,
   `api/cron/radar.ts`의 `PROPERTY_ID_ENV_KEY`에 해당 브랜드→환경변수 이름 매핑을 한 줄 추가하면 됨
   (속성 ID 환경변수가 비어있는 브랜드는 자동으로 건너뜀 — 에러 아님)
- 구현: `api/_lib/ga4.ts`(서비스 계정 JWT로 GA4 Data API 직접 호출, 별도 SDK 없음 — Node
  내장 `crypto`로 RS256 서명)

## DB 스키마
`db/schema.sql` — Supabase SQL Editor에 그대로 붙여넣어 실행. 6개 테이블
(`work_log`, `approval_queue`, `calendar_entries`, `agency_clients`, `reference_images`, `brain_reports`,
`radar_snapshots`),
select/insert/update 전부 공개 키로 가능(아래 겪었던 문제 참고 — upsert 때문에 select도 열어둠).

**주의**: `schema.sql` 파일에 새 테이블/정책을 추가해도 이미 만들어진 라이브 DB에는
자동 반영되지 않는다. 새 테이블이 추가될 때마다(예: `reference_images`) SQL Editor에서
그 `create table ...`/`create policy ...` 블록만 따로 다시 실행해야 한다.

### 겪었던 문제 (2026-07-11) — RLS 정책이 `to anon`이면 새 키 체계에서 막힘
연결 테스트에서 `401 / new row violates row-level security policy` 에러가 났다.
원인: `db/schema.sql`의 정책을 처음에 `to anon`으로 만들었는데, Supabase의 새
Publishable/Secret 키 체계에서는 요청이 항상 legacy `anon` Postgres 역할로
매핑되는 게 아니라서 정책이 안 먹힘.

**해결**: 정책 대상을 `to anon`에서 **`to public`**으로 변경(이 프로젝트의 모든 역할을
포함하는 pseudo-role이라 새 키 체계와도 호환됨). 이미 만든 테이블이 있으면 SQL Editor에서
기존 정책을 `drop policy`로 지우고 `db/schema.sql`의 새 버전으로 다시 만들어야 한다
(파일을 갱신한다고 이미 살아있는 DB의 정책이 자동으로 바뀌진 않음).

### 겪었던 문제 (2026-07-11) — 정책을 `to public`으로 바꿔도 여전히 같은 401 에러
위 정책을 `to public`으로 바꾸고 SQL Editor에서 재실행까지 했는데도 연결 테스트가
똑같이 `42501 / new row violates row-level security policy for table "work_log"`로
실패했다.

**진짜 원인**: RLS 정책 문제가 아니었다. `db/schema.sql`은 보안을 위해 일부러
select 정책을 만들지 않았는데(공개 키가 유출돼도 데이터를 통째로 읽을 수 없게),
PostgREST는 기본적으로 INSERT/UPDATE 후 **방금 쓴 행을 응답으로 돌려주려고
내부적으로 그 행을 SELECT**한다. INSERT의 `with check(true)`는 통과하지만,
그 직후 응답용 SELECT에서 걸리는 select 정책이 없어서 Postgres가 똑같은
"new row violates row-level security policy" 에러를 낸다 — INSERT 자체는
성공 직전까지 갔는데 응답 생성 단계에서 막히는 것.

**해결 시도했으나 불충분했던 것**: `Prefer: resolution=merge-duplicates,return=minimal` 추가.
RETURNING 관련 select 요구는 없앴지만, 진짜 원인은 따로 있었다(아래).

### 겪었던 문제 (2026-07-11) — 진짜 원인: upsert(ON CONFLICT DO UPDATE)가 select 정책을 요구함
위 두 시도 후에도 똑같은 401 RLS 에러가 반복됐다. Supabase SQL Editor에서
`set role anon`으로 직접 `insert ... on conflict (id) do update set ...`을
실행해서 재현에 성공했다 — 단순 insert는 성공하는데 upsert만 실패했다.

**원인**: Postgres는 `INSERT ... ON CONFLICT DO UPDATE` 실행 시, 실제로 겹치는
행이 있는지 확인하려고 대상 컬럼(여기서는 `id`)에 대한 **select 권한**을
내부적으로 요구한다. `db/schema.sql`은 보안을 위해 select 정책을 아예 안
만들어놨었기 때문에(insert/update만 허용), 겹침 확인 단계에서부터
RLS 위반으로 막혔다 — insert/update 정책이 전부 `with check(true)`여도
소용없었다.

**해결**: 4개 테이블 모두에 `create policy "select X" on X for select to public using (true);`
추가(`db/schema.sql`에 반영됨). 이 프로젝트는 대표님만 쓰는 내부 도구라
select 노출 리스크보다 업서트 동작이 우선이라는 판단. 이미 만든 프로젝트는
SQL Editor에서 위 select policy들을 4개 테이블에 대해 직접 실행해야
반영된다(파일만 갱신해선 안 됨, 이전 항목과 동일한 주의사항).

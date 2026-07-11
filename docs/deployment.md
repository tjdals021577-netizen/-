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
- `morning.ts`: 매일 08:00 KST(23:00 UTC) — 브랜드별로 오늘 근무기록을 모아 브리핑 생성
- `brain.ts`: 매월 1일 09:00 KST(00:00 UTC) — 브랜드별로 "이번 달 트렌드" 기본 주제로 웹서치 리서치
- 스케줄은 저장소 루트의 `vercel.json` 참고
- 이 둘은 Supabase에 실제로 데이터가 쌓이고 있어야 의미가 있다(`work_log` 테이블을 읽어서 씀) —
  즉 Supabase 연결이 실제로 되고 있는지 먼저 확인 필수
- `캘린` `코치`는 크론 없음: 캘린은 콘텐츠 생성 자체가 아직 로컬/수동이라 크론이 읽을 서버
  데이터가 마땅치 않고, 코치는 사람이 스크린샷을 직접 올려야 해서 애초에 자동화 불가능

## DB 스키마
`db/schema.sql` — Supabase SQL Editor에 그대로 붙여넣어 실행. 4개 테이블
(`work_log`, `approval_queue`, `calendar_entries`, `agency_clients`), RLS로
공개 키는 insert/update만 가능(select/delete 불가 — 배포된 키가 노출돼도
데이터를 통째로 읽거나 지울 수는 없음).

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

**해결**: `src/lib/remoteSync.ts`의 두 fetch 요청 헤더에 `Prefer: resolution=merge-duplicates,return=minimal`
추가 — "쓴 행을 돌려줄 필요 없다"고 명시하면 select 정책 없이도 insert/update가
끝까지 성공한다. select를 막아둔 보안 설계는 그대로 유지됨.

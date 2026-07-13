# 브랜드 분리 & 데이터 저장 구조

## 브랜드 분리
- `src/types/brand.ts`: `Brand = '업메리' | '마잘남'`, `BRAND_CONTEXT`(톤 설명 — 아직
  플레이스홀더), `BRAND_CHANNELS`(업메리=블로그만, 마잘남=스레드+블로그+유튜브)
- 헤더의 브랜드 토글(`AppShell.tsx`)이 `brand` 상태를 갖고, 대부분의 화면(운영실/팀채팅/
  캘린더/결재함)에 prop으로 내려가서 **그 브랜드의 데이터만** 보이게 필터링함
  (대시보드만 예외 — 항상 둘 다 보여줌, `workflow.md` 참고)
- 업메리 선택 시 운영실에서 스레드/유튜브 기획 탭 자체가 안 보임 (`BRAND_CHANNELS` 기준)
- 모든 저장 함수(`startWorkLog`, `submitForApproval`, `createEntry` 등)가 `brand`를 필수로 받음

## localStorage 키 (브라우저 저장)
| 키 | 내용 | 관련 파일 |
|---|---|---|
| `ai-ops:anthropic-api-key` | Anthropic API 키 | `src/lib/apiKey.ts` |
| `ai-ops:daily-spend` | 오늘 날짜별 누적 사용액 | `src/lib/budgetGuard.ts` |
| `ai-ops:work-log` | 전체 근무기록 | `src/lib/workLog.ts` |
| `ai-ops:approval-queue` | 결재함 | `src/lib/approvalStore.ts` |
| `ai-ops:content-calendar` | 캘린더 | `src/lib/calendarStore.ts` |
| `ai-ops:agency-clients` | 대행 클라이언트 | `src/lib/agencyStore.ts` |
| `ai-ops:reference-library` | 카피라이팅 레퍼런스 이미지(최대 40개, base64) | `src/lib/referenceStore.ts` |
| `ai-ops:unlocked` (sessionStorage) | 비밀번호 게이트 통과 여부 | `src/lib/appPassword.ts` |

**주의**: 전부 브라우저별로 따로 저장됨. 다른 컴퓨터/다른 브라우저에서 접속하면 이 데이터가
안 보임 (Supabase 연결 전까지는 이게 한계). `localhost`와 실제 배포 주소도 서로 다른
"사이트"라 데이터가 공유되지 않음(API 키도 각자 다시 넣어야 함).

## Supabase (서버 저장, 선택사항)
- `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`가 설정된 경우에만 동작. 없으면 완전히 조용히
  꺼진 상태로 로컬만 사용(`src/lib/remoteSync.ts`)
- 로컬 저장 성공 직후 **비동기로 같은 레코드를 Supabase에도 복제**(dual-write) — 로컬 저장을
  절대 막지 않음(네트워크 실패해도 조용히 무시)
- 스키마: `db/schema.sql` — localStorage 구조와 1:1 대응, id도 프론트에서 만든 문자열
  그대로 사용(충돌 방지)
- 자세한 배포/환경변수 설정은 `deployment.md` 참고

## 지금 남은 것
- 브랜드 보이스(`BRAND_CONTEXT`)는 아직 플레이스홀더 텍스트 — 레이더(Threads/아임웹 API) 연동해서
  실제 게시물 데이터를 가져올 때 같이 실제 톤으로 교체 예정 (스크린샷 방식은 이중작업이라 보류)
- 레이더 — GA4는 2026-07-13부터 연결 시작(`workflow.md`의 "레이더" 절 참고). 유튜브/메타/아임웹은
  아직 미연결(각각 별도 자격증명 필요, 순차 진행 중)

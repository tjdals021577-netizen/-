# 콘텐츠 워크플로우 (생성 이후)

## 결재함 (승인 대기함)
- 화면: `src/components/screens/ApprovalScreen.tsx`
- 저장소: `src/lib/approvalStore.ts` (localStorage) + Supabase `approval_queue` 테이블
- 라이터·버즈·리믹서·대행 초안이 생성 완료되는 즉시 자동으로 여기 올라옴
  (운영실에서 직접 만들든, 팀 채팅에서 지시하든 동일)
- 탭: 대기중 / 승인됨 / 반려됨. 항목 펼치면 전체 내용 + **"전체 내용 복사"** 버튼
  (HTML 태그 제거된 순수 텍스트로 클립보드 복사 — 네이버 블로그 등에 수동 붙여넣기용)
- 승인/반려는 지금은 **기록용**이다. 실제 발행(네이버/스레드/유튜브 업로드)은 아직 사람이 수동으로 함

## 캘린더
- 화면: `src/components/screens/CalendarScreen.tsx`
- 저장소: `src/lib/calendarStore.ts` (localStorage) + Supabase `calendar_entries` 테이블
- 라이터·버즈·리믹서·대행이 생성 완료되면 **자동으로** 오늘 날짜에 전체 내용과 함께 등록됨
  (`createEntry` 직접 호출 — 결재함과 동시에 채워짐)
- `importTodayFromWorkLog()`: 화면 열 때마다 자동으로 한 번 더 돌아서, 혹시 놓친 근무기록이
  있으면 백업으로 가져옴 (같은 `sourceWorkLogId`면 중복 등록 안 함)
- 일정 클릭하면 펼쳐져서 전체 내용 확인 가능 (전에는 짧은 메모만 보여서 확인이 안 됐던 문제 해결됨)
- 채널: `blog` / `thread` / `youtube` / `agency` / `etc`

## 대행 관리
- 화면: `src/components/screens/AgencyScreen.tsx`
- 저장소: `src/lib/agencyStore.ts` (localStorage) + Supabase `agency_clients` 테이블
- 온보딩: 구글폼 응답 + 스레드 링크를 텍스트로 붙여넣으면 AI가 페르소나 자동 정리
  (`src/agents/agencyOnboarding.ts`). 여기서 레퍼런스 이미지도 같이 넣을 수 있는데,
  라이브러리에서 골라도 되고 그 자리에서 바로 사진을 올려도 됨(올린 사진은 자동으로
  레퍼런스 라이브러리에 그 클라이언트 이름으로 저장돼 `referenceImageIds`에 연결됨)
- 클라이언트당 "오늘 초안 5개 생성" 버튼 — 버즈 로직 재사용, 클라이언트의 `persona`를
  브랜드 보이스로 사용. 레퍼런스가 지정돼 있으면 매번 비전 호출로 스타일도 함께 참고함.
  항상 브랜드는 `마잘남`으로 고정 기록(대행 서비스 자체가 마잘남 사업이므로)
- "레퍼런스로 재요청" 버튼: 초안이 마음에 안 들 때 새 레퍼런스(라이브러리 선택 또는
  그 자리에서 직접 첨부, 둘 다 가능)를 넣고 채점 없이 시안 3개를 바로 받는 기능
- 계약 연장/일시중단/재개 시 종료일 자동 계산 (`daysRemaining`, `pausedDaysSoFar` 등)

## 팀 채팅
- 화면: `src/components/screens/TeamChatScreen.tsx`
- 실제 라이브 채팅 피드 UI — 근무기록 한 건을 "사용자 지시 버블 + 에이전트 결과 버블 +
  상태변경 시스템 메시지"로 재구성해서 보여줌 (테이블이 아니라 대화 형태)
- 좌측: AI 팀원 목록 + 업무중/휴식중 상태(그 에이전트에 `running` 상태 근무기록이 있는지로 판단)
- 우측: 선택된 에이전트의 오늘 처리 건수/사용액/마지막 실행 + 팀 전체 "최근 대화"
- 실제 실행 가능(dispatchable): 라이터·버즈·리믹서·브레인 (`src/agents/dispatch.ts`)
- 모닝·코치는 대시보드에서, 캘린은 캘린더 화면에서 직접 실행하도록 안내 메시지만 표시
- 레이더는 아직 직접 실행 UI는 없음 — 크론으로만 도는 자동 수집(아래 "레이더" 절 참고)

## 레이더 (GA4 + 아임웹 자동 수집) — 2026-07-13부터
- 로직: `api/_lib/ga4.ts`(서비스 계정 JWT로 GA4 Data API 직접 호출), `api/_lib/imweb.ts`
  (API Key+Secret으로 아임웹 오픈 API 호출), `api/cron/radar.ts`(매일 07:50 KST —
  모닝 크론 10분 전에 실행, 브랜드마다 GA4·아임웹 각각 독립적으로 시도)
- **GA4**: 서비스 계정(`GA4_SERVICE_ACCOUNT_KEY`)은 공용, 속성 ID만 브랜드별 환경변수
  (`GA4_PROPERTY_ID_UPMERY`, `GA4_PROPERTY_ID_MAJALNAM`)로 분리
- **아임웹**: 브랜드별로 아임웹 관리자 → 외부 서비스 연동(API)에서 발급받은 키를
  `IMWEB_API_KEY_UPMERY`/`IMWEB_SECRET_KEY_UPMERY`, `IMWEB_API_KEY_MAJALNAM`/
  `IMWEB_SECRET_KEY_MAJALNAM`로 등록. 주문수·매출(KRW) 수집
- 소스별 환경변수가 비어있으면 그 소스만 조용히 건너뜀(에러 아님) — GA4/아임웹을
  브랜드마다 독립적으로 하나씩 연결해가는 걸 전제로 설계함
- 결과는 Supabase `radar_snapshots` 테이블에 브랜드×소스 조합으로 하루 한 건씩 쌓임
  (`source` 컬럼이 `ga4`/`imweb` 구분 — GA4 행은 방문자·세션·전환·인기 페이지·유입경로,
  아임웹 행은 주문수·매출)
- 이 데이터를 **모닝 크론이 자동으로 읽어서** 브리핑에 반영(`api/cron/morning.ts`의
  `buildRadarText`, GA4/아임웹 둘 다 있으면 둘 다 포함) — "어제 방문자·매출 반응이
  어땠는지 보고 다음 방향 추천"까지 매일 아침 자동으로 나옴(원래 목표였던 기능)
- **자격증명 설정 방법**은 `deployment.md`의 "레이더(GA4) 연결" / "레이더(아임웹 주문/매출)
  연결" 절 참고
- **아임웹 응답 필드명 검증 필요**: 개발 당시 네트워크 정책상 `api.imweb.me`에 직접
  접속해 실제 응답을 확인하지 못했다 — 처음 실제로 돌 때 `work_log`에 원본 응답 샘플이
  "아임웹 주문 응답 샘플(디버그)"로 남으니, 매출 숫자가 비거나 이상하면 그 로그를 보고
  `api/_lib/imweb.ts`의 필드명 후보 목록을 조정할 것
- 유튜브/메타는 아직 미연결 — 각각 OAuth 앱 등록 등 별도 절차 필요, 순차 진행 예정

## 대시보드
- 화면: `src/components/screens/DashboardScreen.tsx`
- **브랜드 토글(헤더)과 무관하게 업메리/마잘남 두 섹션을 항상 동시에 보여줌** — 대시보드만
  "전체를 한눈에" 보는 용도라 다른 화면(운영실/팀채팅/캘린더/결재함, 브랜드별로 필터링됨)과
  다르게 동작함
- 방문자/유입경로/인기 페이지(GA4)·주문/매출(아임웹)은 `src/lib/radarStore.ts`로 Supabase
  `radar_snapshots`의 최신 행을 브랜드×소스별로 읽어서 표시(레이더 크론이 연결 안 된
  브랜드/소스는 여전히 `—`로 보임)
- 모닝·코치 패널이 브랜드별로 각각 하나씩(총 2세트) 들어있음

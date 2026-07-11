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
  (`src/agents/agencyOnboarding.ts`)
- 클라이언트당 "오늘 초안 5개 생성" 버튼 — 버즈 로직 재사용, 클라이언트의 `persona`를
  브랜드 보이스로 사용. 항상 브랜드는 `마잘남`으로 고정 기록(대행 서비스 자체가 마잘남 사업이므로)
- 계약 연장/일시중단/재개 시 종료일 자동 계산 (`daysRemaining`, `pausedDaysSoFar` 등)

## 팀 채팅
- 화면: `src/components/screens/TeamChatScreen.tsx`
- 실제 라이브 채팅 피드 UI — 근무기록 한 건을 "사용자 지시 버블 + 에이전트 결과 버블 +
  상태변경 시스템 메시지"로 재구성해서 보여줌 (테이블이 아니라 대화 형태)
- 좌측: AI 팀원 목록 + 업무중/휴식중 상태(그 에이전트에 `running` 상태 근무기록이 있는지로 판단)
- 우측: 선택된 에이전트의 오늘 처리 건수/사용액/마지막 실행 + 팀 전체 "최근 대화"
- 실제 실행 가능(dispatchable): 라이터·버즈·리믹서·브레인 (`src/agents/dispatch.ts`)
- 모닝·코치는 대시보드에서, 캘린은 캘린더 화면에서 직접 실행하도록 안내 메시지만 표시
- 레이더는 아직 스케줄러 붙기 전이라 화면만 있음

## 대시보드
- 화면: `src/components/screens/DashboardScreen.tsx`
- **브랜드 토글(헤더)과 무관하게 업메리/마잘남 두 섹션을 항상 동시에 보여줌** — 대시보드만
  "전체를 한눈에" 보는 용도라 다른 화면(운영실/팀채팅/캘린더/결재함, 브랜드별로 필터링됨)과
  다르게 동작함
- 방문자/유입경로/결제전환/블로그 성과는 아직 placeholder(`—`) — Phase 4 레이더 연동 대기
- 모닝·코치 패널이 브랜드별로 각각 하나씩(총 2세트) 들어있음

# 프로젝트 문서 안내

업메리·마잘남 AI 운영 플랫폼 — 영역별로 문서를 나눠뒀습니다. 문제가 생기면 관련된
파일 하나만 보면 되게 구성했습니다.

- [deployment.md](./deployment.md) — Vercel/Supabase 배포, 환경변수, 배포 관련 트러블슈팅
- [content-agents.md](./content-agents.md) — 라이터·버즈·리믹서·브레인·코치·모닝 (콘텐츠 생성 에이전트)
- [workflow.md](./workflow.md) — 캘린더·결재함·대행 관리·팀 채팅 (콘텐츠가 만들어진 뒤의 흐름)
- [data-and-brand.md](./data-and-brand.md) — 업메리/마잘남 브랜드 분리, 데이터 저장 구조(localStorage + Supabase)

## 기술 스택 한눈에
- React 19 + Vite + TypeScript + Tailwind CSS v4
- Anthropic 호출은 서버가 대행(`api/claude-proxy.ts`) — 브라우저는 실제 API 키를 갖지 않는다
  (2026-07-14 이전엔 BYOK 방식으로 브라우저 localStorage에 키를 저장했는데, 사파리 프라이빗
  모드 등으로 "들어갈 때마다 키가 없어진다"는 문제가 반복돼서 없앴다)
- 데이터는 브라우저 localStorage가 기본, Supabase 연결 시 자동으로 서버에도 복제(dual-write)
- 배포: Vercel (프론트엔드 + `/api` 크론 함수 + `/api/claude-proxy` 중계 함수)

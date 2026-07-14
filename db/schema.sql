-- AI 콘텐츠 운영 플랫폼 — Phase 4 데이터베이스 스키마 (Supabase/Postgres)
-- 프론트엔드 localStorage 레코드와 1:1로 대응한다. id는 프론트에서 만든
-- 문자열 ID를 그대로 쓴다(UUID로 재발급하지 않음 — dual-write 시 충돌 방지).

create table if not exists work_log (
  id text primary key,
  agent text not null,
  brand text not null,
  kind text not null,
  status text not null,
  status_label text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  cost_usd numeric,
  note text,
  detail_html text,
  synced_at timestamptz not null default now()
);
create index if not exists work_log_brand_idx on work_log (brand, started_at desc);
create index if not exists work_log_agent_idx on work_log (agent, started_at desc);

create table if not exists approval_queue (
  id text primary key,
  agent text not null,
  brand text not null,
  title text not null,
  content_html text not null,
  passed boolean not null,
  score_label text not null,
  created_at timestamptz not null,
  status text not null,
  reviewed_at timestamptz,
  review_note text,
  source_work_log_id text,
  synced_at timestamptz not null default now()
);
create index if not exists approval_queue_brand_status_idx on approval_queue (brand, status);

create table if not exists calendar_entries (
  id text primary key,
  date date not null,
  brand text not null,
  channel text not null,
  title text not null,
  status text not null,
  note text,
  content_html text,
  created_at timestamptz not null,
  source_work_log_id text,
  synced_at timestamptz not null default now()
);
create index if not exists calendar_entries_brand_date_idx on calendar_entries (brand, date);

create table if not exists agency_clients (
  id text primary key,
  name text not null,
  business text not null,
  persona text,
  thread_url text,
  memo text,
  status text not null,
  start_date date not null,
  end_date date not null,
  monthly_fee_krw integer,
  history jsonb not null default '[]',
  today_drafts jsonb not null default '[]',
  today_drafts_date date,
  recent_draft_texts jsonb not null default '[]',
  paused_at date,
  reference_image_ids jsonb not null default '[]',
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);

-- 카피라이팅 레퍼런스 이미지 라이브러리. base64로 그대로 저장한다(Storage
-- 버킷 없이 REST insert 하나로 끝내려는 목적) — 이미지가 커서 text 컬럼이
-- 비대해질 수 있지만, 대표님 혼자 쓰는 내부 도구라 우선 단순한 쪽을 택함.
create table if not exists reference_images (
  id text primary key,
  label text not null,
  image_base64 text not null,
  media_type text not null,
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index if not exists reference_images_created_idx on reference_images (created_at desc);

-- 브레인이 조사한 결과를 구조화해서 저장 — 라이터/버즈/리믹서가 생성할 때
-- 최신 리서치를 다시 찾아서 참고 자료로 넣을 수 있게 한다.
create table if not exists brain_reports (
  id text primary key,
  brand text not null,
  topic text not null,
  findings jsonb not null default '[]',
  summary text not null,
  recommendations jsonb not null default '[]',
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index if not exists brain_reports_brand_idx on brain_reports (brand, created_at desc);

-- 레이더(GA4·아임웹 등 외부 성과 데이터)가 매일 수집한 스냅샷 — 모닝 브리핑이
-- 참고하고, 대시보드가 방문자/유입경로/주문/매출 등을 표시할 때 이 테이블의
-- 최신 행을 읽는다. source 컬럼으로 브랜드당 하루에 여러 소스(ga4, imweb 등)를
-- 각각 한 행씩 저장한다 — order_count/revenue_krw는 아임웹 등 커머스 소스 전용,
-- GA4 소스 행에서는 null.
create table if not exists radar_snapshots (
  id text primary key,
  brand text not null,
  source text not null,
  period_label text not null,
  sessions integer not null default 0,
  active_users integer not null default 0,
  conversions integer not null default 0,
  top_pages jsonb not null default '[]',
  traffic_sources jsonb not null default '[]',
  order_count integer,
  revenue_krw numeric,
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index if not exists radar_snapshots_brand_idx on radar_snapshots (brand, created_at desc);

-- 카카오 "나에게 보내기" refresh_token 저장 — 딱 한 행(id='default')만 씀.
-- 모닝 크론이 매일 이 토큰으로 access_token을 새로 받아서 카톡을 보낸다.
create table if not exists kakao_tokens (
  id text primary key,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

-- 대표님 혼자 쓰는 BYOK 도구라 사용자별 RLS는 필요 없다. 크론 함수는
-- secret(service role) 키로 RLS를 우회해서 자유롭게 읽고 쓴다.
--
-- 정책 대상을 `anon`이 아니라 `public`으로 지정한다 — Supabase의 새
-- Publishable/Secret 키 체계에서는 요청이 항상 legacy `anon` Postgres
-- 역할로 매핑되는 게 아니어서, `to anon`으로 만들면 새 키로 들어오는
-- 요청이 "new row violates row-level security policy" 에러로 막힐 수
-- 있다(실제로 겪은 문제). `to public`은 이 프로젝트의 모든 역할을
-- 포함하는 pseudo-role이라 이 문제를 피해간다.
--
-- select 정책도 열어둔다. 원래는 "공개 키가 유출돼도 데이터를 못 읽게"
-- select를 막아뒀는데, 프론트엔드가 dual-write에 upsert(`Prefer:
-- resolution=merge-duplicates`, 즉 `insert ... on conflict do update`)를
-- 쓰기 때문에 select 정책이 없으면 Postgres가 "겹치는 행이 있는지" 확인하는
-- 단계에서부터 막혀서 insert/update 정책이 전부 true여도 매번
-- "new row violates row-level security policy" 에러가 난다(실제로 겪은
-- 문제 — insert 단독 테스트는 성공하는데 upsert만 실패해서 원인 특정에
-- 오래 걸렸다). 이 프로젝트는 대표님만 쓰는 내부 도구라 select 노출
-- 리스크보다 업서트 동작이 우선이라 열어두는 쪽으로 결정.
alter table work_log enable row level security;
alter table approval_queue enable row level security;
alter table calendar_entries enable row level security;
alter table agency_clients enable row level security;
alter table reference_images enable row level security;
alter table brain_reports enable row level security;
alter table radar_snapshots enable row level security;
alter table kakao_tokens enable row level security;

create policy "select work_log" on work_log for select to public using (true);
create policy "insert work_log" on work_log for insert to public with check (true);
create policy "update work_log" on work_log for update to public using (true) with check (true);

create policy "select approval_queue" on approval_queue for select to public using (true);
create policy "insert approval_queue" on approval_queue for insert to public with check (true);
create policy "update approval_queue" on approval_queue for update to public using (true) with check (true);

create policy "select calendar_entries" on calendar_entries for select to public using (true);
create policy "insert calendar_entries" on calendar_entries for insert to public with check (true);
create policy "update calendar_entries" on calendar_entries for update to public using (true) with check (true);

create policy "select agency_clients" on agency_clients for select to public using (true);
create policy "insert agency_clients" on agency_clients for insert to public with check (true);
create policy "update agency_clients" on agency_clients for update to public using (true) with check (true);

create policy "select reference_images" on reference_images for select to public using (true);
create policy "insert reference_images" on reference_images for insert to public with check (true);
create policy "update reference_images" on reference_images for update to public using (true) with check (true);

create policy "select brain_reports" on brain_reports for select to public using (true);
create policy "insert brain_reports" on brain_reports for insert to public with check (true);
create policy "update brain_reports" on brain_reports for update to public using (true) with check (true);

create policy "select radar_snapshots" on radar_snapshots for select to public using (true);
create policy "insert radar_snapshots" on radar_snapshots for insert to public with check (true);
create policy "update radar_snapshots" on radar_snapshots for update to public using (true) with check (true);

create policy "select kakao_tokens" on kakao_tokens for select to public using (true);
create policy "insert kakao_tokens" on kakao_tokens for insert to public with check (true);
create policy "update kakao_tokens" on kakao_tokens for update to public using (true) with check (true);

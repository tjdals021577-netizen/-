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
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);

-- 대표님 혼자 쓰는 BYOK 도구라 사용자별 RLS는 필요 없다. 다만 프론트엔드에
-- 박히는 publishable key가 외부에 노출되므로, insert/update만 허용하고
-- select/delete는 막는다 — 크론 함수는 secret(service role) 키로 RLS를
-- 우회해서 자유롭게 읽고 쓴다.
--
-- 정책 대상을 `anon`이 아니라 `public`으로 지정한다 — Supabase의 새
-- Publishable/Secret 키 체계에서는 요청이 항상 legacy `anon` Postgres
-- 역할로 매핑되는 게 아니어서, `to anon`으로 만들면 새 키로 들어오는
-- 요청이 "new row violates row-level security policy" 에러로 막힐 수
-- 있다(실제로 겪은 문제). `to public`은 이 프로젝트의 모든 역할을
-- 포함하는 pseudo-role이라 이 문제를 피해간다.
alter table work_log enable row level security;
alter table approval_queue enable row level security;
alter table calendar_entries enable row level security;
alter table agency_clients enable row level security;

create policy "insert work_log" on work_log for insert to public with check (true);
create policy "update work_log" on work_log for update to public using (true) with check (true);

create policy "insert approval_queue" on approval_queue for insert to public with check (true);
create policy "update approval_queue" on approval_queue for update to public using (true) with check (true);

create policy "insert calendar_entries" on calendar_entries for insert to public with check (true);
create policy "update calendar_entries" on calendar_entries for update to public using (true) with check (true);

create policy "insert agency_clients" on agency_clients for insert to public with check (true);
create policy "update agency_clients" on agency_clients for update to public using (true) with check (true);

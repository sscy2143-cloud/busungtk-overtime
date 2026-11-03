-- ⚠ 로컬 시험 전용. 운영 Supabase 에서 실행 금지 (운영에는 이 객체들이 이미 있다).
-- ============================================================
-- Supabase 가 기본으로 제공하는 것을 빈 PostgreSQL(pglite 등)에 흉내 낸다.
-- 010~040 이 기대는 것: 역할 anon/authenticated/service_role, auth.uid(), update_updated_at_column(),
-- public.employees(id, role, is_active, ...), public.overtime_requests(employee_id, date, planned_start, planned_end, status)
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create extension if not exists pgcrypto;

create schema if not exists auth;

-- 세션 설정값으로 로그인 사용자를 흉내 낸다:  select set_config('request.jwt.claim.sub', '<uuid>', false);
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- service_role 판정용 (trip_store_server_calcs 가 읽는 값):
--   select set_config('request.jwt.claims', '{"role":"service_role"}', false);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 기존 운영 표의 최소 모양 (칼럼 이름·타입은 운영과 같게. 운영 대조 C-6·C-10 뒤 필요하면 고친다)
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  role        text not null default 'employee' check (role in ('employee', 'manager', 'admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.overtime_requests (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  date           date not null,
  planned_start  text,
  planned_end    text,
  status         text not null default 'pending',
  created_at     timestamptz not null default now()
);

grant usage on schema public to anon, authenticated, service_role;
grant select on public.employees, public.overtime_requests to authenticated, service_role;

-- 시험용 직원 (id 고정 — 시험 스크립트가 같은 값을 쓴다)
insert into public.employees (id, name, role) values
  ('00000000-0000-0000-0000-000000000001', '김직원', 'employee'),
  ('00000000-0000-0000-0000-000000000002', '이동행', 'employee'),
  ('00000000-0000-0000-0000-000000000009', '박대표', 'admin')
on conflict (id) do nothing;

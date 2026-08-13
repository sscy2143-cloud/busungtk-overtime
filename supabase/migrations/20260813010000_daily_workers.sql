-- 일용직 사원 관리
-- admin/manager(급여 담당)만 조회/수정 가능 (주민번호 등 민감정보 포함)

create table if not exists daily_workers (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'active', -- 'active' 재직 | 'inactive' 퇴직
  name              text not null,
  resident_number   text,   -- 주민(외국인)번호
  project           text,   -- 프로젝트/현장
  nationality       text,   -- 국적
  visa_status       text,   -- 체류자격
  job_type          text,   -- 직종
  hire_date         date,   -- 입사일
  daily_wage        integer not null default 0, -- 일지급금
  bank              text,
  account_number    text,
  mobile_phone      text,
  phone             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger daily_workers_updated_at
  before update on daily_workers
  for each row execute function update_updated_at_column();

alter table daily_workers enable row level security;

create policy "daily_workers_payroll_staff_only"
  on daily_workers for all
  using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

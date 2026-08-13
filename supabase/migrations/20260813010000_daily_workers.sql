-- 일용직 사원 관리
-- admin/manager(급여 담당)만 조회/수정 가능 (주민번호 등 민감정보 포함)
-- 일용직은 재직 개념이 아니라 시공건이 있을 때만 사용하므로 재직상태는 두지 않고,
-- 대신 실제로 일한 날짜(work_date)와 자유메모(note)를 남길 수 있게 함

create table if not exists daily_workers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  resident_number   text,   -- 주민(외국인)번호
  project           text,   -- 프로젝트/현장
  nationality       text,   -- 국적
  visa_status       text,   -- 체류자격
  job_type          text,   -- 직종
  work_date         date,   -- 근무 시작일 (하루만 일했으면 이 날짜만)
  work_date_end     date,   -- 근무 종료일 (연속 근무 시, 없으면 시작일과 동일한 하루로 간주)
  daily_wage        integer not null default 0, -- 지급액 (근무기간 전체 합계)
  bank              text,
  account_number    text,
  mobile_phone      text,
  phone             text,
  note              text,   -- 비고
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

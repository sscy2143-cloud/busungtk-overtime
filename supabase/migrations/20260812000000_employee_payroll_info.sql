-- 급여명세서: 직원별 공제대상가족수/자녀수/두루누리 적용여부 저장
-- admin(신채영)만 조회/수정 가능하도록 별도 테이블 + 전용 RLS로 분리 (employees 테이블 RLS는 본인/매니저도 조회 가능해서 부적합)

create table if not exists employee_payroll_info (
  employee_id             uuid primary key references employees(id) on delete cascade,

  -- 필수
  base_salary             integer not null default 0,   -- 월급(기본급)
  annual_salary           integer not null default 0,   -- 연봉
  salary_bank             text not null default '',     -- 급여은행
  salary_account          text not null default '',     -- 급여계좌

  -- 선택
  fixed_allowance_enabled boolean not null default false, -- 고정수당 여부
  fixed_allowance_type    text,                            -- 고정수당 종류
  is_executive            boolean not null default false,  -- 임원구분(임원이면 true)
  dependents_count        integer not null default 1,   -- 소득공제부양자 수(본인 포함)
  children_under20_count  integer not null default 0,   -- 공제대상 중 8세 이상 20세 이하 자녀수
  student_loan_status     text,                            -- 학자금 상환여부
  student_loan_start      date,
  student_loan_end        date,
  student_loan_amount     integer not null default 0,     -- 학자금 상환금액
  sme_tax_reduction_enabled boolean not null default false, -- 중소기업취업소득세감면 여부
  sme_tax_reduction_start date,
  sme_tax_reduction_end   date,
  sme_reduction_applicable text,                           -- 중소기업감면적용
  sme_income_reduction_rate numeric,                       -- 중소기업소득감면율(%)
  doorunuri_applicable     boolean not null default false, -- 두루누리 지원 적용대상 여부 (명세서엔 출력 안 함, 내부 기록용)
  doorunuri_pension_reduction_rate numeric,                -- 두루누리 국민연금감면율(%)
  doorunuri_employment_reduction_rate numeric,             -- 두루누리 고용보험감면율(%)
  pension_bank            text,                            -- 퇴직연금은행
  pension_account         text,                            -- 퇴직연금계좌

  updated_at              timestamptz not null default now()
);

create trigger employee_payroll_info_updated_at
  before update on employee_payroll_info
  for each row execute function update_updated_at_column();

alter table employee_payroll_info enable row level security;

-- admin/manager(급여 담당)만 조회·수정 가능
create policy "employee_payroll_info_payroll_staff_only"
  on employee_payroll_info for all
  using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

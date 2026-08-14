-- 임금명세서 법정 기재사항(근로기준법 시행령 제27조의2) 대응: 생년월일 컬럼 추가
alter table employee_payroll_info add column if not exists birth_date date;

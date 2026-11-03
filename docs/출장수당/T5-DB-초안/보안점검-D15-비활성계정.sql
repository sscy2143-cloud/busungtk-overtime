-- D15 사전 확인 — 읽기 전용 (SELECT 1개). 비활성 직원의 인증 계정 상태를 본다 (사용자만 보는 결과, 채팅에 올리지 않는다).
-- 실제 퇴사자(장기 미로그인·입사일 오래됨)와 "임시 비활성" 을 구분하는 근거: last_sign_in_at, updated_at, 최근 야근 신청 여부.
select
  e.name,
  e.role,
  e.department,
  e.hire_date,
  e.updated_at::date                                   as employees_updated,
  u.last_sign_in_at::date                              as last_sign_in,
  (u.banned_until is not null and u.banned_until > now()) as banned,
  u.banned_until::date                                 as banned_until,
  (select count(*) from public.overtime_requests o where o.employee_id = e.id and o.created_at > now() - interval '90 days') as overtime_requests_90d,
  (select max(o.created_at)::date from public.overtime_requests o where o.employee_id = e.id) as last_overtime_request
from public.employees e
left join auth.users u on u.id = e.id
where e.is_active = false
order by e.name;

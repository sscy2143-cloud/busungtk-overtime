-- READ ONLY. 출장수당 SQL 적용 후 사후 점검. 아무것도 바꾸지 않는다.
-- [1] anon 이 실행할 수 있는 public 함수 (definer 와 trip 함수 모두). 0 행이어야 한다.
select p.oid::regprocedure::text as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.prosecdef or p.proname like 'trip\_%' or p.proname like '\_trip\_%')
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1;
-- [2] RLS 가 꺼져 있거나 anon 이 접근할 수 있는 신규 표. 0 행이어야 한다.
select c.relname as table_name, c.relrowsecurity as rls,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (c.relname like 'trip\_%' or c.relname = 'holidays')
  and (not c.relrowsecurity
       or has_table_privilege('anon', c.oid, 'SELECT'))
order by 1;
-- [3] 기능 스위치. enabled 가 모두 false 여야 한다.
select key, enabled from public.trip_feature_flags order by key;
-- [4] employees 의 사용자 트리거 목록. 모두 enabled = O 여야 한다.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.employees'::regclass and not tgisinternal
order by tgname;
-- [5] 기존 데이터 건수. 적용 전 값과 같아야 한다 (이름·금액은 조회하지 않는다).
select
  (select count(*) from public.employees) as employees,
  (select count(*) from public.employees where is_active) as active,
  (select count(*) from public.employees where not is_active) as inactive,
  (select count(*) from public.overtime_requests) as overtime_requests,
  (select count(*) from public.payslips) as payslips;
-- [6] 함수 수. definer 합계와 anon 실행 수.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef) as definer_functions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_can_execute;

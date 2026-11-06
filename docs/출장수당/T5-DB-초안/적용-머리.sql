-- ============================================================
-- 출장수당 DB 적용 단일 실행본 (005 -> 010 -> 020 -> 030 -> 040)
-- 하나의 트랜잭션. 사전 조건이 하나라도 다르면 아무것도 바꾸지 않고 중단한다.
-- 011, 012, 013 은 이미 적용돼 있어야 하며 여기서 다시 실행하지 않는다.
-- 기능 스위치는 전부 꺼진 채로 끝난다. 기존 표의 데이터는 바꾸지 않는다.
-- 이 파일은 적용-머리.sql + 각 SQL 원본 + 적용-꼬리.sql 을 그대로 이어 붙인 것이다.
-- ============================================================
begin;
do $pre$
declare
  n int;
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'PRECONDITION pg_version_below_15';
  end if;
  if to_regclass('public.holidays') is not null then
    raise exception 'PRECONDITION holidays_already_exists';
  end if;
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relname like 'trip\_%';
  if n <> 0 then
    raise exception 'PRECONDITION trip_objects_already_exist count=%', n;
  end if;
  select count(*) into n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public'
    and (p.proname like 'trip\_%' or p.proname like '\_trip\_%');
  if n <> 0 then
    raise exception 'PRECONDITION trip_functions_already_exist count=%', n;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees'
      and column_name = 'position') then
    raise exception 'PRECONDITION employees_position_already_exists';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.employees'::regclass
      and tgname = 'employees_role_admin_only') then
    raise exception 'PRECONDITION missing_006_role_guard';
  end if;
  if pg_get_functiondef('public.is_admin()'::regprocedure)
       not like '%is_active%' then
    raise exception 'PRECONDITION missing_007_is_active_check';
  end if;
  if to_regclass('public.employees_directory') is null then
    raise exception 'PRECONDITION missing_008_directory_view';
  end if;
  if has_table_privilege('authenticated', 'public.employees', 'DELETE')
     or has_table_privilege('anon', 'public.employees', 'SELECT') then
    raise exception 'PRECONDITION missing_011_employees_privileges';
  end if;
  if to_regclass('ops_backup.rpc_acl_012') is null then
    raise exception 'PRECONDITION missing_012_backup';
  end if;
  select count(*) into n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'PRECONDITION anon_can_execute_definer count=%', n;
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.employees'::regclass
      and tgname = 'employees_active_server_only') then
    raise exception 'PRECONDITION missing_013_active_guard';
  end if;
end $pre$;
create temp table trip_apply_before on commit drop as
select 'employees' as t, count(*) as n from public.employees
union all select 'employees_active', count(*) from public.employees
  where is_active
union all select 'employees_inactive', count(*) from public.employees
  where not is_active
union all select 'overtime_requests', count(*) from public.overtime_requests
union all select 'payslips', count(*) from public.payslips
union all select 'definer_functions', count(*) from pg_proc p
  join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prosecdef;

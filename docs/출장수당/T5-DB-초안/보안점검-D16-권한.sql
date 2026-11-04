-- D16 사전 확인 — 읽기 전용 (SELECT 1개). employees 표 권한과 anon 이 실행할 수 있는 함수를 본다.
-- Supabase SQL Editor 에 전체를 붙여 넣고 Run → 1행, 각 칼럼이 JSON.
select
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'grantee', grantee, 'privileges', privs) order by grantee), '[]'::jsonb)
    from (
      select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'employees'
      group by grantee
    ) g
  ) as employees_grants,
  (
    select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) as definer_functions_anon_can_execute,
  (
    select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) as definer_functions_authenticated_can_execute,
  (
    select count(*) from public.employees e
    left join auth.users u on u.id = e.id
    where e.is_active = false
      and (u.banned_until is null or u.banned_until <= now())
  ) as inactive_but_not_banned;

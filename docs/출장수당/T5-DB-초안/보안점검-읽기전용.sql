-- 근태관리 employees 권한 점검 — 읽기 전용 (SELECT 1개). 이름·이메일·급여는 읽지 않는다 (정의·건수만).
-- Supabase SQL Editor: 아래 select 문(begin/rollback 제외)을 통째로 붙여 넣고 실행 → item 6행, result 는 JSON.
-- 006·007 적용 전(현재)과 적용 후(S-6 이 true 로 바뀌는지) 두 번 실행한다.
-- 줄은 짧게 나눠 두었다 (11-03: 긴 줄이 복사 중 잘려 "build_object" 문법 오류가 난 적이 있음). 로컬 PostgreSQL 18(PGlite)로 문법·실행 검증.
-- begin read only; / rollback; 은 선택 사항 — SELECT 뿐이라 없어도 읽기 전용이다. 붙이면 결과 창이 비어 보일 수 있다.

select
  'S-1 employees policies' as item,
  (
    select jsonb_agg(
      jsonb_build_object(
        'name', policyname,
        'cmd', cmd,
        'roles', roles::text[],
        'qual', qual,
        'with_check', with_check
      ) order by policyname
    )
    from pg_policies
    where schemaname = 'public' and tablename = 'employees'
  ) as result

union all

select
  'S-2 employees triggers',
  (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', tgname,
          'enabled', tgenabled::text,
          'def', pg_get_triggerdef(oid)
        ) order by tgname
      ),
      '[]'::jsonb
    )
    from pg_trigger
    where tgrelid = 'public.employees'::regclass and not tgisinternal
  )

union all

select
  'S-3 admin functions',
  (
    select jsonb_agg(
      jsonb_build_object(
        'fn', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        'secdef', p.prosecdef,
        'acl', array_to_string(p.proacl, ','),
        'def', pg_get_functiondef(p.oid)
      ) order by p.proname
    )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'is_admin', 'is_manager_or_admin', 'get_my_role', 'is_employee',
        'update_employee_admin', 'register_employee', 'list_all_employees',
        'can_access_payroll', 'is_active_payroll_staff', 'has_payroll_reauth', 'payroll_access_roster'
      )
  )

union all

select
  'S-4 employees grants',
  jsonb_build_object(
    'table', (
      select jsonb_agg(
        jsonb_build_object('grantee', grantee, 'priv', privilege_type)
        order by grantee, privilege_type
      )
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'employees'
        and grantee in ('anon', 'authenticated', 'service_role')
    ),
    'columns', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('grantee', grantee, 'col', column_name, 'priv', privilege_type)
          order by grantee, column_name
        ),
        '[]'::jsonb
      )
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'employees'
        and grantee in ('anon', 'authenticated')
        and column_name in ('role', 'position', 'is_active', 'hourly_wage')
    ),
    'rls_enabled', (
      select relrowsecurity from pg_class where oid = 'public.employees'::regclass
    ),
    'view_grants', (
      select coalesce(
        jsonb_agg(jsonb_build_object('grantee', grantee, 'priv', privilege_type) order by grantee, privilege_type),
        '[]'::jsonb
      )
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'employees_directory'
    ),
    'view_updatable_mask', (
      select pg_relation_is_updatable(c.oid, false) from pg_class c where c.oid = to_regclass('public.employees_directory')
    )
  )

union all

select
  'S-5 accounts (counts only)',
  jsonb_build_object(
    'employees_by_role_active', (
      select jsonb_agg(
        jsonb_build_object('role', role, 'active', is_active, 'n', n)
        order by role, is_active
      )
      from (
        select role, is_active, count(*) as n
        from public.employees
        group by role, is_active
      ) r
    ),
    'auth_users', (
      select count(*) from auth.users
    ),
    'auth_users_without_employee_row', (
      select count(*)
      from auth.users u
      where not exists (select 1 from public.employees e where e.id = u.id)
    ),
    'inactive_employees_not_banned', (
      select count(*)
      from public.employees e
      join auth.users u on u.id = e.id
      where e.is_active = false
        and (u.banned_until is null or u.banned_until < now())
    ),
    'inactive_manager_or_admin_not_banned', (
      select count(*)
      from public.employees e
      join auth.users u on u.id = e.id
      where e.is_active = false
        and e.role in ('manager', 'admin')
        and (u.banned_until is null or u.banned_until < now())
    )
  )

union all

select
  'S-6 guard objects (after apply: all true)',
  jsonb_build_object(
    'trigger_role_guard', exists (
      select 1 from pg_trigger
      where tgname = 'employees_role_admin_only' and tgrelid = 'public.employees'::regclass
    ),
    'fn_role_guard', to_regprocedure('public.employees_role_guard()') is not null,
    'trigger_position_guard', exists (
      select 1 from pg_trigger
      where tgname = 'employees_position_admin_only' and tgrelid = 'public.employees'::regclass
    ),
    'column_position', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'employees' and column_name = 'position'
    ),
    'is_admin_checks_active', (
      select pg_get_functiondef(oid) like '%is_active%'
      from pg_proc where oid = 'public.is_admin()'::regprocedure
    ),
    'is_manager_or_admin_checks_active', (
      select pg_get_functiondef(oid) like '%is_active%'
      from pg_proc where oid = 'public.is_manager_or_admin()'::regprocedure
    ),
    'view_employees_directory', to_regclass('public.employees_directory') is not null,
    'view_options', coalesce(
      (select array_to_string(reloptions, ',') from pg_class where oid = to_regclass('public.employees_directory')),
      '(no view)'
    ),
    'employees_owner_bypasses_rls', (
      select (not c.relforcerowsecurity) and coalesce(c.relowner = v.relowner, true)
      from pg_class c
      left join pg_class v on v.oid = to_regclass('public.employees_directory')
      where c.oid = 'public.employees'::regclass
    ),
    'group_select_policy_present', exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'employees' and policyname = 'employees_select_active_for_group'
    ),
    'backup_table', to_regclass('public.security_patch_backup') is not null,
    'register_employee_acl', (
      select coalesce(array_to_string(proacl, ','), '(default: PUBLIC execute)')
      from pg_proc where oid = to_regprocedure('public.register_employee(uuid, text, text, text)')
    )
  )

union all

select
  'S-7 default privileges (public schema)',
  (
    select coalesce(
      jsonb_agg(jsonb_build_object('for_role', defaclrole::regrole::text, 'objtype', defaclobjtype, 'acl', defaclacl::text)),
      '[]'::jsonb
    )
    from pg_default_acl
    where defaclnamespace = 'public'::regnamespace
  );

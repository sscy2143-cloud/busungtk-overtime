-- READ ONLY. 012 적용 후 사후 점검. 아무것도 바꾸지 않는다.
-- [1] anon 이 실행 가능한 definer 함수. 0 행이어야 한다.
select p.oid::regprocedure::text as anon_can_still_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1;
-- [2] 원본(보관본) 대비 실효 권한이 달라진 항목.
-- 0 행이어야 한다. 대상 역할: anon 제외 핵심 역할.
with orig as (
  select b.fn_oid, r.rolname,
         bool_or(b.grantee in ('PUBLIC', r.rolname)
                 or r.oid = p.proowner) as had
  from ops_backup.rpc_acl_012 b
  join pg_proc p on p.oid = b.fn_oid
  cross join pg_roles r
  where r.rolname in ('authenticated', 'service_role',
    'supabase_auth_admin', 'supabase_storage_admin')
  group by b.fn_oid, r.rolname, r.oid, p.proowner
)
select o.fn_oid::regprocedure::text as fn, o.rolname,
       o.had as before_exec,
       has_function_privilege(o.rolname, o.fn_oid, 'EXECUTE')
         as after_exec
from orig o
where o.had is distinct from
      has_function_privilege(o.rolname, o.fn_oid, 'EXECUTE')
order by 1, 2;
-- [3] 요약. 함수 수, 보관 수, 역할별 실행 가능 수.
select
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef) as definer_functions,
  (select count(distinct fn_oid)
    from ops_backup.rpc_acl_012) as backed_up,
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    as authenticated_exec,
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('service_role', p.oid, 'EXECUTE'))
    as service_role_exec;

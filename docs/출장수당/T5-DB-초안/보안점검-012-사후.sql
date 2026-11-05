-- READ ONLY. 012 v5 적용 후 사후 점검. 아무것도 바꾸지 않는다.
-- [1] anon 이 실행 가능한 definer 함수. 0 행이어야 한다.
select p.oid::regprocedure::text as anon_can_still_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1;
-- [2] 보관한 원본 대비 실효 권한이 달라진 (함수, 역할).
-- anon 과 내장 pg_* 역할을 뺀 모든 역할, 상속 포함.
-- 0 행이어야 한다.
with orig as (
  select p.oid as fn, r.rolname,
         bool_or(r.rolsuper
           or k.grantee = 'PUBLIC'
           or (to_regrole(k.grantee) is not null
               and pg_has_role(r.oid,
                     to_regrole(k.grantee)::oid, 'USAGE'))) as had
  from ops_backup.rpc_acl_012 k
  join pg_proc p on p.oid = k.fn_oid
  cross join pg_roles r
  where r.rolname <> 'anon' and r.oid >= 16384
  group by p.oid, r.rolname
)
select o.fn::regprocedure::text as fn, o.rolname,
       o.had as before_exec,
       has_function_privilege(o.rolname, o.fn, 'EXECUTE')
         as after_exec
from orig o
where o.had is distinct from
      has_function_privilege(o.rolname, o.fn, 'EXECUTE')
order by 1, 2;
-- [3] 새로 생긴 부여 옵션 (원본에 없던 GRANT OPTION). 0 행이어야 한다.
select p.oid::regprocedure::text as fn,
       pg_get_userbyid(x.grantee)::text as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(
  coalesce(p.proacl, acldefault('f', p.proowner))) x
where n.nspname = 'public' and p.prosecdef
  and x.grantee <> 0 and x.grantee <> p.proowner
  and x.is_grantable
  and not exists (
    select 1 from ops_backup.rpc_acl_012 k
    where k.fn_oid = p.oid and k.grantable
      and k.grantee = pg_get_userbyid(x.grantee)::text)
order by 1, 2;
-- [4] 요약. 함수 수, 보관 수, 추가한 직접 GRANT 수.
select
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef) as definer_functions,
  (select count(distinct fn_oid)
    from ops_backup.rpc_acl_012) as backed_up,
  (select count(*) from ops_backup.rpc_acl_012_added)
    as direct_grants_added,
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

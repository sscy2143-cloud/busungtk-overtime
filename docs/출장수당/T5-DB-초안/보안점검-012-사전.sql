-- READ ONLY. 012 v5 적용 직전 사전 점검. 아무것도 바꾸지 않는다.
-- [1] ops_backup 스키마와 객체. 0 행이어야 안전하게 새로 만든다.
-- (이미 있으면 먼저 알려 주세요. 012 는 중단한다.)
select 'schema' as kind, n.nspname::text as name,
       pg_get_userbyid(n.nspowner)::text as owner
from pg_namespace n
where n.nspname = 'ops_backup'
union all
select 'object', c.relname::text, c.relkind::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'ops_backup'
order by 1, 2;
-- [2] 소유자가 아닌 grantor 의 EXECUTE 항목. 0 행이어야 한다.
select p.oid::regprocedure::text as fn,
       pg_get_userbyid(a.grantor)::text as grantor,
       case when a.grantee = 0 then 'PUBLIC'
            else pg_get_userbyid(a.grantee)::text end as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(
  coalesce(p.proacl, acldefault('f', p.proowner))) a
where n.nspname = 'public' and p.prosecdef
  and a.grantor <> p.proowner
order by 1;
-- [3] 역할별 현황. anon 에 속한 역할이 누구인지 보여 준다.
select r.rolname,
       (r.oid < 16384) as builtin_excluded,
       r.rolsuper as superuser,
       r.rolinherit as inherit,
       r.rolcanlogin as can_login,
       pg_has_role(r.oid, 'anon', 'MEMBER') as member_of_anon,
       (select count(*) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
            and has_function_privilege(r.oid, p.oid, 'EXECUTE'))
         as can_execute
from pg_roles r
order by r.rolname;
-- [4] anon 자신이 속한 상위 역할. 비어 있어야 한다.
select r.rolname as anon_is_member_of
from pg_roles r
where r.rolname <> 'anon'
  and pg_has_role('anon', r.oid, 'MEMBER');

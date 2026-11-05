-- DRAFT v3. 011 과 별도의 운영 승인이 필요하다.
-- public 스키마 SECURITY DEFINER 함수 중
-- anon 이 실행할 수 있는 함수에서만
-- anon 과 PUBLIC 의 EXECUTE 를 회수한다.
-- 적용 전 모든 역할의 실행 권한을 기록해 두고
-- 적용 후 anon 외 역할의 권한이 하나라도 다르면
-- 예외를 내서 COMMIT 전에 전부 취소한다.
-- 함수 본문, 소유자, search_path, RLS 는 바꾸지 않는다.
-- 멱등. 되돌리기: 912
begin;
create temp table acl_before on commit drop as
select p.oid as fn, r.rolname::text as rn,
       has_function_privilege(r.oid, p.oid, 'EXECUTE') as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public' and p.prosecdef
  and r.rolname !~ '^pg_';
do $r$
declare
  f record;
  g record;
  bad int;
  anon_left int;
  core text[] := array[
    'authenticated', 'service_role', 'postgres',
    'supabase_auth_admin', 'supabase_storage_admin',
    'supabase_admin', 'dashboard_user'];
begin
  for f in
    select fn from acl_before where rn = 'anon' and ok
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      f.fn::regprocedure);
    for g in
      select b.rn
      from acl_before b
      join pg_roles r on r.rolname = b.rn
      where b.fn = f.fn and b.ok and b.rn <> 'anon'
        and not r.rolsuper
        and (b.rn = any(core) or not pg_has_role(b.rn, 'anon', 'USAGE'))
        and not has_function_privilege(b.rn, f.fn, 'EXECUTE')
    loop
      execute format(
        'grant execute on function %s to %I',
        f.fn::regprocedure, g.rn);
    end loop;
  end loop;
  select count(*) into anon_left
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  select count(*) into bad
  from acl_before b
  join pg_roles r on r.rolname = b.rn
  where b.rn <> 'anon'
    and (b.rn = any(core) or not pg_has_role(b.rn, 'anon', 'USAGE'))
    and has_function_privilege(b.rn, b.fn, 'EXECUTE')
        is distinct from b.ok;
  if anon_left <> 0 or bad <> 0 then
    raise exception 'ACL_VERIFY_FAILED anon_left=% changed=%',
      anon_left, bad;
  end if;
end $r$;
select
  (select count(distinct fn) from acl_before) as definer_functions,
  (select count(*) from acl_before
    where rn = 'anon' and ok) as anon_could_before,
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE'))
    as anon_now_must_0,
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    as authenticated_now,
  (select count(*) from acl_before
    where rn = 'authenticated' and ok) as authenticated_before;
commit;

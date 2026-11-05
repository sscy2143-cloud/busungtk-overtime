-- 012 v4. 운영 적용 대기 (013 적용 후, SQL Editor 에서 실행).
-- 적용 대상: 실행 시점에 이미 존재하는 public 의
-- SECURITY DEFINER 함수만. 이후 만든 함수는 해당 없음.
-- anon 이 실행할 수 있는 함수에서만
-- anon 과 PUBLIC 의 EXECUTE 를 회수한다.
-- 적용 전 함수별 원본 ACL 을 ops_backup 스키마에 보관한다.
--   (역할 이름과 EXECUTE 여부만. 개인정보 없음)
--   (이미 보관한 함수는 덮어쓰지 않음 = 최초 원본 유지)
-- 적용 후 anon 외 역할의 실효 권한이 하나라도 달라지거나
-- 부여 옵션(GRANT OPTION) 수가 달라지면
-- 예외로 COMMIT 전에 전부 취소한다.
-- 함수 본문, 소유자, search_path, RLS 는 바꾸지 않는다.
-- 멱등. 되돌리기: 912 (보관한 원본 ACL 로 정확히 복원)
begin;
create schema if not exists ops_backup;
revoke all on schema ops_backup from public, anon, authenticated;
create table if not exists ops_backup.rpc_acl_012 (
  fn_oid oid not null,
  sig text not null,
  grantee text not null,
  grantable boolean not null,
  taken_at timestamptz not null default now(),
  primary key (fn_oid, grantee)
);
revoke all on table ops_backup.rpc_acl_012
  from public, anon, authenticated;
insert into ops_backup.rpc_acl_012 (fn_oid, sig, grantee, grantable)
select p.oid, p.oid::regprocedure::text,
       case when a.grantee = 0 then 'PUBLIC'
            else (select rolname::text from pg_roles
                  where oid = a.grantee) end,
       a.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(
  coalesce(p.proacl, acldefault('f', p.proowner))) a
where n.nspname = 'public' and p.prosecdef
  and a.privilege_type = 'EXECUTE'
  and (a.grantee = 0
       or exists (select 1 from pg_roles where oid = a.grantee))
  and not exists (
    select 1 from ops_backup.rpc_acl_012 b where b.fn_oid = p.oid);
create temp table acl_before on commit drop as
select p.oid as fn, r.rolname::text as rn,
       has_function_privilege(r.oid, p.oid, 'EXECUTE') as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public' and p.prosecdef;
do $r$
declare
  f record;
  g record;
  bad int;
  anon_left int;
  opt_before int;
  opt_after int;
  core text[] := array[
    'authenticated', 'service_role', 'postgres',
    'supabase_auth_admin', 'supabase_storage_admin',
    'supabase_admin', 'dashboard_user'];
begin
  select count(*) into opt_before
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.prosecdef
    and a.is_grantable and a.grantee <> p.proowner;
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
  select count(*) into opt_after
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.prosecdef
    and a.is_grantable and a.grantee <> p.proowner;
  if anon_left <> 0 or bad <> 0 or opt_before <> opt_after then
    raise exception
      'ACL_VERIFY_FAILED anon_left=% changed=% grant_option=%/%',
      anon_left, bad, opt_before, opt_after;
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
    where rn = 'authenticated' and ok) as authenticated_before,
  (select count(distinct fn_oid) from ops_backup.rpc_acl_012)
    as backed_up_functions;
commit;

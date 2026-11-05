-- 012 v5. 운영 적용 대기 (013 적용 후, SQL Editor 에서 실행).
-- 적용 대상: 실행 시점에 이미 존재하는 public 의
-- SECURITY DEFINER 함수만. 이후 만든 함수는 해당 없음.
-- anon 이 실행할 수 있는 함수에서만
-- anon 과 PUBLIC 의 EXECUTE 를 회수한다.
-- anon 을 제외한 모든 사용자 정의 역할(Supabase 내부 역할 포함)은
-- 상속 여부와 무관하게 예외 없이 비교한다.
-- 잃는 역할에는 직접 GRANT 로 같은 권한을 되돌려 준다.
-- 비교 제외: PostgreSQL 내장 그룹 역할(pg_*, oid 16384 미만)뿐.
--   로그인하지 않는 그룹이며, 그 멤버는 각자 비교하고 보존한다.
-- 결과가 하나라도 다르거나 부여 옵션이 달라지면
-- 예외로 COMMIT 전에 전부 취소한다.
-- 소유자가 아닌 grantor 의 ACL 이 있으면 시작 단계에서 중단한다.
-- 기존 ops_backup 객체가 있으면 건드리지 않고 중단한다.
-- 원본 ACL 은 ops_backup.rpc_acl_012 (역할 이름만),
-- 012 가 추가한 직접 GRANT 는 rpc_acl_012_added 에 기록한다.
-- 함수 본문, 소유자, search_path, RLS 는 바꾸지 않는다.
-- 멱등. 되돌리기: 912
begin;
do $c$
declare
  cols text;
begin
  if exists (select 1 from pg_namespace where nspname = 'ops_backup')
     and to_regclass('ops_backup.rpc_acl_012') is null then
    raise exception 'OPS_BACKUP_SCHEMA_EXISTS';
  end if;
  if to_regclass('ops_backup.rpc_acl_012') is not null then
    select string_agg(attname, ',' order by attname) into cols
    from pg_attribute
    where attrelid = 'ops_backup.rpc_acl_012'::regclass
      and attnum > 0 and not attisdropped;
    if cols is distinct from
       'fn_oid,grantable,grantee,grantor,sig,taken_at' then
      raise exception 'OPS_BACKUP_TABLE_MISMATCH';
    end if;
  end if;
  if to_regclass('ops_backup.rpc_acl_012_added') is not null then
    select string_agg(attname, ',' order by attname) into cols
    from pg_attribute
    where attrelid = 'ops_backup.rpc_acl_012_added'::regclass
      and attnum > 0 and not attisdropped;
    if cols is distinct from 'fn_oid,grantee,taken_at' then
      raise exception 'OPS_BACKUP_TABLE_MISMATCH';
    end if;
  end if;
  if not exists (select 1 from pg_namespace
                 where nspname = 'ops_backup') then
    create schema ops_backup;
    revoke all on schema ops_backup from public, anon, authenticated;
  end if;
end $c$;
create table if not exists ops_backup.rpc_acl_012 (
  fn_oid oid not null,
  sig text not null,
  grantee text not null,
  grantor text not null,
  grantable boolean not null,
  taken_at timestamptz not null default now(),
  primary key (fn_oid, grantee)
);
create table if not exists ops_backup.rpc_acl_012_added (
  fn_oid oid not null,
  grantee text not null,
  taken_at timestamptz not null default now(),
  primary key (fn_oid, grantee)
);
revoke all on table ops_backup.rpc_acl_012
  from public, anon, authenticated;
revoke all on table ops_backup.rpc_acl_012_added
  from public, anon, authenticated;
create temp table acl_raw on commit drop as
select p.oid as fn, p.oid::regprocedure::text as sig,
       pg_get_userbyid(p.proowner)::text as owner_name,
       pg_get_userbyid(a.grantor)::text as grantor_name,
       case when a.grantee = 0 then 'PUBLIC'
            else pg_get_userbyid(a.grantee)::text end as grantee_name,
       a.is_grantable as grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(
  coalesce(p.proacl, acldefault('f', p.proowner))) a
where n.nspname = 'public' and p.prosecdef
  and a.privilege_type = 'EXECUTE';
create temp table acl_before on commit drop as
select p.oid as fn, r.rolname::text as rn,
       has_function_privilege(r.oid, p.oid, 'EXECUTE') as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public' and p.prosecdef
  and r.oid >= 16384;
do $r$
declare
  f record;
  g record;
  pass int;
  nog int;
  incomplete int;
  bad int;
  anon_left int;
  opt_bad int;
begin
  select count(*) into nog from acl_raw
  where grantor_name <> owner_name;
  if nog <> 0 then
    raise exception 'NON_OWNER_GRANTOR count=%', nog;
  end if;
  insert into ops_backup.rpc_acl_012
    (fn_oid, sig, grantee, grantor, grantable)
  select r.fn, r.sig, r.grantee_name, r.grantor_name, r.grantable
  from acl_raw r
  where not exists (
    select 1 from ops_backup.rpc_acl_012 b where b.fn_oid = r.fn);
  select count(*) into incomplete
  from (select distinct fn from acl_raw) x
  where not exists (
    select 1 from ops_backup.rpc_acl_012 b where b.fn_oid = x.fn);
  if incomplete <> 0 then
    raise exception 'BACKUP_INCOMPLETE count=%', incomplete;
  end if;
  if has_schema_privilege('anon', 'ops_backup', 'USAGE')
     or has_schema_privilege('authenticated', 'ops_backup', 'USAGE')
     or has_table_privilege('anon', 'ops_backup.rpc_acl_012', 'SELECT')
     or has_table_privilege('authenticated',
          'ops_backup.rpc_acl_012', 'SELECT')
     or has_table_privilege('anon',
          'ops_backup.rpc_acl_012_added', 'SELECT')
     or has_table_privilege('authenticated',
          'ops_backup.rpc_acl_012_added', 'SELECT') then
    raise exception 'BACKUP_ACCESS_OPEN';
  end if;
  for f in
    select fn from acl_before where rn = 'anon' and ok
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      f.fn::regprocedure);
    for pass in 1..2 loop
      for g in
        select b.rn
        from acl_before b
        join pg_roles r on r.rolname = b.rn
        where b.fn = f.fn and b.ok and b.rn <> 'anon'
          and not r.rolsuper
          and (exists (select 1 from pg_auth_members m
                       where m.member = r.oid)) = (pass = 2)
          and not has_function_privilege(b.rn, f.fn, 'EXECUTE')
      loop
        execute format(
          'grant execute on function %s to %I',
          f.fn::regprocedure, g.rn);
        insert into ops_backup.rpc_acl_012_added (fn_oid, grantee)
        values (f.fn, g.rn) on conflict do nothing;
      end loop;
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
    and has_function_privilege(b.rn, b.fn, 'EXECUTE')
        is distinct from b.ok;
  select count(*) into opt_bad from (
    (select r.fn, r.grantee_name, r.grantable from acl_raw r
      where r.grantee_name not in ('PUBLIC', 'anon')
        and r.grantee_name <> r.owner_name
     except
     select p.oid, pg_get_userbyid(a.grantee)::text, a.is_grantable
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee <> 0 and a.privilege_type = 'EXECUTE')
    union all
    (select p.oid, pg_get_userbyid(a.grantee)::text, a.is_grantable
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'public' and p.prosecdef
        and a.grantee <> 0 and a.grantee <> p.proowner
        and a.is_grantable and a.privilege_type = 'EXECUTE'
     except
     select r.fn, r.grantee_name, r.grantable from acl_raw r
      where r.grantable)
  ) d;
  if anon_left <> 0 or bad <> 0 or opt_bad <> 0 then
    raise exception
      'ACL_VERIFY_FAILED anon_left=% changed=% grant_option=%',
      anon_left, bad, opt_bad;
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
    as backed_up_functions,
  (select count(*) from ops_backup.rpc_acl_012_added)
    as direct_grants_added,
  (select string_agg(r.rolname, ',' order by r.rolname)
    from pg_roles r
    where r.rolname <> 'anon' and pg_has_role(r.oid, 'anon', 'MEMBER'))
    as roles_that_are_anon_members;
commit;

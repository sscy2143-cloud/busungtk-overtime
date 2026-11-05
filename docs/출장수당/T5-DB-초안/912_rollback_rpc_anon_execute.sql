-- 912 v2. 012 의 정확한 되돌리기 (자동 실행 금지).
-- 012 가 ops_backup.rpc_acl_012 에 보관한 원본 ACL 로 복원한다.
-- 보관된 함수만 대상. 원래 없던 EXECUTE 는 새로 부여하지 않는다.
-- 복원 후 보관본과 현재 ACL 이 다르면 예외로 전부 취소한다.
-- 원인이 정상 기능 차단이면 함수 하나만
--   grant execute on function public.NAME(ARGS) to anon;
-- 으로 되돌리는 쪽이 안전하다.
begin;
do $r$
declare
  f record;
  c record;
  a record;
  diff int;
begin
  if to_regclass('ops_backup.rpc_acl_012') is null then
    raise exception 'NO_BACKUP';
  end if;
  for f in
    select distinct b.fn_oid, p.proowner
    from ops_backup.rpc_acl_012 b
    join pg_proc p on p.oid = b.fn_oid
  loop
    execute format('revoke all on function %s from public',
      f.fn_oid::regprocedure);
    for c in
      select distinct (select rolname::text from pg_roles
                       where oid = x.grantee) as rn
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))) x
      where p.oid = f.fn_oid
        and x.grantee <> 0 and x.grantee <> p.proowner
    loop
      execute format('revoke all on function %s from %I',
        f.fn_oid::regprocedure, c.rn);
    end loop;
    for a in
      select b.grantee, b.grantable
      from ops_backup.rpc_acl_012 b
      where b.fn_oid = f.fn_oid
        and b.grantee is distinct from
            (select rolname::text from pg_roles where oid = f.proowner)
    loop
      if a.grantee = 'PUBLIC' then
        execute format('grant execute on function %s to public %s',
          f.fn_oid::regprocedure,
          case when a.grantable then 'with grant option' else '' end);
      elsif to_regrole(a.grantee) is not null then
        execute format('grant execute on function %s to %I %s',
          f.fn_oid::regprocedure, a.grantee,
          case when a.grantable then 'with grant option' else '' end);
      end if;
    end loop;
  end loop;
  with want as (
    select b.fn_oid, b.grantee, b.grantable
    from ops_backup.rpc_acl_012 b
    join pg_proc p on p.oid = b.fn_oid
    where b.grantee is distinct from
          (select rolname::text from pg_roles where oid = p.proowner)
      and (b.grantee = 'PUBLIC' or to_regrole(b.grantee) is not null)
  ), have as (
    select p.oid as fn_oid,
           case when x.grantee = 0 then 'PUBLIC'
                else (select rolname::text from pg_roles
                      where oid = x.grantee) end as grantee,
           x.is_grantable as grantable
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))) x
    where p.oid in (select fn_oid from ops_backup.rpc_acl_012)
      and x.grantee <> p.proowner
  )
  select count(*) into diff from (
    (select * from want except select * from have)
    union all
    (select * from have except select * from want)
  ) d;
  if diff <> 0 then
    raise exception 'RESTORE_VERIFY_FAILED diff=%', diff;
  end if;
end $r$;
commit;

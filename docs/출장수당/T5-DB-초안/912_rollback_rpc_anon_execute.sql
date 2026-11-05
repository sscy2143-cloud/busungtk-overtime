-- 912 v3. 012 가 바꾼 것만 되돌린다 (자동 실행 금지).
-- 1) 012 가 추가한 직접 GRANT (rpc_acl_012_added) 를 회수
-- 2) 보관한 원본의 PUBLIC, anon 항목을 부여 옵션까지 복원
-- 그 밖의 항목은 건드리지 않는다.
--   (012 이후에 정당하게 추가된 권한은 유지)
-- 원래 없던 EXECUTE 는 새로 부여하지 않는다.
-- 복원 후 원본 항목이 하나라도 없으면 예외로 전부 취소한다.
-- 원인이 정상 기능 차단이면 함수 하나만
--   grant execute on function public.NAME(ARGS) to anon;
-- 으로 되돌리는 쪽이 안전하다.
begin;
do $r$
declare
  f record;
  a record;
  b record;
  missing int;
begin
  if to_regclass('ops_backup.rpc_acl_012') is null
     or to_regclass('ops_backup.rpc_acl_012_added') is null then
    raise exception 'NO_BACKUP';
  end if;
  for f in
    select distinct k.fn_oid
    from ops_backup.rpc_acl_012 k
    join pg_proc p on p.oid = k.fn_oid
  loop
    for a in
      select d.grantee from ops_backup.rpc_acl_012_added d
      where d.fn_oid = f.fn_oid and to_regrole(d.grantee) is not null
    loop
      execute format('revoke execute on function %s from %I',
        f.fn_oid::regprocedure, a.grantee);
    end loop;
    for b in
      select k.grantee, k.grantable
      from ops_backup.rpc_acl_012 k
      where k.fn_oid = f.fn_oid and k.grantee in ('PUBLIC', 'anon')
    loop
      if b.grantee = 'PUBLIC' then
        execute format('grant execute on function %s to public %s',
          f.fn_oid::regprocedure,
          case when b.grantable then 'with grant option' else '' end);
      else
        execute format('grant execute on function %s to anon %s',
          f.fn_oid::regprocedure,
          case when b.grantable then 'with grant option' else '' end);
      end if;
    end loop;
  end loop;
  select count(*) into missing from (
    select k.fn_oid, k.grantee, k.grantable
    from ops_backup.rpc_acl_012 k
    join pg_proc p on p.oid = k.fn_oid
    where k.grantee is distinct from pg_get_userbyid(p.proowner)::text
      and (k.grantee = 'PUBLIC' or to_regrole(k.grantee) is not null)
    except
    select p.oid,
           case when x.grantee = 0 then 'PUBLIC'
                else pg_get_userbyid(x.grantee)::text end,
           x.is_grantable
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))) x
    where p.oid in (select fn_oid from ops_backup.rpc_acl_012)
      and x.privilege_type = 'EXECUTE'
  ) d;
  if missing <> 0 then
    raise exception 'RESTORE_VERIFY_FAILED missing=%', missing;
  end if;
  delete from ops_backup.rpc_acl_012_added
  where fn_oid in (select fn_oid from ops_backup.rpc_acl_012);
end $r$;
select
  (select count(distinct fn_oid) from ops_backup.rpc_acl_012)
    as restored_functions,
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE'))
    as anon_can_execute_now;
commit;

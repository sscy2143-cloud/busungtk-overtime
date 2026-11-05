-- DRAFT v2. 011 과 별도의 운영 승인이 필요하다.
-- public 스키마 SECURITY DEFINER 함수에서
-- anon 과 PUBLIC 의 EXECUTE 만 회수한다.
-- 앱은 로그인 전에 RPC 를 부르지 않는다.
-- 이미 EXECUTE 가 있던 역할만 다시 부여한다.
-- 원래 막혀 있던 역할에는 새로 열지 않는다.
-- 함수 본문과 RLS 정책은 바꾸지 않는다.
-- 멱등. 되돌리기: 912
begin;
do $r$
declare
  f record;
  rn text;
  keep text[];
  cand text[] := array[
    'authenticated', 'service_role',
    'supabase_auth_admin', 'supabase_storage_admin',
    'supabase_admin', 'dashboard_user'];
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    keep := array[]::text[];
    foreach rn in array cand loop
      if to_regrole(rn) is not null
         and has_function_privilege(rn, f.oid, 'EXECUTE') then
        keep := keep || rn;
      end if;
    end loop;
    execute format(
      'revoke execute on function %s from public, anon', f.sig);
    foreach rn in array keep loop
      execute format(
        'grant execute on function %s to %I', f.sig, rn);
    end loop;
  end loop;
end $r$;
select
  count(*) filter (where has_function_privilege(
    'anon', p.oid, 'EXECUTE')) as anon_must_be_0,
  count(*) filter (where has_function_privilege(
    'authenticated', p.oid, 'EXECUTE')) as authenticated_ok,
  count(*) filter (where has_function_privilege(
    'service_role', p.oid, 'EXECUTE')) as service_role_ok,
  count(*) as definer_functions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;
commit;

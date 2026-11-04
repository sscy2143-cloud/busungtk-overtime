-- ⚠ 초안. 실행 금지. 011 과 별도의 운영 승인이 필요하다.
-- public 스키마의 SECURITY DEFINER 함수에서 anon(미로그인)·PUBLIC 의 EXECUTE 만 회수한다.
-- 근거: 앱은 로그인 전에 RPC 를 호출하지 않는다 (src 의 .rpc() 15종 모두 로그인 후 사용).
--       함수 내부는 auth.uid()/is_admin() 으로 막혀 있어 익명 호출이 데이터를 얻지는 못하지만, 공격 표면을 줄인다.
-- 유지: authenticated(로그인 사용자) 와 service_role 의 EXECUTE. 함수 본문·RLS 정책은 변경하지 않는다.
-- 멱등. 되돌리기: 912_rollback_rpc_anon_execute.sql
begin;
do $r$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $r$;
select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_can_execute_must_be_0,
       count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_can_execute,
       count(*) as definer_functions
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;
commit;

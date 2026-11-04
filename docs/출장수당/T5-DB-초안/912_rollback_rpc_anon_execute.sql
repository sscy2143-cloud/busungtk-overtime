-- ⚠ 012 가 정상 기능을 막을 때만 사용자가 결정해 실행 (자동 실행 금지).
-- 로그인 전에 필요한 함수가 발견된 경우 그 함수 하나만 되돌리는 것을 권장한다:
--   grant execute on function public.<함수명>(<인자 타입>) to anon;
-- 아래는 전체 복구(익명 실행 권한 재부여)로, 보안상 마지막 수단이다.
begin;
do $r$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('grant execute on function %s to anon', f.sig);
  end loop;
end $r$;
commit;

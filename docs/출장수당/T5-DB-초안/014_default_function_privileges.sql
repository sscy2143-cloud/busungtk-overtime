-- DRAFT. 운영 실행 금지. 승인 대상 아님 (제안).
-- 012 는 지금 있는 함수만 고친다.
-- 앞으로 postgres 가 public 에 만드는 함수에
-- anon 과 PUBLIC 의 EXECUTE 가 자동으로 붙지 않게 한다.
-- 영향: 새 함수는 migration 에서
--   grant execute on function ... to authenticated;
-- 를 명시해야 한다. 기존 함수는 바뀌지 않는다.
-- 주의: 대시보드(supabase_admin)로 만든 함수는
-- 별도 기본 권한을 쓴다. 필요하면 같은 문장을
-- for role supabase_admin 으로 따로 실행.
-- 되돌리기: 914
begin;
alter default privileges for role postgres
  in schema public revoke execute on functions from anon;
alter default privileges for role postgres
  revoke execute on functions from public;
commit;

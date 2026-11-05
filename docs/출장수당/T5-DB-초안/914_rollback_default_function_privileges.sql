-- 014 되돌리기. 새 함수의 기본 EXECUTE 를 원래대로 되돌린다.
begin;
alter default privileges for role postgres
  in schema public grant execute on functions to anon;
alter default privileges for role postgres
  grant execute on functions to public;
commit;

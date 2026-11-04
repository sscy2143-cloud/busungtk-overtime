-- ⚠ 초안. 011 이 앱 기능을 막을 때만 사용자가 결정해 실행 (자동 실행 금지).
-- 011 이 회수한 권한을 되돌린다. 단, anon 의 전체 권한 복구는 보안상 권장하지 않으므로 anon 은 SELECT 만 되돌린다
-- (011 이전에 anon 이 무엇을 가졌는지는 보안점검 S-7 결과 기준으로 사용자가 판단).
begin;
grant truncate, references, trigger, delete on table public.employees to authenticated;
grant select on table public.employees to anon;
commit;

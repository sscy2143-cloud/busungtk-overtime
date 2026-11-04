-- D15 퇴사자 3명 Auth Ban (운영 SQL Editor 에서 사용자가 실행). 계정·기록 삭제 없음, auth.users.banned_until 만 설정.
-- 가드: 비활성 직원이 정확히 3명이고 3명 모두 Auth 계정이 있을 때만 실행. 아니면 PRECONDITION 오류로 전체 중단(아무 변화 없음).
-- 결과: 이름·이메일·UUID 없이 건수만 나온다. 되돌리기(복직 시): 관리자 화면 "복직 처리" 또는 banned_until 을 null 로.
begin;

do $g$
declare n int; m int;
begin
  select count(*) into n from public.employees where is_active = false;
  if n <> 3 then
    raise exception 'PRECONDITION_CHANGED' using detail = '비활성 직원 수가 3이 아닙니다: ' || n;
  end if;
  select count(*) into m
  from public.employees e join auth.users u on u.id = e.id
  where e.is_active = false;
  if m <> 3 then
    raise exception 'PRECONDITION_CHANGED' using detail = 'Auth 계정이 있는 비활성 직원이 3명이 아닙니다: ' || m;
  end if;
end $g$;

update auth.users u
set banned_until = now() + interval '876000 hours'
from public.employees e
where e.id = u.id
  and e.is_active = false
  and (u.banned_until is null or u.banned_until < now());

select
  (select count(*) from public.employees where is_active = false) as inactive_total,
  (select count(*) from public.employees e join auth.users u on u.id = e.id
    where e.is_active = false and u.banned_until > now()) as inactive_banned,
  (select count(*) from public.employees e join auth.users u on u.id = e.id
    where e.is_active = true and u.banned_until > now()) as active_banned_must_be_0,
  (select count(*) from public.employees) as employees_total,
  (select count(*) from auth.users) as auth_users_total;

select c.conrelid::regclass::text as referencing_table,
  (xpath('/row/c/text()',
    query_to_xml('select count(*) as c from ' || c.conrelid::regclass::text, false, true, '')))[1]::text as row_count
from pg_constraint c
where c.contype = 'f' and c.confrelid = 'public.employees'::regclass
group by c.conrelid
order by 1;

commit;

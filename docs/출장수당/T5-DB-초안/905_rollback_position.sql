-- ⚠ 초안. 실행 금지. 005 되돌리기 — 900 을 먼저 실행한 뒤에만 (출장 함수·트리거가 position 을 참조).
-- 값이 하나라도 입력돼 있으면 멈춘다. 내보낸 뒤  select set_config('trip.confirm_drop', 'yes', false);  후 다시 실행.
do $$
begin
  if to_regprocedure('public.trip_view_grant_eligible(uuid)') is not null then
    raise exception 'ROLLBACK_ORDER' using detail = '900_rollback.sql 을 먼저 실행하세요 (출장 객체가 employees.position 을 참조)';
  end if;
  if exists (select 1 from public.employees where position is not null)
     and coalesce(current_setting('trip.confirm_drop', true), '') <> 'yes' then
    raise exception 'ROLLBACK_BLOCKED_DATA_EXISTS' using detail = 'employees.position 에 값이 있습니다. 내보낸 뒤 trip.confirm_drop=yes 로 다시 실행';
  end if;
end $$;

drop trigger if exists employees_position_admin_only on public.employees;
drop function if exists public.employees_position_guard();
alter table public.employees drop constraint if exists employees_position_trim_chk;
alter table public.employees drop column if exists position;

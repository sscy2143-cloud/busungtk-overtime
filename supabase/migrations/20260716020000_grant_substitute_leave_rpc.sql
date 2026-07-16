-- ============================================================
-- grant_substitute_leave: 대체휴가 지급을 원자적으로 처리하는 단일 RPC
--
-- 배경: 기존에는 클라이언트가 화면에 보이는 substitute_total 값을 읽어
--       "현재값 + 지급분"으로 덮어썼음. 화면 값이 틀리거나(다른 버그로 0),
--       동시에 두 번 눌리면 값이 어긋나고, 같은 야근이 중복 전환되기도 했음.
-- 해결: substitute_history INSERT + leave_balances 원자적 증가(x = x + delta)를
--       한 함수에서 처리. related_request_id가 있으면 중복 전환을 막음.
-- ============================================================

create or replace function grant_substitute_leave(
  p_employee_id uuid,
  p_granted_days numeric,
  p_reason text,
  p_year integer default extract(year from now())::integer,
  p_related_request_id uuid default null
)
returns numeric               -- 갱신된 substitute_total
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_total numeric;
begin
  if not is_manager_or_admin() then
    raise exception 'unauthorized';
  end if;

  if p_granted_days is null or p_granted_days <= 0 then
    raise exception '부여 일수가 올바르지 않습니다';
  end if;

  -- 특정 야근건 대체전환은 1회만 (중복 방지)
  if p_related_request_id is not null and exists (
    select 1 from substitute_history where related_request_id = p_related_request_id
  ) then
    raise exception '이미 대체휴가로 전환된 야근입니다';
  end if;

  insert into substitute_history (employee_id, granted_days, reason, granted_by, related_request_id)
  values (p_employee_id, p_granted_days, p_reason, auth.uid()::uuid, p_related_request_id);

  -- 원자적 증가: 기존 행이 있으면 잠금 후 더하고, 없으면 생성
  if exists (select 1 from leave_balances where employee_id = p_employee_id and year = p_year) then
    update leave_balances
       set substitute_total = coalesce(substitute_total, 0) + p_granted_days
     where employee_id = p_employee_id and year = p_year
    returning substitute_total into v_new_total;
  else
    insert into leave_balances (employee_id, year, total_days, used_days, substitute_total, substitute_used)
    values (p_employee_id, p_year, 0, 0, p_granted_days, 0)
    returning substitute_total into v_new_total;
  end if;

  return v_new_total;
end;
$$;

grant execute on function grant_substitute_leave(uuid, numeric, text, integer, uuid) to authenticated;

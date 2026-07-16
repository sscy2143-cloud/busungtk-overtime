-- ============================================================
-- 대체휴가 지급 내역 수정 / 삭제 RPC (잔액 원자적 보정)
--
-- 잘못 입력한 대체휴가 지급을 고치거나 삭제할 때, substitute_history 행과
-- leave_balances.substitute_total 을 함께(원자적으로) 맞춘다.
-- 대상 연도는 해당 이력의 created_at 연도 기준(부여 시 그 연도 잔액에 더해졌으므로).
-- ============================================================

-- 수정: 지급 일수/사유 변경 → 잔액을 (신규 - 기존)만큼 보정 -----
create or replace function adjust_substitute_grant(
  p_history_id uuid,
  p_new_granted_days numeric,
  p_new_reason text
)
returns numeric               -- 갱신된 substitute_total
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old substitute_history%rowtype;
  v_year integer;
  v_delta numeric;
  v_new_total numeric;
begin
  if not is_manager_or_admin() then
    raise exception 'unauthorized';
  end if;
  if p_new_granted_days is null or p_new_granted_days <= 0 then
    raise exception '지급 일수가 올바르지 않습니다';
  end if;

  select * into v_old from substitute_history where id = p_history_id;
  if not found then
    raise exception '대체휴가 내역을 찾을 수 없습니다';
  end if;

  v_year := extract(year from v_old.created_at)::integer;
  v_delta := p_new_granted_days - v_old.granted_days;

  update substitute_history
     set granted_days = p_new_granted_days,
         reason = p_new_reason
   where id = p_history_id;

  update leave_balances
     set substitute_total = greatest(coalesce(substitute_total, 0) + v_delta, 0)
   where employee_id = v_old.employee_id and year = v_year
  returning substitute_total into v_new_total;

  return coalesce(v_new_total, 0);
end;
$$;

grant execute on function adjust_substitute_grant(uuid, numeric, text) to authenticated;

-- 삭제: 이력 제거 → 잔액에서 해당 일수만큼 차감 ----------------
create or replace function delete_substitute_grant(
  p_history_id uuid
)
returns numeric               -- 갱신된 substitute_total
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old substitute_history%rowtype;
  v_year integer;
  v_new_total numeric;
begin
  if not is_manager_or_admin() then
    raise exception 'unauthorized';
  end if;

  select * into v_old from substitute_history where id = p_history_id;
  if not found then
    raise exception '대체휴가 내역을 찾을 수 없습니다';
  end if;

  v_year := extract(year from v_old.created_at)::integer;

  delete from substitute_history where id = p_history_id;

  update leave_balances
     set substitute_total = greatest(coalesce(substitute_total, 0) - v_old.granted_days, 0)
   where employee_id = v_old.employee_id and year = v_year
  returning substitute_total into v_new_total;

  return coalesce(v_new_total, 0);
end;
$$;

grant execute on function delete_substitute_grant(uuid) to authenticated;

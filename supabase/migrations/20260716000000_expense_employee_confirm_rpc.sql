-- ============================================================
-- 직원 본인 경비 수령확인 / 취소요청 RPC
-- 배경: expenses 테이블 UPDATE RLS 정책이 is_manager_or_admin()만 허용해
--       일반 직원(employee)이 "수령 확인" / "취소 요청"을 눌러도 RLS에 막혀
--       employee_confirmed_at / cancel_requested_at 저장이 조용히 실패했음.
-- 해결: 지정된 필드만 바꾸는 SECURITY DEFINER RPC 2개 제공.
--       금액/상태 등 다른 컬럼은 직원이 건드릴 수 없음(보안).
--       본인 행(employee_id = auth.uid())만 대상.
-- ============================================================

-- 1) 수령 확인 --------------------------------------------------
create or replace function confirm_expense_receipt(
  p_expense_id uuid,
  p_device text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  update expenses
     set employee_confirmed_at = v_now,
         confirmed_device = p_device
   where id = p_expense_id
     and employee_id = auth.uid()::uuid   -- 본인 행만
     and paid_at is not null                -- 지급 완료 건만
     and employee_confirmed_at is null;     -- 아직 확인 안 한 건만

  if not found then
    raise exception '수령 확인할 수 있는 경비가 아닙니다 (본인/지급완료/미확인 조건 불충족)';
  end if;

  return v_now;
end;
$$;

grant execute on function confirm_expense_receipt(uuid, text) to authenticated;

-- 2) 취소 요청 --------------------------------------------------
create or replace function request_expense_cancel(
  p_expense_id uuid,
  p_reason text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '취소 사유를 입력해야 합니다';
  end if;

  update expenses
     set cancel_requested_at = v_now,
         cancel_reason = btrim(p_reason)
   where id = p_expense_id
     and employee_id = auth.uid()::uuid   -- 본인 행만
     and cancel_requested_at is null;       -- 중복 요청 방지

  if not found then
    raise exception '취소 요청할 수 있는 경비가 아닙니다 (본인/미요청 조건 불충족)';
  end if;

  return v_now;
end;
$$;

grant execute on function request_expense_cancel(uuid, text) to authenticated;

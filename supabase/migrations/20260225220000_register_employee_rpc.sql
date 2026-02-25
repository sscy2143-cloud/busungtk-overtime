-- ============================================================
-- 첫 사용자 자동 admin 등록 RPC
-- 첫 번째 가입자 = admin + active, 이후 = employee + inactive
-- security definer로 RLS 우회
-- ============================================================

create or replace function public.register_employee(
  p_id uuid,
  p_name text,
  p_email text,
  p_avatar_url text default null
)
returns public.employees
language plpgsql
security definer
as $$
declare
  v_is_first boolean;
  v_role text;
  v_active boolean;
  v_result public.employees;
begin
  -- 이미 등록된 경우 기존 레코드 반환
  select * into v_result from public.employees where id = p_id;
  if found then
    return v_result;
  end if;

  -- 첫 번째 사용자인지 확인
  select not exists (select 1 from public.employees) into v_is_first;

  if v_is_first then
    v_role := 'admin';
    v_active := true;
  else
    v_role := 'employee';
    v_active := false;
  end if;

  insert into public.employees (id, name, email, avatar_url, department, role, employee_type, hourly_wage, is_active)
  values (p_id, p_name, p_email, p_avatar_url, '', v_role, 'office', 0, v_active)
  returning * into v_result;

  return v_result;
end;
$$;

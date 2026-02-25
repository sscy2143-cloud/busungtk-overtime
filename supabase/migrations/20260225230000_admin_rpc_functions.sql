-- ============================================================
-- 관리자 RPC 함수 (개발자 모드 + 인증된 admin 모두 지원)
-- security definer로 RLS 우회
-- ============================================================

-- 전체 직원 목록 조회
create or replace function public.list_all_employees(p_admin_key text default null)
returns setof public.employees
language plpgsql
security definer
as $$
begin
  -- 인증된 admin이거나, admin_key가 맞으면 허용
  if p_admin_key = '6325' or public.is_admin() then
    return query select * from public.employees order by created_at asc;
  else
    raise exception 'Unauthorized';
  end if;
end;
$$;

-- 직원 역할/상태 수정
create or replace function public.update_employee_admin(
  p_admin_key text default null,
  p_id uuid default null,
  p_role text default null,
  p_department text default null,
  p_is_active boolean default null
)
returns public.employees
language plpgsql
security definer
as $$
declare
  v_result public.employees;
begin
  if p_admin_key = '6325' or public.is_admin() then
    update public.employees
    set
      role = coalesce(p_role, role),
      department = coalesce(p_department, department),
      is_active = coalesce(p_is_active, is_active),
      updated_at = now()
    where id = p_id
    returning * into v_result;

    if not found then
      raise exception 'Employee not found';
    end if;

    return v_result;
  else
    raise exception 'Unauthorized';
  end if;
end;
$$;

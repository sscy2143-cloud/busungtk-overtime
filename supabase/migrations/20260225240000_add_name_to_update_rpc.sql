-- update_employee_admin RPC에 p_name 파라미터 추가
create or replace function public.update_employee_admin(
  p_admin_key text default null,
  p_id uuid default null,
  p_name text default null,
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
      name = coalesce(p_name, name),
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

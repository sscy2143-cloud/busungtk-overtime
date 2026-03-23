-- ============================================================
-- 보안 수정: RPC 함수에서 하드코딩된 관리자 키(6325) 제거
-- 모든 RPC 함수는 is_admin() / is_manager_or_admin()만 사용
-- ============================================================

-- 1. list_all_employees: admin 키 제거
create or replace function public.list_all_employees(p_admin_key text default null)
returns setof public.employees
language plpgsql
security definer
as $$
begin
  if public.is_admin() then
    return query select * from public.employees order by created_at asc;
  else
    raise exception 'Unauthorized';
  end if;
end;
$$;

-- 2. update_employee_admin: admin 키 제거
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
  if public.is_admin() then
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

-- 3. list_employee_balances: admin 키 제거
create or replace function list_employee_balances(
  p_admin_key text default null,
  p_year integer default extract(year from now())::integer
)
returns table (
  id uuid,
  name text,
  department text,
  total_days numeric,
  used_days numeric,
  remaining_days numeric
)
language plpgsql
security definer
as $$
begin
  if is_manager_or_admin() then
    return query
      select
        e.id,
        e.name::text,
        e.department::text,
        coalesce(lb.total_days, 0)::numeric,
        coalesce(lb.used_days, 0)::numeric,
        coalesce(lb.remaining_days, 0)::numeric
      from employees e
      left join leave_balances lb
        on lb.employee_id = e.id
        and lb.year = p_year
      where e.is_active = true
      order by e.name;
  else
    raise exception 'unauthorized';
  end if;
end;
$$;

-- 4. upsert_leave_balance: admin 키 제거
create or replace function upsert_leave_balance(
  p_employee_id uuid,
  p_year integer,
  p_delta numeric,
  p_admin_key text default null,
  p_reason text default ''
)
returns setof leave_balances
language plpgsql
security definer
as $$
declare
  v_existing leave_balances%rowtype;
begin
  if not is_manager_or_admin() then
    raise exception 'unauthorized';
  end if;

  select * into v_existing
  from leave_balances
  where employee_id = p_employee_id and year = p_year;

  if not found then
    return query
      insert into leave_balances (employee_id, year, total_days, used_days)
      values (p_employee_id, p_year, greatest(p_delta, 0), 0)
      returning *;
  else
    return query
      update leave_balances
      set total_days = greatest(total_days + p_delta, 0)
      where employee_id = p_employee_id and year = p_year
      returning *;
  end if;
end;
$$;

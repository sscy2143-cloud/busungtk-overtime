-- list_employee_balances: 전체 직원의 연차 잔여 현황 조회
-- admin key='6325' 또는 is_manager_or_admin() 확인
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
  if p_admin_key = '6325' or is_manager_or_admin() then
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

-- upsert_leave_balance: 직원 연차 부여/조정 (total_days += p_delta)
-- admin key='6325' 또는 is_manager_or_admin() 확인
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
  if not (p_admin_key = '6325' or is_manager_or_admin()) then
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

-- ============================================================
-- 대체휴가 표시 버그 2건 수정
--
-- A) substitute_history.related_request_id → overtime_requests(id) 외래키 추가
--    배경: 대체휴가 현황 페이지가 이 FK(substitute_history_related_request_id_fkey)로
--          overtime_requests를 조인하는데 FK 제약이 없어 쿼리가 에러 → 빈 화면.
--
-- B) list_employee_balances RPC가 substitute_total / substitute_used 도 반환하도록 수정
--    배경: 직원별 연차현황의 "대체" 칸이 RPC에 해당 컬럼이 없어 항상 0으로 표시됨.
-- ============================================================

-- A) 외래키 추가 (이미 존재하면 건너뜀) ------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'substitute_history_related_request_id_fkey'
  ) then
    alter table substitute_history
      add constraint substitute_history_related_request_id_fkey
      foreign key (related_request_id)
      references overtime_requests(id)
      on delete set null;
  end if;
end $$;

-- B) RPC 재정의 (반환 타입 변경이라 DROP 후 재생성) ------------
drop function if exists list_employee_balances(text, integer);

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
  remaining_days numeric,
  substitute_total numeric,
  substitute_used numeric
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
        coalesce(lb.remaining_days, 0)::numeric,
        coalesce(lb.substitute_total, 0)::numeric,
        coalesce(lb.substitute_used, 0)::numeric
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

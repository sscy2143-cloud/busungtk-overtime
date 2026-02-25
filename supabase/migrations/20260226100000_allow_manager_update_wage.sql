-- 인사담당(manager)도 시급(hourly_wage) 수정 가능하도록 RLS 정책 변경
-- 기존: admin만 employees UPDATE 가능
-- 변경: manager/admin 모두 employees UPDATE 가능

DROP POLICY IF EXISTS "employees_update_admin" ON employees;

CREATE POLICY "employees_update_manager_admin"
  ON employees FOR UPDATE
  USING (public.is_manager_or_admin());

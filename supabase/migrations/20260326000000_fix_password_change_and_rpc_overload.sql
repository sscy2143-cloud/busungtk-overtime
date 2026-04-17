-- ============================================================
-- 1. list_all_employees 함수 중복(overload) 제거 → PGRST203 에러 수정
-- ============================================================
DROP FUNCTION IF EXISTS public.list_all_employees();
DROP FUNCTION IF EXISTS public.list_all_employees(text);

CREATE OR REPLACE FUNCTION public.list_all_employees()
RETURNS SETOF public.employees
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF public.is_manager_or_admin() THEN
    RETURN QUERY SELECT * FROM public.employees ORDER BY created_at ASC;
  ELSE
    RAISE EXCEPTION 'Unauthorized';
  END IF;
END;
$$;

-- ============================================================
-- 2. update_employee_admin 함수 중복(overload) 제거 → PGRST203 에러 수정
-- ============================================================
DROP FUNCTION IF EXISTS public.update_employee_admin(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.update_employee_admin(text, uuid, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.update_employee_admin(
  p_id uuid,
  p_name text default null,
  p_role text default null,
  p_department text default null,
  p_is_active boolean default null
)
RETURNS public.employees
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result public.employees;
BEGIN
  IF public.is_admin() THEN
    UPDATE public.employees
    SET
      name = coalesce(p_name, name),
      role = coalesce(p_role, role),
      department = coalesce(p_department, department),
      is_active = coalesce(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Employee not found';
    END IF;

    RETURN v_result;
  ELSE
    RAISE EXCEPTION 'Unauthorized';
  END IF;
END;
$$;

-- ============================================================
-- 3. 비밀번호 변경 후 force_password_change 플래그 해제
--    일반 직원은 employees UPDATE RLS에 막혀서 직접 update 불가
--    SECURITY DEFINER로 RLS 우회
-- ============================================================
CREATE OR REPLACE FUNCTION public.clear_force_password_change()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.employees
  SET force_password_change = false
  WHERE id = auth.uid();
END;
$$;

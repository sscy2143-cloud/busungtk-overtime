-- 기존 테이블/함수 전부 삭제 후 재생성
DROP TABLE IF EXISTS ot_audit_logs CASCADE;
DROP TABLE IF EXISTS ot_notifications CASCADE;
DROP TABLE IF EXISTS leave_requests CASCADE;
DROP TABLE IF EXISTS leave_balances CASCADE;
DROP TABLE IF EXISTS leave_types CASCADE;
DROP TABLE IF EXISTS weekly_summaries CASCADE;
DROP TABLE IF EXISTS time_records CASCADE;
DROP TABLE IF EXISTS overtime_requests CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS employees CASCADE;

DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_role() CASCADE;
DROP FUNCTION IF EXISTS public.is_manager_or_admin() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.register_employee(uuid, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.list_all_employees(text) CASCADE;
DROP FUNCTION IF EXISTS public.update_employee_admin(text, uuid, text, text, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.list_employee_balances(text, integer) CASCADE;
DROP FUNCTION IF EXISTS public.upsert_leave_balance(uuid, integer, numeric, text, text) CASCADE;

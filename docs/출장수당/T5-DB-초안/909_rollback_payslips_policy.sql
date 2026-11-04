-- ⚠ 운영 미해당 (11-04 S-8 확정): 운영에는 admin_manage_payslips 가 없고 payslips_select_own / payslips_insert_admin / payslips_update_admin /
--   payslips_delete_admin + Storage 4개 정책이 있다. 이 파일은 실행하지 않는다. 실제 D13 패치는 010_payslips_active_only_restrictive.sql.
-- ⚠ 초안. 실행 금지. 009 되돌리기 — 20260306000006 원래 본문으로 (비활성 manager 세션의 급여명세서 접근이 다시 열린다).
drop policy if exists "admin_manage_payslips" on public.payslips;
create policy "admin_manage_payslips" on public.payslips
  for all using (
    exists (
      select 1 from public.employees
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

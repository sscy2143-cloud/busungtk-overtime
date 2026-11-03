-- ⚠ 초안. 실행 금지. 009 되돌리기 — 20260306000006 원래 본문으로 (비활성 manager 세션의 급여명세서 접근이 다시 열린다).
drop policy if exists "admin_manage_payslips" on public.payslips;
create policy "admin_manage_payslips" on public.payslips
  for all using (
    exists (
      select 1 from public.employees
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

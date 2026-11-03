-- ⚠ 초안. 실행 금지. 급여명세서 정책 변경 — 별도 승인 후 (D13, 2026-11-03).
-- ============================================================
-- 009: payslips 의 관리자 정책을 활성 인사담당·대표만으로 (비활성 manager 세션의 급여명세서 접근 차단)
--
-- 운영 정책(20260306000006, S-1 식 대조 필요):
--   employees_see_own_payslips  FOR SELECT USING (employee_id = auth.uid())                       ← 그대로 둔다 (secpatch C 단계 범위)
--   admin_manage_payslips       FOR ALL USING (exists(select 1 from employees where id = auth.uid() and role in ('admin','manager')))
--   → role 만 보고 is_active 를 보지 않아, 퇴사(비활성) 인사담당의 남은 세션·재로그인으로 명세서 전체(조회·수정·삭제)가 열린다.
-- 변경: using 을 public.is_manager_or_admin() 으로 교체. 007 이 적용된 운영에서는 이 함수가 is_active 를 보므로 비활성 계정은 false.
--   활성 인사담당·대표의 동작은 동일(같은 두 역할). with check 를 쓰지 않는 기존 모양을 유지한다(using 이 쓰기 검사에도 적용됨).
-- 전제: 007 적용 완료(11-03 확인). 적용 전후 확인: 보안점검-읽기전용.sql 의 S-8(payslips 정책) 항목.
-- Storage: payslips 버킷의 storage.objects 정책은 마이그레이션에 없다(대시보드 설정) → S-8 로 읽어 role 만 보는지 확인한 뒤 별도 결정.
-- 되돌리기: 909_rollback_payslips_policy.sql (원래 본문으로 복원 — 비활성 manager 접근이 다시 열림)
-- ============================================================
begin;

do $chk$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payslips' and policyname = 'admin_manage_payslips') then
    raise exception 'PRECONDITION_CHANGED' using detail = 'admin_manage_payslips 정책이 없습니다';
  end if;
  if (select pg_get_functiondef('public.is_manager_or_admin()'::regprocedure)) not like '%is_active%' then
    raise exception 'PRECONDITION_CHANGED' using detail = 'is_manager_or_admin() 에 is_active 가 없습니다 (007 미적용)';
  end if;
end $chk$;

drop policy "admin_manage_payslips" on public.payslips;
create policy "admin_manage_payslips" on public.payslips
  for all using (public.is_manager_or_admin());

select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'payslips'
order by policyname;

commit;

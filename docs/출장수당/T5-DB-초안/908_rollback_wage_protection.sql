-- ⚠ 초안. 실행 금지. 008a·008b 되돌리기 — 정책을 운영 S-1 과 같은 본문으로 복원하고 뷰를 지운다.
-- 앱이 뷰를 읽는 판으로 배포돼 있으면 뷰를 지우기 전에 앱을 먼저 되돌린다.
drop policy if exists "employees_select_active_for_group" on public.employees;
create policy "employees_select_active_for_group" on public.employees
  for select using ((is_active = true) and public.is_employee());
drop view if exists public.employees_directory;

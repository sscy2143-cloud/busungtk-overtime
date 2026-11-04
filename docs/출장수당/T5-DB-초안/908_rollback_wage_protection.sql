-- ⚠ 최후 수단. 실행하면 "일반 직원이 전원의 시급·2차 인증 해시를 읽는" 운영 S-1 상태로 돌아간다 — 기본 롤백으로 쓰지 않는다.
-- D14 장애 대응의 기본 경로는 보안패치-운영절차.md 의 "D14 장애 대응" 절:
--   앱 문제 → 이전 배포(9f9fd1f)로 promote (정책이 이미 제거됐으면 그룹 직원 선택 목록만 비어 보임, 노출 없음)
--   뷰 문제 → 008a 재실행(create or replace, 멱등)
--   이 파일은 사용자가 "노출을 감수하고 그룹 신청을 즉시 복구" 하기로 명시 결정했을 때만, 한 번에 실행한다.
drop policy if exists "employees_select_active_for_group" on public.employees;
create policy "employees_select_active_for_group" on public.employees
  for select using ((is_active = true) and public.is_employee());
drop view if exists public.employees_directory;

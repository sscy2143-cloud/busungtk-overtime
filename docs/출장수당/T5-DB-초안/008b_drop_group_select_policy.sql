-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (D14 3단계: 앱(hotfix-d14)이 employees_directory 를 읽도록 배포돼 정상 확인된 뒤에만).
-- 1) employees_select_active_for_group 제거 → 일반 직원은 base 표에서 본인 행만(employees_select_self).
--    인사담당·대표는 employees_select_manager 로 전원 조회 그대로. 표·칼럼 권한은 바꾸지 않는다.
--    앱 배포 전에 실행하면 야근 그룹 직원 선택 목록이 비어 보인다 (오류는 아님).
-- 2) register_employee(uuid, text, text, text) 는 SECURITY DEFINER 이고 이미 있는 id 를 넣으면 그 직원 행 전체를 돌려준다
--    (secpatch 메모·PGlite 재현) → 같은 데이터의 우회 경로. 2026-10-06 H-0 가 EXECUTE 를 회수했다고 기록돼 있다(S-3 acl 로 확인).
--    여기서는 멱등으로 한 번 더 회수한다 (이미 회수돼 있으면 아무 변화 없음).
drop policy if exists "employees_select_active_for_group" on public.employees;
revoke execute on function public.register_employee(uuid, text, text, text) from public, anon, authenticated;

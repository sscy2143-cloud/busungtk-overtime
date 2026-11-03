-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (D14 2단계: 앱이 employees_directory 를 읽도록 배포된 뒤에만).
-- employees_select_active_for_group 를 제거한다 → 일반 직원은 base 표에서 본인 행만(employees_select_self) 읽는다.
-- 인사담당·대표는 employees_select_manager 로 전원 조회가 그대로다. 표·칼럼 권한은 바꾸지 않는다.
-- 앱 배포 전에 실행하면 야근 그룹 직원 선택·출장 동행자 목록이 비어 보인다 (오류는 아님).
drop policy if exists "employees_select_active_for_group" on public.employees;

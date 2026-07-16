-- ============================================================
-- list_employee_balances 함수 오버로드 충돌 해결
--
-- 배경: 라이브 DB에 1인자 버전 list_employee_balances(integer) 이 이미 존재했는데,
--       20260716010000 마이그레이션이 2인자 버전(text, integer)을 추가하면서
--       프론트가 {p_year}만 넘겨 호출할 때 어느 함수인지 결정하지 못해
--       PGRST203 에러 → "활성 직원이 없습니다" 로 목록이 비어 보였음.
-- 해결: 옛 1인자 버전을 제거. substitute_total/substitute_used 까지 반환하는
--       2인자 버전만 남긴다(p_admin_key 는 default null 이라 {p_year} 호출도 매칭됨).
-- ============================================================

drop function if exists list_employee_balances(integer);

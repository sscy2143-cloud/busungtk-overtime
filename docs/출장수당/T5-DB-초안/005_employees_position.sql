-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (기존 표 employees 에 칼럼을 더하는 유일한 파일).
-- ============================================================
-- 출장수당 005: employees.position — 회사 직급 (시스템 역할 role 과 분리)  (2026-11-03)
--
--   - 요구: "회사 직급이 '팀장' 인 직원 중 admin 이 직접 조회 권한을 준 사람만 전체 출장 내역 조회".
--     기존 role(employee/manager/admin) 은 시스템 권한이며 manager 는 '인사담당' 이라 팀장 식별에 쓰지 않는다.
--   - 기본값 NULL. 기존 행은 건드리지 않는다 (일괄 입력·추정 금지). 직원관리 화면에서 대표(admin)가 직원별로 입력한다.
--   - 기존 기능 무영향: RLS·RPC·급여·야근 코드는 이 칼럼을 읽지 않는다. list_all_employees() 는 select * 라 자동 포함된다.
--     employees UPDATE 정책(employees_update_manager_admin)은 그대로 — 화면에서는 admin 만 바꾸게 막고, 서버 쪽 제한은 D10 결정.
--   - 출장 쪽 사용처: 020 trip_view_grant_eligible() 이 is_active and position = '팀장' and role <> 'admin' 을 본다.
--   - 순서: 005 → 010 → 020 → 030 → 040.  되돌리기: 900 → 905 (값이 하나라도 있으면 905 는 멈춘다).
-- ============================================================
alter table public.employees add column if not exists position text;

-- 공백·빈 문자열 금지 (화면은 빈 값을 NULL 로 보낸다). 판정은 정확히 '팀장' 과 비교한다
alter table public.employees drop constraint if exists employees_position_trim_chk;
alter table public.employees add constraint employees_position_trim_chk
  check (position is null or (position = btrim(position) and length(position) > 0));

comment on column public.employees.position is '회사 직급 (예: 팀장). 시스템 역할 role 과 별개. NULL = 미지정';

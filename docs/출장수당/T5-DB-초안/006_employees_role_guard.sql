-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (기존 표 employees 에 트리거를 거는 파일, D11).
-- ============================================================
-- 006: employees.role 변경은 활성 admin 만 (2026-11-03)
--
-- 배경 (PGlite 재현, 운영 정책 사본 기준 — 운영 실제 정의는 C-3·C-7 대조로 확인)
--   employees_update_manager_admin 정책은 using(is_manager_or_admin()) 뿐이고 with check 가 없다.
--   따라서 인사담당(manager)이 REST 로 employees 를 직접 UPDATE 하면 자기 role 을 'admin' 으로, 남의 role 도 바꿀 수 있다.
--   화면(직원관리)은 manager 가 role 을 보내지 않지만 서버는 막지 않는다. role 이 admin 이 되면 야근 승인·사용자 관리·
--   급여 화면(SecondAuthGate 만 남음)·api/admin-user(생성·비밀번호 초기화)·출장 스위치/승인/조회 권한/직급 변경이 전부 열린다.
--
-- 방식: BEFORE UPDATE OF role 트리거 — 005 의 position 가드와 같은 꼴.
--   - 값이 실제로 바뀌고, 세션 사용자(auth.uid)가 있으며, 그 사용자가 활성 admin 이 아니면 ROLE_ADMIN_ONLY(42501).
--   - 정책·칼럼 권한·다른 칼럼(이름·부서·시급·입사일·활성)은 그대로 → 인사담당의 기존 업무 유지.
--   - admin 전용 RPC update_employee_admin(is_admin() 검사)은 admin 세션이므로 통과. 세션 없는 경로(service_role·SQL Editor)도 통과.
--   - 직원(employee)은 UPDATE 정책이 없어 원래 0행.
-- 독립: 005·010~040 과 무관. 출장 도입과 관계없이 먼저 적용해도 되고, 906 으로 단독 되돌린다.
-- ============================================================
create or replace function public.employees_role_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not exists (select 1 from public.employees where id = auth.uid() and role = 'admin' and is_active = true) then
    raise exception 'ROLE_ADMIN_ONLY' using detail = '시스템 권한(role)은 대표(admin)만 바꿀 수 있습니다', errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.employees_role_guard() from public, anon, authenticated;

drop trigger if exists employees_role_admin_only on public.employees;
create trigger employees_role_admin_only
  before update of role on public.employees
  for each row execute function public.employees_role_guard();

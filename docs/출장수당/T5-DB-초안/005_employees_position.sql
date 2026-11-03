-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (기존 표 employees 에 칼럼을 더하는 유일한 파일).
-- ============================================================
-- 출장수당 005: employees.position — 회사 직급 (시스템 역할 role 과 분리)  (2026-11-03)
--
--   - 요구: "회사 직급이 '팀장' 인 직원 중 admin 이 직접 조회 권한을 준 사람만 전체 출장 내역 조회".
--     기존 role(employee/manager/admin) 은 시스템 권한이며 manager 는 '인사담당' 이라 팀장 식별에 쓰지 않는다.
--   - 기본값 NULL. 기존 행은 건드리지 않는다 (일괄 입력·추정 금지). 직원관리 화면에서 대표(admin)가 직원별로 입력한다.
--   - 기존 기능 무영향: RLS·RPC·급여·야근 코드는 이 칼럼을 읽지 않는다. list_all_employees() 는 select * 라 자동 포함된다.
--     employees UPDATE 정책(employees_update_manager_admin: 인사담당·대표 모두 UPDATE 가능, with check 없음)은 그대로 둔다.
--   - D10 (11-03 결정): position 변경만 BEFORE UPDATE 트리거로 막는다 — 세션 사용자가 있고(auth.uid()) 활성 admin 이 아니면
--     POSITION_ADMIN_ONLY(42501). REST 직접 UPDATE 도 같은 트리거를 지나므로 직원·인사담당은 위조할 수 없다.
--     값이 같은 UPDATE(직원관리 저장 경로가 원본 position 을 그대로 보내는 경우)는 통과하므로 인사담당의 다른 업무는 그대로다.
--     RLS 정책을 바꾸지 않는 이유: 정책은 행 단위라 "한 칼럼만" 을 표현할 수 없고, 칼럼 권한(REVOKE UPDATE(position))은
--     authenticated 의 표 단위 UPDATE 권한을 통째로 바꿔야 해서 기존 저장 경로·새 칼럼 관리에 영향이 크다.
--     service_role·SQL Editor(세션 사용자 없음)는 통과한다 — 운영자가 직접 고치는 경로.
--   - 출장 쪽 사용처: 020 trip_view_grant_eligible() 이 is_active and position = '팀장' and role <> 'admin' 을 본다.
--   - 순서: 005 → 010 → 020 → 030 → 040.  되돌리기: 900 → 905 (값이 하나라도 있으면 905 는 멈춘다).
-- ============================================================
alter table public.employees add column if not exists position text;

-- 공백·빈 문자열 금지 (화면은 빈 값을 NULL 로 보낸다). 판정은 정확히 '팀장' 과 비교한다
alter table public.employees drop constraint if exists employees_position_trim_chk;
alter table public.employees add constraint employees_position_trim_chk
  check (position is null or (position = btrim(position) and length(position) > 0));

comment on column public.employees.position is '회사 직급 (예: 팀장). 시스템 역할 role 과 별개. NULL = 미지정';

-- D10: 직급 변경은 대표(admin)만. 다른 칼럼의 변경·기존 정책은 그대로
create or replace function public.employees_position_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return new; end if;                                  -- service_role·SQL Editor
  if tg_op = 'UPDATE' and new.position is not distinct from old.position then return new; end if;
  if tg_op = 'INSERT' and new.position is null then return new; end if;
  if not exists (select 1 from public.employees where id = auth.uid() and role = 'admin' and is_active = true) then
    raise exception 'POSITION_ADMIN_ONLY' using detail = '회사 직급은 대표(admin)만 바꿀 수 있습니다', errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.employees_position_guard() from public, anon, authenticated;

drop trigger if exists employees_position_admin_only on public.employees;
create trigger employees_position_admin_only
  before insert or update of position on public.employees
  for each row execute function public.employees_position_guard();

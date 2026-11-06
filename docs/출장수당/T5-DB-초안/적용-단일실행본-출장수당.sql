-- ============================================================
-- 출장수당 DB 적용 단일 실행본 (005 -> 010 -> 020 -> 030 -> 040)
-- 하나의 트랜잭션. 사전 조건이 하나라도 다르면 아무것도 바꾸지 않고 중단한다.
-- 011, 012, 013 은 이미 적용돼 있어야 하며 여기서 다시 실행하지 않는다.
-- 기능 스위치는 전부 꺼진 채로 끝난다. 기존 표의 데이터는 바꾸지 않는다.
-- 이 파일은 적용-머리.sql + 각 SQL 원본 + 적용-꼬리.sql 을 그대로 이어 붙인 것이다.
-- ============================================================
begin;
do $pre$
declare
  n int;
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'PRECONDITION pg_version_below_15';
  end if;
  if to_regclass('public.holidays') is not null then
    raise exception 'PRECONDITION holidays_already_exists';
  end if;
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relname like 'trip\_%';
  if n <> 0 then
    raise exception 'PRECONDITION trip_objects_already_exist count=%', n;
  end if;
  select count(*) into n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public'
    and (p.proname like 'trip\_%' or p.proname like '\_trip\_%');
  if n <> 0 then
    raise exception 'PRECONDITION trip_functions_already_exist count=%', n;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees'
      and column_name = 'position') then
    raise exception 'PRECONDITION employees_position_already_exists';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.employees'::regclass
      and tgname = 'employees_role_admin_only') then
    raise exception 'PRECONDITION missing_006_role_guard';
  end if;
  if pg_get_functiondef('public.is_admin()'::regprocedure)
       not like '%is_active%' then
    raise exception 'PRECONDITION missing_007_is_active_check';
  end if;
  if to_regclass('public.employees_directory') is null then
    raise exception 'PRECONDITION missing_008_directory_view';
  end if;
  if has_table_privilege('authenticated', 'public.employees', 'DELETE')
     or has_table_privilege('anon', 'public.employees', 'SELECT') then
    raise exception 'PRECONDITION missing_011_employees_privileges';
  end if;
  if to_regclass('ops_backup.rpc_acl_012') is null then
    raise exception 'PRECONDITION missing_012_backup';
  end if;
  select count(*) into n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'PRECONDITION anon_can_execute_definer count=%', n;
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.employees'::regclass
      and tgname = 'employees_active_server_only') then
    raise exception 'PRECONDITION missing_013_active_guard';
  end if;
end $pre$;
create temp table trip_apply_before on commit drop as
select 'employees' as t, count(*) as n from public.employees
union all select 'employees_active', count(*) from public.employees
  where is_active
union all select 'employees_inactive', count(*) from public.employees
  where not is_active
union all select 'overtime_requests', count(*) from public.overtime_requests
union all select 'payslips', count(*) from public.payslips
union all select 'definer_functions', count(*) from pg_proc p
  join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prosecdef;

-- ############################################################
-- ## 005_employees_position.sql (원본 그대로)
-- ############################################################
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

-- ############################################################
-- ## 010_trip_tables.sql (원본 그대로)
-- ############################################################
-- ⚠ 초안. 실행 금지. 근태관리 Supabase(wvwbaqyxztgcrkiacvql)는 일시정지 상태이며 재개·적용은 사용자 승인 후.
-- 적용 전 필수: 운영 스키마 읽기 전용 대조 (HANDOFF 9절), 롤백 SQL 검증, 스테이징 없음 → 트랜잭션 단위 적용.
-- ============================================================
-- 출장수당 010: 신규 테이블 (기존 테이블 무변경)
--
-- 근거: docs/출장수당/HANDOFF.md 6절, src/features/trip/data/types.ts
--
-- 원칙
--   - 기존 테이블(employees, overtime_requests, time_records, payslips ...)은
--     컬럼·제약·트리거·정책을 하나도 바꾸지 않는다. employees 는 FK 로 참조만 한다.
--   - 기존 마이그레이션은 `create table if not exists` 를 쓰지만, 이 파일은 일부러
--     `create table` 을 쓴다. 같은 이름의 테이블(특히 holidays)이 이미 있으면
--     조용히 건너뛰지 않고 트랜잭션 전체가 실패하게 하기 위함이다.
--   - 직원 입력 원본(DayEntry)은 jsonb 로 그대로 보존하고, 조회·제약에 필요한 값만
--     칼럼으로 뽑는다. 칼럼 값은 RPC(040)가 jsonb 에서 계산해 채운다.
--   - 시각 칼럼은 "근무일 0시 기준 분" (다음 날이면 1440 이상). 예: 익일 02:30 → 1590.
--   - 표준 이동시간은 어디에도 "실제 기록"으로 저장하지 않는다 (HANDOFF 5-1).
--   - 급여 반영 관련 테이블(payroll_periods, allowance_settlements)은 이번 초안에 없다.
--
-- 권장 적용 방식: begin; \i 010 ; \i 020 ; \i 030 ; \i 040 ; (검증) commit;
-- ============================================================

-- ------------------------------------------------------------
-- 0. 보조 함수: 'HH:MM' + 다음날 여부 → 근무일 0시 기준 분
--    types.ts ClockTime('HH:MM', 00:00~24:00), TimeRangeInput.startNextDay/endNextDay
-- ------------------------------------------------------------
-- updated_at 자동 갱신 트리거 함수 (11-03: 기존 update_updated_at_column() 에 의존하지 않도록 출장 전용으로 둔다. 900 에서 제거)
create or replace function public.trip_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.trip_clock_to_min(p_clock text, p_next_day boolean default false)
returns integer
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_h integer;
  v_m integer;
begin
  if p_clock is null then
    return null;
  end if;
  if p_clock !~ '^([01][0-9]|2[0-4]):[0-5][0-9]$' then
    raise exception 'INVALID_TIME' using detail = format('시각 형식이 올바르지 않습니다: %s', p_clock);
  end if;
  v_h := split_part(p_clock, ':', 1)::integer;
  v_m := split_part(p_clock, ':', 2)::integer;
  if v_h = 24 and v_m <> 0 then
    raise exception 'INVALID_TIME' using detail = format('24시 뒤에는 분을 쓸 수 없습니다: %s', p_clock);
  end if;
  return v_h * 60 + v_m + case when coalesce(p_next_day, false) then 1440 else 0 end;
end;
$$;

-- ============================================================
-- 1. trip_rule_versions — 규칙 버전 (engine/rules.ts RULE_VERSION, RULES)
-- ============================================================
--   rule_status: { "<RuleId>": "<RuleStatus>" } — rules.ts RULES 의 status 만 사본.
--   미확정 회사 규정(E3~E7, N1, N2)은 여기서 'undecided' 상태로만 둔다. DB 가 확정하지 않는다.
--   계산 결과(trip_day_calcs)가 한 번이라도 참조한 버전은 수정·삭제 금지 (트리거).
--   단, is_active 만 바꾸는 UPDATE 는 허용한다 (새 버전으로 바꿀 때 옛 버전을 끄기 위해).
--   is_active (v2 서버 재계산): 지금 계산에 쓰는 버전. 부분 UNIQUE 로 최대 1건.
--     시행일(effective_from)이 미정이라 활성 여부는 is_active 로만 판단한다 (계약 5절).
--     서버 저장 RPC(040 trip_store_server_calcs)는 rule_version = trip_active_rule_version() 만 받는다.
create table public.trip_rule_versions (
  version         text primary key,                   -- rules.ts RULE_VERSION
  effective_from  date,                               -- null = 시행일 미정 (시범 계산 전용)
  effective_to    date,
  rule_status     jsonb not null,
  note            text not null default '',
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check (jsonb_typeof(rule_status) = 'object')
);

-- 활성 버전은 1건만
create unique index uq_trip_rule_versions_active
  on public.trip_rule_versions(is_active)
  where is_active;

-- [미확인] 시행일: 최종본 작성일(2026-10-26)을 쓸지, 회사가 정할지 미결정 → null 로 둠.
-- 이 seed 가 활성 버전이다. 서버 번들의 RULE_VERSION 과 같아야 한다 (다르면 compute 함수가 RULE_VERSION_MISMATCH).
insert into public.trip_rule_versions (version, effective_from, rule_status, note, is_active) values (
  '2026-10-26-final/proposals-v0',
  null,
  jsonb_build_object(
    '2', 'final', '3', 'final', '4', 'final',
    '5-1', 'final', '5-2', 'final', '5-3', 'final', '5-4', 'final',
    '5-5', 'final', '5-6', 'final', '5-7', 'final', '5-8', 'final', '6', 'final',
    'E1', 'adopted',
    'E2', 'record_only',
    'E3', 'undecided', 'E4', 'undecided', 'E5', 'undecided', 'E6', 'undecided', 'E7', 'undecided',
    'E8', 'record_only',
    'E9', 'warning_only',
    'N1', 'undecided', 'N2', 'undecided',
    'C-0', 'legal_review'
  ),
  'rules.ts 사본. undecided 규칙이 쓰인 값은 제안값(proposed)이며 관리자 확정 전 급여 미반영',
  true
);

create or replace function public.trip_rule_versions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- is_active 만 바꾸는 UPDATE 는 허용 (활성 버전 교체). 다른 칼럼이 하나라도 바뀌면 아래 검사
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'is_active') = (to_jsonb(old) - 'is_active') then
    return new;
  end if;
  if exists (select 1 from public.trip_day_calcs where rule_version = old.version) then
    raise exception 'RULE_VERSION_IN_USE'
      using detail = format('계산 결과가 참조한 규칙 버전(%s)은 수정·삭제할 수 없습니다. 새 버전을 만드세요', old.version);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
-- 트리거는 trip_day_calcs 생성 뒤에 건다 (아래 9절 끝).

-- ============================================================
-- 2. trip_regions — 지역별 표준 편도시간 (engine/regions.ts, 최종본 2절)
-- ============================================================
--   code: regions.ts 키 그대로 ('서울', '경기:수원', '광주광역시' ...).
--   경기 광주시('경기:광주', 제외 지역)와 광주광역시('광주광역시', 3시간)는 다른 코드.
create table public.trip_regions (
  code             text not null,
  sido             text not null,
  sigungu          text,                               -- 경기만 사용
  region_class     text not null check (region_class in ('excluded', 'standard', 'jeju')),
  one_way_minutes  integer,                            -- standard 만 값, 나머지 null
  effective_from   date not null,
  effective_to     date,
  created_at       timestamptz not null default now(),
  primary key (code, effective_from),
  check (effective_to is null or effective_to >= effective_from),
  check (
    (region_class = 'standard' and one_way_minutes in (60, 120, 180, 240))
    or (region_class <> 'standard' and one_way_minutes is null)
  )
);
-- [미확인] 같은 code 의 적용 기간 겹침 방지는 btree_gist 확장 + exclusion 제약이 필요.
--          확장 사용 여부 미확인이라 RPC 조회 시 "effective_to is null or >= 근무일" 중 최신 1건만 쓰는 규칙으로 대신함.

-- seed: regions.ts 와 1:1. 적용 시작일은 최종본 날짜를 임시로 사용 [미확인: 회사 시행일 결정 시 교체].
insert into public.trip_regions (code, sido, sigungu, region_class, one_way_minutes, effective_from)
select v.code, v.sido, v.sigungu, v.cls, v.mins, date '2026-10-26'
from (values
  ('서울',        '서울', null::text, 'excluded', null::integer),
  ('인천',        '인천', null,       'excluded', null),
  -- 경기 남부 21개 시·군 (제외 지역)
  ('경기:수원',   '경기', '수원',     'excluded', null),
  ('경기:성남',   '경기', '성남',     'excluded', null),
  ('경기:용인',   '경기', '용인',     'excluded', null),
  ('경기:안양',   '경기', '안양',     'excluded', null),
  ('경기:안산',   '경기', '안산',     'excluded', null),
  ('경기:화성',   '경기', '화성',     'excluded', null),
  ('경기:평택',   '경기', '평택',     'excluded', null),
  ('경기:오산',   '경기', '오산',     'excluded', null),
  ('경기:시흥',   '경기', '시흥',     'excluded', null),
  ('경기:군포',   '경기', '군포',     'excluded', null),
  ('경기:의왕',   '경기', '의왕',     'excluded', null),
  ('경기:과천',   '경기', '과천',     'excluded', null),
  ('경기:광명',   '경기', '광명',     'excluded', null),
  ('경기:부천',   '경기', '부천',     'excluded', null),
  ('경기:하남',   '경기', '하남',     'excluded', null),
  ('경기:광주',   '경기', '광주',     'excluded', null),
  ('경기:이천',   '경기', '이천',     'excluded', null),
  ('경기:여주',   '경기', '여주',     'excluded', null),
  ('경기:양평',   '경기', '양평',     'excluded', null),
  ('경기:안성',   '경기', '안성',     'excluded', null),
  ('경기:김포',   '경기', '김포',     'excluded', null),
  -- 경기 북부 10개 시·군 (1시간)
  ('경기:고양',   '경기', '고양',     'standard', 60),
  ('경기:파주',   '경기', '파주',     'standard', 60),
  ('경기:의정부', '경기', '의정부',   'standard', 60),
  ('경기:양주',   '경기', '양주',     'standard', 60),
  ('경기:동두천', '경기', '동두천',   'standard', 60),
  ('경기:포천',   '경기', '포천',     'standard', 60),
  ('경기:연천',   '경기', '연천',     'standard', 60),
  ('경기:남양주', '경기', '남양주',   'standard', 60),
  ('경기:구리',   '경기', '구리',     'standard', 60),
  ('경기:가평',   '경기', '가평',     'standard', 60),
  ('충북',        '충북', null,       'standard', 60),
  ('충남',        '충남', null,       'standard', 120),
  ('세종',        '세종', null,       'standard', 120),
  ('대전',        '대전', null,       'standard', 120),
  ('강원',        '강원', null,       'standard', 120),
  ('전북',        '전북', null,       'standard', 120),
  ('경북',        '경북', null,       'standard', 180),
  ('대구',        '대구', null,       'standard', 180),
  ('광주광역시',  '광주', null,       'standard', 180),
  ('전남',        '전남', null,       'standard', 180),
  ('경남',        '경남', null,       'standard', 240),
  ('울산',        '울산', null,       'standard', 240),
  ('부산',        '부산', null,       'standard', 240),
  ('제주',        '제주', null,       'jeju',     null)
) as v(code, sido, sigungu, cls, mins);
-- 검증용: 위 seed 는 47행이어야 한다 (서울·인천 2 + 경기남부 21 + 경기북부 10 + 시·도 13 + 제주 1).

-- ============================================================
-- 3. holidays — 공휴일 (K10: 기존 overtime-calc.ts 의 2026년 고정 공휴일 대체)
-- ============================================================
--   출처(source)와 검증(verified_at, verified_by)이 없는 행은 "검증 안 된 달력"으로 취급한다.
--   엔진·RPC 는 is_verified = true 인 행만 공휴일로 쓰고, 검증 안 된 행이 걸린 날은
--   확인 표시 대상으로 삼는다 [권장]. 이 초안에는 seed 를 넣지 않는다 (출처 없는 달력 금지).
-- [미확인] 운영 DB에 같은 이름의 holidays 테이블이 이미 있는지 → 대조-체크리스트 C-5.
--          있으면 이 create 가 실패하며, 그때는 trip_holidays 로 이름을 바꾸는 안을 택한다.
create table public.holidays (
  holiday_date  date primary key,
  name          text not null,
  kind          text not null default 'public'
                check (kind in ('public', 'substitute', 'temporary', 'election', 'company')),
  source        text,                                  -- 예: '관보 제xxxx호', '우주항공청 월력요항 2026'
  verified_at   timestamptz,
  verified_by   uuid references public.employees(id) on delete set null,
  is_verified   boolean generated always as (source is not null and verified_at is not null) stored,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger holidays_updated_at
  before update on public.holidays
  for each row execute function public.trip_touch_updated_at();

-- ============================================================
-- 4. trip_claims — 출장 1건 (직원 1명). types.ts TripClaimRecord
-- ============================================================
-- 매핑 (TripClaimRecord → 칼럼)
--   id          → id
--   employeeId  → employee_id
--   groupId     → group_id          (동행 묶음. 신청자 건은 group_id = id)
--   initiatorId → initiator_id
--   origin      → origin            ('self' | 'companion_draft')
--   header      → header (jsonb 원본) + regions/schedule_kind/start_date/end_date (조회용 사본)
--   status      → status            (ClaimStatus)
--   version     → version
--   createdAt   → created_at, updatedAt → updated_at, submittedAt → submitted_at
--   (types.ts 에 없음) input_route   K12 대리 입력 구분 — 관리자가 대신 작성하면 'proxy'
--   (types.ts 에 없음) evidence      K11 증빙 첨부 정보 (기존 overtime_evidence 재사용 여부 [미확인])
--   (types.ts 에 없음) deadline_date K11 다음 영업일 마감 (overtime-window.ts 규칙 재사용 [미확인])
--
-- employees FK 는 on delete restrict: 최종본 7절 "표준시간과 실제 시각 3년 보관".
--   [미확인] 기존 앱에 직원 삭제 흐름이 있으면 출장 기록이 있는 직원 삭제가 막힌다 → README 충돌 항목.
create table public.trip_claims (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id) on delete restrict,
  group_id       uuid not null,
  initiator_id   uuid not null references public.employees(id) on delete restrict,
  origin         text not null default 'self' check (origin in ('self', 'companion_draft')),
  input_route    text not null default 'self' check (input_route in ('self', 'proxy')),
  header         jsonb not null,
  regions        text[] not null,
  schedule_kind  text not null check (schedule_kind in ('day', 'stay')),
  start_date     date not null,
  end_date       date not null,
  status         text not null default 'draft'
                 check (status in ('draft', 'submitted', 'returned', 'approved', 'rejected', 'cancelled')),
  version        integer not null default 1 check (version >= 1),
  evidence       jsonb,
  deadline_date  date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  check (cardinality(regions) >= 1),
  check (
    (schedule_kind = 'day'  and end_date = start_date)
    or (schedule_kind = 'stay' and end_date > start_date)
  ),
  check (status <> 'submitted' or submitted_at is not null)
);

create index idx_trip_claims_employee on public.trip_claims(employee_id);
create index idx_trip_claims_group    on public.trip_claims(group_id);
create index idx_trip_claims_status   on public.trip_claims(status);
create index idx_trip_claims_dates    on public.trip_claims(start_date, end_date);

-- updated_at 은 RPC 가 명시적으로 넣지만, 누락 방지용 트리거를 둔다 (함수는 파일 앞부분의 trip_touch_updated_at).
create trigger trip_claims_updated_at
  before update on public.trip_claims
  for each row execute function public.trip_touch_updated_at();

-- ============================================================
-- 5. trip_claim_days — 근무일별 입력. types.ts TripDayRecord
-- ============================================================
-- 매핑 (TripDayRecord → 칼럼)
--   id          → id
--   claimId     → claim_id
--   employeeId  → employee_id   (claim 의 employee_id 와 같아야 함 — 트리거 검사)
--   date        → work_date
--   entry       → entry (DayEntry jsonb 원본)
--   revision    → revision
--   (조회용 사본, RPC 가 entry 에서 계산)
--     entry.site.start/startNextDay   → site_start_min
--     entry.site.end/endNextDay       → site_end_min
--     entry.office.start/end          → office_start_min / office_end_min
--     entry.lunchTaken (기본 true)    → lunch_taken
--   (DB 전용)
--     claim_status : trip_claims.status 사본. 부분 UNIQUE 인덱스에 쓰려고 복제 (트리거로 동기화)
--     is_removed   : 초안 수정으로 빠진 날. 계산 결과(수정 불가)가 이 행을 참조하므로 물리 삭제 대신 표시
--
-- UNIQUE(직원, 근무일): 진행 중 상태(ACTIVE_STATUSES = draft/submitted/returned/approved)이고
--   빠지지 않은 날끼리만. 취소·반려된 건과는 겹쳐도 된다.
create table public.trip_claim_days (
  id               uuid primary key default gen_random_uuid(),
  claim_id         uuid not null references public.trip_claims(id) on delete restrict,
  employee_id      uuid not null references public.employees(id) on delete restrict,
  work_date        date not null,
  entry            jsonb not null,
  revision         integer not null default 1 check (revision >= 1),
  site_start_min   integer check (site_start_min   between 0 and 2880),
  site_end_min     integer check (site_end_min     between 0 and 2880),
  office_start_min integer check (office_start_min between 0 and 2880),
  office_end_min   integer check (office_end_min   between 0 and 2880),
  lunch_taken      boolean not null default true,
  claim_status     text not null,
  is_removed       boolean not null default false,
  removed_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (jsonb_typeof(entry) = 'object'),
  check ((entry ->> 'date')::date = work_date),       -- DayEntry.date 와 칼럼 일치
  check (is_removed = (removed_at is not null))
);

create unique index uq_trip_claim_days_claim_date
  on public.trip_claim_days(claim_id, work_date)
  where not is_removed;

create unique index uq_trip_claim_days_employee_date_active
  on public.trip_claim_days(employee_id, work_date)
  where not is_removed and claim_status in ('draft', 'submitted', 'returned', 'approved');

create index idx_trip_claim_days_claim on public.trip_claim_days(claim_id);

create trigger trip_claim_days_updated_at
  before update on public.trip_claim_days
  for each row execute function public.trip_touch_updated_at();

-- 근무일 INSERT 시: 직원 일치 검사 + claim_status 를 신청 상태에서 복사
create or replace function public.trip_claim_days_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_claim public.trip_claims;
begin
  select * into v_claim from public.trip_claims where id = new.claim_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = '신청을 찾을 수 없습니다';
  end if;
  if new.employee_id <> v_claim.employee_id then
    raise exception 'EMPLOYEE_MISMATCH' using detail = '근무일의 직원과 신청의 직원이 다릅니다';
  end if;
  if new.work_date < v_claim.start_date or new.work_date > v_claim.end_date then
    raise exception 'DATE_OUT_OF_SCHEDULE' using detail = format('%s은 출장 일정 밖의 날짜입니다', new.work_date);
  end if;
  new.claim_status := v_claim.status;
  return new;
end;
$$;

create trigger trip_claim_days_before_insert
  before insert on public.trip_claim_days
  for each row execute function public.trip_claim_days_before_insert();

-- 끝난 신청(approved / rejected / cancelled)의 근무일은 바꿀 수 없다 (보안검토 2-4, 계약 2-1).
--   입력(entry)·revision·시각 칼럼은 물론 is_removed / removed_at 변경도 막는다.
--   예외: 신청 상태 사본(claim_status) 동기화만 하는 UPDATE.
--     trip_claims_sync_day_status(AFTER UPDATE) 가 승인·반려·취소 순간에 claim_status 를 바꾸므로
--     이 예외가 없으면 승인 자체가 LOCKED 로 실패한다. updated_at 은 공통 트리거가 바꾸므로 비교에서 뺀다.
--   RPC(040)도 상태를 검사하지만, 테이블 수준에서 한 번 더 막는다 (SECURITY DEFINER·service_role 포함).
create or replace function public.trip_claim_days_lock_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.trip_claims where id = old.claim_id;
  if v_status in ('approved', 'rejected', 'cancelled') then
    if (to_jsonb(new) - 'claim_status' - 'updated_at') = (to_jsonb(old) - 'claim_status' - 'updated_at')
       and new.claim_status = v_status then
      return new;
    end if;
    raise exception 'LOCKED'
      using detail = format('승인·반려·취소된 신청(%s)의 근무일은 바꿀 수 없습니다', v_status);
  end if;
  return new;
end;
$$;

create trigger trip_claim_days_lock
  before update on public.trip_claim_days
  for each row execute function public.trip_claim_days_lock_guard();

-- 신청 상태가 바뀌면 근무일 사본(claim_status)도 바꾼다.
-- 취소·반려로 바뀌면 그 날짜들이 부분 UNIQUE 대상에서 빠진다.
create or replace function public.trip_claims_sync_day_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    update public.trip_claim_days set claim_status = new.status where claim_id = new.id;
  end if;
  return new;
end;
$$;

create trigger trip_claims_sync_day_status
  after update of status on public.trip_claims
  for each row execute function public.trip_claims_sync_day_status();

-- ============================================================
-- 6. trip_actual_times — 실제 출발·도착 (기록 전용, 계산에 쓰지 않음)
-- ============================================================
-- 매핑: DayEntry.actual { departAt?, arriveAt?, arriveNextDay?, source } → depart_min / arrive_min / source
--   arriveNextDay = true 면 arrive_min 에 1440 을 더한다 (근무일 0시 기준 분, 040 _trip_record_actual).
--   types.ts 에서는 entry jsonb 안에 함께 있다. 이 테이블은 3년 보관·법정 검증용 정규화 사본이며
--   RPC 가 entry.actual 에서 채운다. 원본은 여전히 trip_claim_days.entry.
--   자정 넘긴 도착: types.ts 의 actual.arriveNextDay 로 표현 → arrive_min 0~2879 허용 (다음 날 23:59 까지).
--   출발(departAt)에는 다음 날 표시가 없으므로 depart_min 은 0~1439 그대로.
--   [미확인] arriveAt = '24:00' + arriveNextDay = true 는 2880 이 되어 CHECK 위반으로 저장이 실패한다
--            (화면이 '다음 날 24:00' 을 '다다음 날 00:00' 으로 받지 않는 한 생기지 않는 값).
--   표준 이동시간을 이 테이블에 넣지 않는다. 빈 값(null)은 "기록 없음/기억 안 남".
--   HANDOFF 5-1 의 'Q-외부'(채널톡 참고 표시)는 자동 입력이 아니므로 source='external' 은 관리자 확인 전제.
create table public.trip_actual_times (
  id           uuid primary key default gen_random_uuid(),
  day_id       uuid not null references public.trip_claim_days(id) on delete restrict,
  day_revision integer not null,
  depart_min   integer check (depart_min between 0 and 1439),
  arrive_min   integer check (arrive_min between 0 and 2879),
  source       text not null check (source in ('self', 'companion_copy', 'admin', 'external')),
  recorded_by  uuid not null references public.employees(id) on delete restrict,
  recorded_at  timestamptz not null default now(),
  unique (day_id, day_revision)
);
-- 근무일 revision 마다 1행. 이전 기록은 지우지 않는다 (변경 이력 겸용).

-- ============================================================
-- 7. trip_day_calcs — 계산 결과. types.ts TripCalcRecord. INSERT 만 허용
-- ============================================================
-- 매핑 (TripCalcRecord → 칼럼)
--   id              → id
--   claimId         → claim_id
--   dayId           → day_id
--   dayRevision     → day_revision
--   ruleVersion     → rule_version (FK trip_rule_versions)
--   classification  → classification (jsonb: workType, dayKind, position, missing, notices)
--   engineInput     → engine_input (jsonb, null 가능)
--   result          → result (jsonb: TripDayResult | TripDayError | null)
--   carryOut        → carry_out (jsonb)
--   carryIn         → carry_in (jsonb)
--   computedAt      → computed_at
--   (DB 전용)
--     seq            : 같은 근무일의 "최신 계산" 판정용 단조 증가 번호 (repository.latestCalc 의 삽입 순서 대응)
--     entry_snapshot : 계산 당시 근무일 입력 사본. 클라이언트가 아니라 RPC 가 trip_claim_days.entry 에서 복사
--     computed_by, engine_source : 누가 어디서 계산했는지
--       'server' = Vercel Function(api/trip-compute.ts)이 DB 입력으로 계산 (v2 기본)
--       'edge'   = Supabase Edge Function (대안, 이번 구현은 쓰지 않음)
--       'client'(브라우저 엔진)는 CHECK 로 불허. 기본값도 없앴다 → 저장 RPC 가 반드시 명시해야 함
--     result_ok, missing_count, review_codes : 승인 검사용 사본 (RPC 가 result/classification 에서 계산)
--     4그룹 수치 (HANDOFF 6절, 서로 옮기지 않음) — result.ok = true 일 때만 값, 단위는 시간(numeric)
--       1그룹 trip_hours, trip_night_travel_hours
--       2그룹 overtime_hours, overtime_night_hours
--       휴일 holiday_within8_hours, holiday_over8_hours (평일·토요일 null)
--       3그룹 legal_total_work_hours, legal_daily_over8_hours, legal_basis ('standard_travel' | 'actual')
--       4그룹 actual_night_work_hours
--     값별 상태 (result.valueStatus / status) : 'confirmed' | 'proposed'
--     proposed_by text[]  : result.proposedBy (값을 제안값으로 만든 미확정 규칙)
--     requires_legal_review text[] : result.requiresLegalReview
create table public.trip_day_calcs (
  id                       uuid primary key default gen_random_uuid(),
  seq                      bigint generated always as identity,
  claim_id                 uuid not null references public.trip_claims(id) on delete restrict,
  day_id                   uuid not null references public.trip_claim_days(id) on delete restrict,
  day_revision             integer not null,
  rule_version             text not null references public.trip_rule_versions(version) on delete restrict,
  entry_snapshot           jsonb not null,
  classification           jsonb not null,
  engine_input             jsonb,
  result                   jsonb,
  carry_out                jsonb,
  carry_in                 jsonb,
  result_ok                boolean not null default false,
  missing_count            integer not null default 0,
  review_codes             text[] not null default '{}',
  value_status             text check (value_status in ('confirmed', 'proposed')),
  trip_status              text check (trip_status in ('confirmed', 'proposed')),
  night_travel_status      text check (night_travel_status in ('confirmed', 'proposed')),
  overtime_status          text check (overtime_status in ('confirmed', 'proposed')),
  night_overtime_status    text check (night_overtime_status in ('confirmed', 'proposed')),
  trip_hours               numeric(5,2),
  trip_night_travel_hours  numeric(5,2),
  overtime_hours           numeric(5,2),
  overtime_night_hours     numeric(5,2),
  holiday_within8_hours    numeric(5,2),
  holiday_over8_hours      numeric(5,2),
  legal_total_work_hours   numeric(5,2),
  legal_daily_over8_hours  numeric(5,2),
  legal_basis              text check (legal_basis in ('standard_travel', 'actual')),
  actual_night_work_hours  numeric(5,2),
  proposed_by              text[] not null default '{}',
  requires_legal_review    text[] not null default '{}',
  engine_source            text not null check (engine_source in ('server', 'edge')),
  computed_by              uuid not null references public.employees(id) on delete restrict,
  computed_at              timestamptz not null default now(),
  unique (seq),
  check (result_ok = false or result is not null),
  -- 수치 방어선 (보안검토 2-3, 계약 2-1). null 은 CHECK 를 통과한다 (result_ok = false 인 행)
  check (missing_count >= 0),
  check (trip_hours              between 0 and 8),    -- 표준 편도 최대 4h × 왕복
  check (trip_night_travel_hours >= 0),
  check (overtime_hours          between 0 and 24),
  check (overtime_night_hours    >= 0),
  check (holiday_within8_hours   between 0 and 24),
  check (holiday_over8_hours     between 0 and 24),
  check (legal_total_work_hours  >= 0),
  check (legal_daily_over8_hours >= 0),
  check (actual_night_work_hours >= 0)
);

create index idx_trip_day_calcs_day_seq on public.trip_day_calcs(day_id, seq desc);
create index idx_trip_day_calcs_claim   on public.trip_day_calcs(claim_id);

-- 수정·삭제 금지 (누구도. SECURITY DEFINER RPC·service_role 포함)
create or replace function public.trip_day_calcs_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'IMMUTABLE' using detail = '계산 결과는 수정·삭제할 수 없습니다. 다시 계산하면 새 행을 만드세요';
end;
$$;

create trigger trip_day_calcs_no_update
  before update on public.trip_day_calcs
  for each row execute function public.trip_day_calcs_immutable();

create trigger trip_day_calcs_no_delete
  before delete on public.trip_day_calcs
  for each row execute function public.trip_day_calcs_immutable();

create trigger trip_day_calcs_no_truncate
  before truncate on public.trip_day_calcs
  for each statement execute function public.trip_day_calcs_immutable();

-- 규칙 버전 보호 트리거 (1절 함수)
create trigger trip_rule_versions_guard
  before update or delete on public.trip_rule_versions
  for each row execute function public.trip_rule_versions_guard();

-- ============================================================
-- 8. trip_adjustments — 관리자 수정 이력. types.ts TripAdjustmentRecord
-- ============================================================
-- 매핑: id → id, dayId → day_id, claimId → claim_id, adminId → admin_id,
--       before → before_entry, after → after_entry, reason → reason, at → created_at
--   (DB 전용) from_revision / to_revision : 수정 전후 근무일 revision
--   K4(원본 덮어쓰기) 재발 방지: 수정할 때마다 새 행. 수정·삭제 금지 (트리거).
create table public.trip_adjustments (
  id             uuid primary key default gen_random_uuid(),
  day_id         uuid not null references public.trip_claim_days(id) on delete restrict,
  claim_id       uuid not null references public.trip_claims(id) on delete restrict,
  admin_id       uuid not null references public.employees(id) on delete restrict,
  before_entry   jsonb not null,
  after_entry    jsonb not null,
  from_revision  integer not null,
  to_revision    integer not null,
  reason         text not null check (length(btrim(reason)) > 0),
  created_at     timestamptz not null default now(),
  check (to_revision = from_revision + 1)
);

create index idx_trip_adjustments_claim on public.trip_adjustments(claim_id);

-- ============================================================
-- 9. trip_reviews — 검토(승인·반려·되돌림). types.ts TripReviewRecord
-- ============================================================
-- 매핑: id → id, claimId → claim_id, adminId → admin_id, action → action,
--       calcIds → calc_ids (승인 당시 계산 결과 id 배열 보존), flagDecisions → flag_decisions (jsonb 원본),
--       reason → reason, at → created_at
--   (DB 전용) claim_version : 검토 시점 신청 version
--   uuid[] 요소에는 FK 를 걸 수 없음 → BEFORE INSERT 트리거로 존재·소속 검사 (아래, REVIEW_CALC_MISMATCH).
create table public.trip_reviews (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null references public.trip_claims(id) on delete restrict,
  admin_id        uuid not null references public.employees(id) on delete restrict,
  action          text not null check (action in ('approve', 'reject', 'return')),
  calc_ids        uuid[] not null,
  flag_decisions  jsonb not null default '[]'::jsonb,
  reason          text,
  claim_version   integer not null,
  created_at      timestamptz not null default now(),
  check (jsonb_typeof(flag_decisions) = 'array'),
  check (action = 'approve' or length(btrim(coalesce(reason, ''))) > 0),
  check (action <> 'approve' or cardinality(calc_ids) >= 1)
);

create index idx_trip_reviews_claim on public.trip_reviews(claim_id);

-- calc_ids 의 모든 원소가 같은 신청의 계산 결과인지 (보안검토 2-7, 계약 2-1)
--   다른 신청의 calc id 를 끼워 넣거나 없는 id 를 넣으면 거부.
create or replace function public.trip_reviews_calc_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from unnest(new.calc_ids) as x(calc_id)
    where not exists (
      select 1 from public.trip_day_calcs c
      where c.id = x.calc_id and c.claim_id = new.claim_id
    )
  ) then
    raise exception 'REVIEW_CALC_MISMATCH'
      using detail = '검토 기록의 계산 결과가 이 신청의 것이 아닙니다';
  end if;
  return new;
end;
$$;

create trigger trip_reviews_calc_guard
  before insert on public.trip_reviews
  for each row execute function public.trip_reviews_calc_guard();

-- ============================================================
-- 10. trip_review_flags — 확인 표시와 처리 결과
-- ============================================================
--   계산 결과가 저장될 때 review_codes(= service.ts reviewItems: 엔진 flags + NEXT_DAY_ENTRY_MISSING)
--   하나마다 'open' 행이 생긴다. 승인 시 FlagDecision(calcId, code, decision='acknowledged', note)으로 처리된다.
--   decision 은 지금 'acknowledged' 하나뿐 (types.ts). 확인해도 제안값은 제안값으로 남는다.
create table public.trip_review_flags (
  id          uuid primary key default gen_random_uuid(),
  calc_id     uuid not null references public.trip_day_calcs(id) on delete restrict,
  claim_id    uuid not null references public.trip_claims(id) on delete restrict,
  code        text not null,
  state       text not null default 'open' check (state in ('open', 'acknowledged')),
  note        text,
  review_id   uuid references public.trip_reviews(id) on delete restrict,
  decided_by  uuid references public.employees(id) on delete restrict,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (calc_id, code),
  check (
    (state = 'open' and review_id is null and decided_by is null and decided_at is null)
    or (state = 'acknowledged' and review_id is not null and decided_by is not null and decided_at is not null)
  )
);

create index idx_trip_review_flags_claim_open on public.trip_review_flags(claim_id) where state = 'open';

-- 이력 테이블(조정·검토)은 수정·삭제 금지. 확인 표시는 open → acknowledged 한 번만 허용.
create or replace function public.trip_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'IMMUTABLE' using detail = format('%s 는 이력 테이블이라 수정·삭제할 수 없습니다', tg_table_name);
end;
$$;

create trigger trip_adjustments_append_only
  before update or delete on public.trip_adjustments
  for each row execute function public.trip_append_only();

create trigger trip_reviews_append_only
  before update or delete on public.trip_reviews
  for each row execute function public.trip_append_only();

create or replace function public.trip_review_flags_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE' using detail = '확인 표시는 삭제할 수 없습니다';
  end if;
  if old.state <> 'open'
     or new.state <> 'acknowledged'
     or new.calc_id <> old.calc_id
     or new.claim_id <> old.claim_id
     or new.code <> old.code then
    raise exception 'IMMUTABLE' using detail = '확인 표시는 처리 결과만 한 번 기록할 수 있습니다';
  end if;
  return new;
end;
$$;

create trigger trip_review_flags_guard
  before update or delete on public.trip_review_flags
  for each row execute function public.trip_review_flags_guard();

-- ============================================================
-- 11. 최신 계산 결과 뷰 (근무일별 seq 최대 1건, 빠진 날 제외)
--     security_invoker: 조회하는 사람의 RLS 를 그대로 적용 (PostgreSQL 15+)
--     [미확인] 운영 Postgres 버전이 15 이상인지 → 대조-체크리스트 C-1
-- ============================================================
create view public.trip_latest_day_calcs
with (security_invoker = true)
as
select distinct on (c.day_id) c.*
from public.trip_day_calcs c
join public.trip_claim_days d on d.id = c.day_id and not d.is_removed
order by c.day_id, c.seq desc;

-- ============================================================
-- 12. 트리거 함수는 직접 호출할 일이 없다 — PUBLIC·anon·authenticated 실행 권한 회수 (012 의 목표 유지)
--     트리거 함수의 실행 권한은 트리거를 만들 때만 검사하므로 회수해도 트리거는 그대로 동작한다.
--     (Supabase 는 새 함수에 anon·authenticated 실행 권한을 자동 부여한다 — 회수하지 않으면 012 가 막은 상태가 다시 열린다)
-- ============================================================
revoke all on function public.trip_touch_updated_at()           from public, anon, authenticated;
revoke all on function public.trip_rule_versions_guard()        from public, anon, authenticated;
revoke all on function public.trip_claim_days_before_insert()   from public, anon, authenticated;
revoke all on function public.trip_claim_days_lock_guard()      from public, anon, authenticated;
revoke all on function public.trip_claims_sync_day_status()     from public, anon, authenticated;
revoke all on function public.trip_day_calcs_immutable()        from public, anon, authenticated;
revoke all on function public.trip_reviews_calc_guard()         from public, anon, authenticated;
revoke all on function public.trip_append_only()                from public, anon, authenticated;
revoke all on function public.trip_review_flags_guard()         from public, anon, authenticated;

-- ############################################################
-- ## 020_trip_feature_flags.sql (원본 그대로)
-- ############################################################
-- ⚠ 초안. 실행 금지. 근태관리 Supabase(wvwbaqyxztgcrkiacvql)는 일시정지 상태이며 재개·적용은 사용자 승인 후.
-- 적용 전 필수: 운영 스키마 읽기 전용 대조 (HANDOFF 9절), 롤백 SQL 검증, 스테이징 없음 → 트랜잭션 단위 적용.
-- ============================================================
-- 출장수당 020: 기능 활성화 서버 강제
--
-- 목적
--   화면에서 메뉴를 숨기는 것만으로는 부족하다(K6·S4: 화면에서만 강제한 규칙은 우회된다).
--   모든 출장 쓰기 RPC 는 첫 줄에서 trip_require_feature(key) 를 호출하고,
--   스위치가 꺼져 있으면 예외 FEATURE_DISABLED 로 거부한다.
--
-- 스위치
--   employee_form : 직원 신청 (작성·수정·제출·취소·동행 초안)
--   admin_review  : 관리자 수정·검토·승인
--   payroll_apply : 급여 반영. 이번 초안에서는 CHECK 제약으로 true 자체를 금지한다
--                   (service.ts PAYROLL_APPLICATION_ENABLED = false, C-0 노무 확인 전).
--                   켜려면 제약을 지우는 별도 마이그레이션 + 사용자 승인이 필요하다.
--
-- 켜고 끄기는 admin 만 trip_set_feature() 로 하며, 모든 변경은 trip_feature_flag_history 에 남는다.
-- ============================================================

create table public.trip_feature_flags (
  key         text primary key check (key in ('employee_form', 'admin_review', 'payroll_apply')),
  enabled     boolean not null default false,
  enabled_at  timestamptz,
  enabled_by  uuid references public.employees(id) on delete set null,
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  constraint trip_feature_flags_payroll_locked check (key <> 'payroll_apply' or enabled = false)
);

insert into public.trip_feature_flags (key, enabled, note) values
  ('employee_form', false, '직원 신청 화면·RPC'),
  ('admin_review',  false, '관리자 수정·검토·승인 RPC'),
  ('payroll_apply', false, '급여 반영 — C-0 노무 확인 전 고정 false (CHECK 제약)');

create table public.trip_feature_flag_history (
  id          uuid primary key default gen_random_uuid(),
  key         text not null references public.trip_feature_flags(key) on delete restrict,
  old_enabled boolean not null,
  new_enabled boolean not null,
  changed_by  uuid not null references public.employees(id) on delete restrict,
  note        text not null default '',
  changed_at  timestamptz not null default now()
);

create index idx_trip_feature_flag_history_key on public.trip_feature_flag_history(key, changed_at desc);

-- 이력은 수정·삭제 금지 (010 의 trip_append_only 재사용)
create trigger trip_feature_flag_history_append_only
  before update or delete on public.trip_feature_flag_history
  for each row execute function public.trip_append_only();

-- ------------------------------------------------------------
-- 조회: 스위치 상태. 없는 key 는 false (안전한 기본값)
-- ------------------------------------------------------------
create or replace function public.trip_feature_enabled(p_key text)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce((select enabled from public.trip_feature_flags where key = p_key), false)
$$;

-- ------------------------------------------------------------
-- 강제: 모든 쓰기 RPC 첫 줄에서 호출
-- ------------------------------------------------------------
create or replace function public.trip_require_feature(p_key text)
returns void
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if not public.trip_feature_enabled(p_key) then
    raise exception 'FEATURE_DISABLED'
      using detail = format('출장 기능(%s)이 아직 켜지지 않았습니다', p_key);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 변경: admin 만. 사유(note) 필수. 이력 기록
--   역할은 auth.uid() 로 employees 에서 직접 조회한다 (클라이언트가 보낸 역할을 믿지 않음).
--   [미확인] 20260916 권한 체계(admin_permissions)가 운영에 적용됐다면,
--            role='admin' 대신 is_permission_admin_user() 또는 새 세부권한 키('trip_manage')로
--            바꿀지 결정 필요. 기존 update_employee_admin 도 role 변경은 is_admin() 을 "최후의 보루"로 남겼으므로
--            초안은 role='admin' + is_active 를 기준으로 한다.
-- ------------------------------------------------------------
create or replace function public.trip_set_feature(p_key text, p_enabled boolean, p_note text)
returns public.trip_feature_flags
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_old  public.trip_feature_flags;
  v_new  public.trip_feature_flags;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using detail = '로그인이 필요합니다';
  end if;

  select role into v_role from public.employees where id = v_uid and is_active = true;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN' using detail = '대표(admin)만 출장 기능 스위치를 바꿀 수 있습니다';
  end if;

  if p_enabled is null then
    raise exception 'INVALID_ARGUMENT' using detail = 'p_enabled 가 필요합니다';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'REASON_REQUIRED' using detail = '변경 사유를 입력하세요';
  end if;
  if p_key = 'payroll_apply' and p_enabled then
    raise exception 'PAYROLL_LOCKED' using detail = '급여 반영은 노무 확인(C-0)과 별도 승인 전까지 켤 수 없습니다';
  end if;

  select * into v_old from public.trip_feature_flags where key = p_key for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = format('알 수 없는 기능 키: %s', p_key);
  end if;

  update public.trip_feature_flags
     set enabled    = p_enabled,
         enabled_at = case when p_enabled then now() else null end,
         enabled_by = case when p_enabled then v_uid else null end,
         note       = p_note,
         updated_at = now()
   where key = p_key
  returning * into v_new;

  insert into public.trip_feature_flag_history (key, old_enabled, new_enabled, changed_by, note)
  values (p_key, v_old.enabled, p_enabled, v_uid, p_note);

  return v_new;
end;
$$;

revoke all on function public.trip_feature_enabled(text)       from public, anon;
grant execute on function public.trip_feature_enabled(text)    to authenticated;
-- v2: 서버 계산 함수(api/trip-compute.ts, service_role)가 rpc('trip_feature_enabled') 로 스위치를 읽는다 (계약 3절).
--   [미확인] Supabase 기본 권한으로 service_role 에 이미 EXECUTE 가 있을 수 있으나 명시해 둔다 (C-8).
grant execute on function public.trip_feature_enabled(text)    to service_role;
-- trip_require_feature 는 RPC 내부 전용. 클라이언트 직접 호출 불필요
revoke all on function public.trip_require_feature(text)       from public, anon, authenticated;
revoke all on function public.trip_set_feature(text, boolean, text) from public, anon;
grant execute on function public.trip_set_feature(text, boolean, text) to authenticated;


-- ============================================================
-- 전체 출장 내역 조회 권한 지정 (2026-11-03 추가)
--   admin 이 회사 직급이 '팀장' 인 직원을 골라 "전체 출장 내역 조회" 를 부여·회수한다. 기본값: 아무도 없음.
--   - 부여 대상 = employees.is_active and employees.position = '팀장' and role <> 'admin' (11-03 최종, 005 칼럼).
--     시스템 역할(employee/manager)은 보지 않는다 — manager 는 '인사담당' 이지 팀장이 아니다. admin 은 이미 전부 보므로 제외.
--     자동 부여는 없다: 팀장이라도 admin 이 명시적으로 켜기 전에는 본인 건만 본다.
--   - 관리자 화면의 후보 목록은 trip_view_grant_candidates() 가 같은 판정 함수로 돌려주므로 화면과 DB 가 어긋나지 않는다.
--   - 부여되는 것은 SELECT(030 의 *_select_admin 정책이 trip_can_view_all() 을 통해 허용)뿐.
--     수정·승인·반려·급여 반영 RPC 는 040 이 role='admin' 만 받으므로 그대로 막힌다.
--   - 직급 변경·퇴사·비활성화·admin 승격 시: employees 의 트리거 trip_view_grant_guard 가 권한 행을 지우고
--     이력에 auto_revoke 를 남긴다 (즉시 무효). 다시 팀장이 돼도 복원되지 않는다 — admin 이 새로 부여해야 한다.
--     트리거가 없더라도 trip_has_view_grant() 가 유효성을 다시 보므로 행이 남아도 조회는 막힌다 (이중 방어).
--   - 기능 스위치 admin_review 가 꺼져 있으면 정책 조건에서 막힌다 (권한이 있어도 0행).
--   - 모든 변경은 trip_view_grant_history 에 남는다 (누가·언제·왜).
-- ============================================================
create table public.trip_view_grants (
  employee_id  uuid primary key references public.employees(id) on delete cascade,
  granted_by   uuid not null references public.employees(id) on delete restrict,
  granted_at   timestamptz not null default now(),
  note         text not null default ''
);

create table public.trip_view_grant_history (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete restrict,
  action       text not null check (action in ('grant', 'revoke', 'auto_revoke')),
  -- auto_revoke 는 트리거가 남긴다. SQL Editor 등 세션 사용자가 없는 경로면 null
  changed_by   uuid references public.employees(id) on delete restrict,
  note         text not null default '',
  changed_at   timestamptz not null default now()
);

create index idx_trip_view_grant_history_emp on public.trip_view_grant_history(employee_id, changed_at desc);

create trigger trip_view_grant_history_append_only
  before update or delete on public.trip_view_grant_history
  for each row execute function public.trip_append_only();

-- 부여 대상인가: 활성이고 회사 직급이 '팀장' 이며 admin 이 아닌 직원 (005 employees.position).
-- 유일한 판정 지점 — RPC(부여)·RLS(유효성)·관리자 화면(후보)·트리거(자동 회수) 모두 여기를 쓴다
create or replace function public.trip_view_grant_eligible(p_employee uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee and e.is_active = true and e.position = '팀장' and e.role <> 'admin'
  )
$$;

-- 지금 로그인한 사람에게 유효한 조회 권한이 있는가 (행이 있어도 비활성·직급 변경·admin 이면 false)
create or replace function public.trip_has_view_grant()
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.trip_view_grants g
    where g.employee_id = auth.uid() and public.trip_view_grant_eligible(g.employee_id)
  )
$$;

-- 관리자 화면의 부여 후보 (admin 만). trip_view_grant_eligible() 과 같은 판정으로 id 만 돌려준다
create or replace function public.trip_view_grant_candidates()
returns table (employee_id uuid)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using detail = '로그인이 필요합니다';
  end if;
  if not exists (select 1 from public.employees where id = auth.uid() and role = 'admin' and is_active = true) then
    raise exception 'FORBIDDEN' using detail = '대표(admin)만 조회 권한 후보를 볼 수 있습니다';
  end if;
  return query
    select e.id from public.employees e
    where public.trip_view_grant_eligible(e.id)
    order by e.name, e.id;
end;
$$;

-- 부여·회수 (admin 만). 반환: { employeeId, enabled, changed }
create or replace function public.trip_set_view_grant(p_employee_id uuid, p_enabled boolean, p_note text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_changed boolean := false;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using detail = '로그인이 필요합니다';
  end if;
  select role into v_role from public.employees where id = v_uid and is_active = true;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN' using detail = '대표(admin)만 출장 조회 권한을 바꿀 수 있습니다';
  end if;
  if p_employee_id is null or p_enabled is null then
    raise exception 'INVALID_ARGUMENT' using detail = '직원과 부여 여부가 필요합니다';
  end if;
  if p_employee_id = v_uid then
    raise exception 'INVALID_ARGUMENT' using detail = '본인에게는 부여할 수 없습니다 (admin 은 이미 전체를 봅니다)';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'REASON_REQUIRED' using detail = '부여·회수 사유를 입력하세요';
  end if;

  if p_enabled then
    if not public.trip_view_grant_eligible(p_employee_id) then
      raise exception 'NOT_ELIGIBLE' using detail = '부여 대상이 아닙니다 (활성이고 회사 직급이 팀장인 직원만, admin 제외)';
    end if;
    insert into public.trip_view_grants (employee_id, granted_by, note)
    values (p_employee_id, v_uid, btrim(p_note))
    on conflict (employee_id) do nothing;
    v_changed := found;
    if v_changed then
      insert into public.trip_view_grant_history (employee_id, action, changed_by, note)
      values (p_employee_id, 'grant', v_uid, btrim(p_note));
    end if;
  else
    delete from public.trip_view_grants where employee_id = p_employee_id;
    v_changed := found;
    if v_changed then
      insert into public.trip_view_grant_history (employee_id, action, changed_by, note)
      values (p_employee_id, 'revoke', v_uid, btrim(p_note));
    end if;
  end if;

  return jsonb_build_object('employeeId', p_employee_id, 'enabled', p_enabled, 'changed', v_changed);
end;
$$;

revoke all on function public.trip_view_grant_eligible(uuid)             from public, anon;
grant execute on function public.trip_view_grant_eligible(uuid)          to authenticated;
revoke all on function public.trip_has_view_grant()                      from public, anon;
grant execute on function public.trip_has_view_grant()                   to authenticated;
revoke all on function public.trip_view_grant_candidates()               from public, anon;
grant execute on function public.trip_view_grant_candidates()            to authenticated;

-- 자동 회수: 직급·활성·역할이 바뀌어 후보가 아니게 되면 권한 행을 지우고 이력을 남긴다 (기존 표 employees 의 유일한 출장 트리거, 900 이 지운다)
create or replace function public.trip_employee_grant_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.trip_view_grants where employee_id = new.id)
     and not public.trip_view_grant_eligible(new.id) then
    delete from public.trip_view_grants where employee_id = new.id;
    insert into public.trip_view_grant_history (employee_id, action, changed_by, note)
    values (new.id, 'auto_revoke', auth.uid(),
            format('직급·상태 변경으로 자동 회수 (직급 %s → %s, 활성 %s → %s, 역할 %s → %s)',
                   coalesce(old.position, '미지정'), coalesce(new.position, '미지정'), old.is_active, new.is_active, old.role, new.role));
  end if;
  return new;
end;
$$;
revoke all on function public.trip_employee_grant_guard() from public, anon, authenticated;

drop trigger if exists trip_view_grant_guard on public.employees;
create trigger trip_view_grant_guard
  after update of position, is_active, role on public.employees
  for each row
  when (old.position is distinct from new.position or old.is_active is distinct from new.is_active or old.role is distinct from new.role)
  execute function public.trip_employee_grant_guard();
revoke all on function public.trip_set_view_grant(uuid, boolean, text)   from public, anon;
grant execute on function public.trip_set_view_grant(uuid, boolean, text) to authenticated;

-- ############################################################
-- ## 030_trip_rls.sql (원본 그대로)
-- ############################################################
-- ⚠ 초안. 실행 금지. 근태관리 Supabase(wvwbaqyxztgcrkiacvql)는 일시정지 상태이며 재개·적용은 사용자 승인 후.
-- 적용 전 필수: 운영 스키마 읽기 전용 대조 (HANDOFF 9절), 롤백 SQL 검증, 스테이징 없음 → 트랜잭션 단위 적용.
-- ============================================================
-- 출장수당 030: RLS
--
-- 원칙
--   - 직원: 본인 행 SELECT 만.
--   - 관리자(admin): SELECT 전체. manager 는 출장 기능에서 직원과 같다 (본인 건만) — 11-03 사용자 기준.
--   - admin 이 trip_set_view_grant() 로 지정한 직원(팀장): SELECT 전체만 (020 trip_view_grants). 쓰기·승인은 여전히 admin 만.
--   - INSERT/UPDATE/DELETE 정책은 하나도 만들지 않는다 → 클라이언트 직접 쓰기는 RLS 가 항상 거부.
--     모든 쓰기는 040 의 SECURITY DEFINER RPC 로만 한다 (K6·S4 재발 방지).
--   - 추가 방어: anon·authenticated 의 테이블 쓰기 권한(GRANT)도 회수한다.
--   - trip_day_calcs 는 트리거(010)로 누구도 UPDATE/DELETE 불가. 정책도 없음.
--   - 기존 테이블의 정책은 하나도 건드리지 않는다.
--   - v2: 출장 데이터 테이블 7개(claims, claim_days, actual_times, day_calcs, adjustments,
--     reviews, review_flags)의 SELECT 정책에 기능 스위치 조건을 붙인다 (보안검토 2-5, 계약 2-3).
--       직원 정책   … and trip_feature_enabled('employee_form')
--       관리자 정책 … and trip_feature_enabled('admin_review')
--     스위치가 꺼지면 RPC 뿐 아니라 조회도 0행이다. trip_latest_day_calcs 뷰는 security_invoker 라 같이 걸린다.
--     기준 데이터(rule_versions, regions, holidays, feature_flags)와 스위치 변경 이력은 조건 없이 둔다
--     (화면이 스위치 상태를 읽어야 하고, 관리자는 꺼진 상태에서도 변경 이력을 봐야 하므로).
--   - service_role(Vercel Function)은 RLS 를 우회한다. 계산 저장 trip_store_server_calcs 는 040 에서
--     권한(service_role 전용)과 함수 안 검사로 막는다.
--
-- 관리자 판정은 trip_can_view_all() 한 곳에 모은다.
--   11-03: employees.role = 'admin' 이고 활성인 사람만. 기존 is_manager_or_admin() 은 쓰지 않는다
--   (manager 에게 전체 조회가 열리고, 기존 함수 정의에 의존하게 되므로). 040 의 _trip_actor_role 과 같은 기준.
--   운영 대조(11-03, 읽기 전용): 20260916 권한 체계(admin_permissions·has_admin_permission)는 운영에 없음 → role 기준 확정.
--   권한 체계가 나중에 적용되면 이 함수 본문만 has_admin_permission('trip_view') 로 바꾼다.
-- ============================================================

-- admin 인가 (활성). 스위치 이력·조회 권한 표처럼 "관리자만" 인 곳에 쓴다
create or replace function public.trip_is_admin()
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.id = auth.uid() and e.role = 'admin' and e.is_active = true
  )
  -- 대안 (20260916 권한 체계 적용 시): select public.has_admin_permission('trip_view')
$$;

-- 전체 출장 내역을 볼 수 있는가: admin, 또는 admin 이 지정한 직원(020 trip_has_view_grant)
create or replace function public.trip_can_view_all()
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.trip_is_admin() or public.trip_has_view_grant()
$$;

revoke all on function public.trip_is_admin() from public, anon;
grant execute on function public.trip_is_admin() to authenticated;
revoke all on function public.trip_can_view_all() from public, anon;
grant execute on function public.trip_can_view_all() to authenticated;

-- ------------------------------------------------------------
-- RLS 활성화
-- ------------------------------------------------------------
alter table public.trip_rule_versions         enable row level security;
alter table public.trip_regions               enable row level security;
alter table public.holidays                   enable row level security;
alter table public.trip_claims                enable row level security;
alter table public.trip_claim_days            enable row level security;
alter table public.trip_actual_times          enable row level security;
alter table public.trip_day_calcs             enable row level security;
alter table public.trip_adjustments           enable row level security;
alter table public.trip_reviews               enable row level security;
alter table public.trip_review_flags          enable row level security;
alter table public.trip_feature_flags         enable row level security;
alter table public.trip_feature_flag_history  enable row level security;
alter table public.trip_view_grants           enable row level security;
alter table public.trip_view_grant_history    enable row level security;

-- ------------------------------------------------------------
-- 직접 쓰기 권한 회수 (RLS 와 이중 방어). SELECT 권한은 RLS 정책으로 거른다.
-- Supabase 기본값은 public 스키마 새 테이블에 anon/authenticated 전체 권한을 준다.
-- ------------------------------------------------------------
revoke all on table
  public.trip_rule_versions, public.trip_regions, public.holidays,
  public.trip_claims, public.trip_claim_days, public.trip_actual_times,
  public.trip_day_calcs, public.trip_adjustments, public.trip_reviews, public.trip_review_flags,
  public.trip_feature_flags, public.trip_feature_flag_history,
  public.trip_view_grants, public.trip_view_grant_history
from anon, authenticated;

grant select on table
  public.trip_rule_versions, public.trip_regions, public.holidays,
  public.trip_claims, public.trip_claim_days, public.trip_actual_times,
  public.trip_day_calcs, public.trip_adjustments, public.trip_reviews, public.trip_review_flags,
  public.trip_feature_flags, public.trip_feature_flag_history,
  public.trip_view_grants, public.trip_view_grant_history
to authenticated;

revoke all on public.trip_latest_day_calcs from anon, authenticated;
grant select on public.trip_latest_day_calcs to authenticated;

-- ============================================================
-- 기준 데이터: 로그인한 사람 모두 조회 (미리보기 엔진이 써야 함)
-- ============================================================
create policy "trip_rule_versions_select_authenticated"
  on public.trip_rule_versions for select to authenticated
  using (true);

create policy "trip_regions_select_authenticated"
  on public.trip_regions for select to authenticated
  using (true);

create policy "holidays_select_authenticated"
  on public.holidays for select to authenticated
  using (true);

create policy "trip_feature_flags_select_authenticated"
  on public.trip_feature_flags for select to authenticated
  using (true);

-- 스위치 변경 이력: admin 만 (조회 권한자 제외)
create policy "trip_feature_flag_history_select_admin"
  on public.trip_feature_flag_history for select to authenticated
  using (public.trip_is_admin());

-- 조회 권한 지정: 본인 행(메뉴 표시용, 유효할 때만 = 활성 manager) + admin 전체. 이력은 admin 만. 쓰기 정책 없음 (trip_set_view_grant 로만)
create policy "trip_view_grants_select_self"
  on public.trip_view_grants for select to authenticated
  using (employee_id = auth.uid() and public.trip_view_grant_eligible(auth.uid()));

create policy "trip_view_grants_select_admin"
  on public.trip_view_grants for select to authenticated
  using (public.trip_is_admin());

create policy "trip_view_grant_history_select_admin"
  on public.trip_view_grant_history for select to authenticated
  using (public.trip_is_admin());

-- ============================================================
-- trip_claims
-- ============================================================
create policy "trip_claims_select_self"
  on public.trip_claims for select to authenticated
  using (employee_id = auth.uid() and public.trip_feature_enabled('employee_form'));

create policy "trip_claims_select_admin"
  on public.trip_claims for select to authenticated
  using (public.trip_can_view_all() and public.trip_feature_enabled('admin_review'));

-- [미결정] 동행자끼리 서로의 건을 볼 수 있게 할지 (initiator 가 동행 초안 진행 상황을 보는 기능).
--          초안은 본인 건만. 필요하면 RPC 로 "제출 여부"만 돌려주는 방식을 권장 (시각·점심 등 개인 입력 비공개).

-- ============================================================
-- trip_claim_days
-- ============================================================
create policy "trip_claim_days_select_self"
  on public.trip_claim_days for select to authenticated
  using (employee_id = auth.uid() and public.trip_feature_enabled('employee_form'));

create policy "trip_claim_days_select_admin"
  on public.trip_claim_days for select to authenticated
  using (public.trip_can_view_all() and public.trip_feature_enabled('admin_review'));

-- ============================================================
-- trip_actual_times (근무일 → 직원)
-- ============================================================
create policy "trip_actual_times_select_self"
  on public.trip_actual_times for select to authenticated
  using (
    public.trip_feature_enabled('employee_form')
    and exists (
      select 1 from public.trip_claim_days d
      where d.id = trip_actual_times.day_id and d.employee_id = auth.uid()
    )
  );

create policy "trip_actual_times_select_admin"
  on public.trip_actual_times for select to authenticated
  using (public.trip_can_view_all() and public.trip_feature_enabled('admin_review'));

-- ============================================================
-- trip_day_calcs (신청 → 직원). UPDATE/DELETE 정책 없음 + 트리거로 금지
-- ============================================================
create policy "trip_day_calcs_select_self"
  on public.trip_day_calcs for select to authenticated
  using (
    public.trip_feature_enabled('employee_form')
    and exists (
      select 1 from public.trip_claims c
      where c.id = trip_day_calcs.claim_id and c.employee_id = auth.uid()
    )
  );

create policy "trip_day_calcs_select_admin"
  on public.trip_day_calcs for select to authenticated
  using (public.trip_can_view_all() and public.trip_feature_enabled('admin_review'));

-- ============================================================
-- trip_adjustments — 직원도 본인 건 수정 이력은 볼 수 있다 (무엇이 왜 바뀌었는지)
-- ============================================================
create policy "trip_adjustments_select_self"
  on public.trip_adjustments for select to authenticated
  using (
    public.trip_feature_enabled('employee_form')
    and exists (
      select 1 from public.trip_claims c
      where c.id = trip_adjustments.claim_id and c.employee_id = auth.uid()
    )
  );

create policy "trip_adjustments_select_admin"
  on public.trip_adjustments for select to authenticated
  using (public.trip_can_view_all() and public.trip_feature_enabled('admin_review'));

-- ============================================================
-- trip_reviews — 직원도 본인 건 검토 결과(되돌림 사유 등)는 본다
-- ============================================================
create policy "trip_reviews_select_self"
  on public.trip_reviews for select to authenticated
  using (
    public.trip_feature_enabled('employee_form')
    and exists (
      select 1 from public.trip_claims c
      where c.id = trip_reviews.claim_id and c.employee_id = auth.uid()
    )
  );

create policy "trip_reviews_select_admin"
  on public.trip_reviews for select to authenticated
  using (public.trip_can_view_all() and public.trip_feature_enabled('admin_review'));

-- ============================================================
-- trip_review_flags
-- ============================================================
create policy "trip_review_flags_select_self"
  on public.trip_review_flags for select to authenticated
  using (
    public.trip_feature_enabled('employee_form')
    and exists (
      select 1 from public.trip_claims c
      where c.id = trip_review_flags.claim_id and c.employee_id = auth.uid()
    )
  );

create policy "trip_review_flags_select_admin"
  on public.trip_review_flags for select to authenticated
  using (public.trip_can_view_all() and public.trip_feature_enabled('admin_review'));

-- 의도적으로 만들지 않은 것 (점검용 메모)
--   - 모든 trip_* 테이블의 insert/update/delete 정책
--   - holidays 쓰기 정책: 공휴일 등록·검증 RPC 는 후속 단계 (출처·검증자 필수 입력 RPC 로 만들 것)
--   - trip_regions / trip_rule_versions 쓰기 정책: 규칙 변경은 마이그레이션으로만

-- ############################################################
-- ## 040_trip_rpc.sql (원본 그대로)
-- ############################################################
-- ⚠ 초안. 실행 금지. 근태관리 Supabase(wvwbaqyxztgcrkiacvql)는 일시정지 상태이며 재개·적용은 사용자 승인 후.
-- 적용 전 필수: 운영 스키마 읽기 전용 대조 (HANDOFF 9절), 롤백 SQL 검증, 스테이징 없음 → 트랜잭션 단위 적용.
-- ============================================================
-- 출장수당 040: SECURITY DEFINER RPC
--
-- service.ts 의 업무 규칙을 서버에서 똑같이 강제한다.
--   - 본인 건만 작성·수정·제출·취소 (관리자 대리 작성만 예외: input_route='proxy')
--   - 동시 수정: expected_version 불일치 → VERSION_CONFLICT
--   - 관리자 수정: 사유 필수(REASON_REQUIRED), 원본·이력 보존(trip_adjustments)
--   - 검토: 본인 건 금지(SELF_REVIEW), 화면에 보였던 계산 결과 id 집합에 고정(STALE_CALC),
--           미처리 확인 표시가 있으면 승인 불가(UNRESOLVED_FLAGS)
--   - 승인해도 제안값은 제안값 (trip_day_calcs 의 *_status 는 바뀌지 않음)
--   - 급여 반영 없음 (payroll_apply 스위치는 020 에서 false 고정, 이 파일은 급여 테이블을 건드리지 않음)
--
-- 모든 공개 RPC 의 첫 줄
--   (a) trip_require_feature('<key>')       → 꺼져 있으면 FEATURE_DISABLED
--   (b) _trip_actor_id() / employees.role    → auth.uid() 로 서버에서 조회. 클라이언트가 보낸 역할은 받지도 않음
--   (service_role 전용 trip_store_server_calcs 는 (b) 대신 호출 역할 검사 + p_computed_by 존재 검사)
--
-- 예외 형식: raise exception '<코드>' using detail = '<한국어 안내>'
--   PostgREST 응답의 message = 코드, details = 안내. 클라이언트는 service.ts 의 Result.code 와 같은 코드로 매핑.
--
-- 계산 결과는 서버가 다시 계산해 저장한다 (v2, 계약-서버계산.md · ../T5-보안검토_계산결과조작.md 권장안 B)
--   - 브라우저는 입력 원본(header, entries)만 보낸다. 공개 RPC 는 계산 결과(p_calcs)를 받지 않는다.
--     v1 의 _trip_store_calc / _trip_apply_calcs 는 삭제했다 (v1 백업: ../T5-DB-초안_v1_클라이언트계산_백업/).
--   - 계산은 Vercel Function api/trip-compute.ts 가 DB 에 저장된 입력으로 computeClaimDays
--     (src/features/trip/data/compute.ts)를 돌려 만들고, service_role 전용 RPC
--     trip_store_server_calcs 로만 저장한다. engine_source = 'server', entry_snapshot = DB 의 근무일 입력.
--   - anon / authenticated 는 trip_store_server_calcs 를 실행할 권한이 없다. 함수 안에서도 호출 역할을
--     다시 확인한다 (request.jwt.claims 의 role = 'service_role').
--   - 제출(trip_submit)·승인(trip_review approve)은 모든 진행 중 근무일의 최신 계산이
--     _trip_calc_is_current (server 계산 · 현재 revision · 현재 입력 · 활성 규칙 버전)일 때만 된다.
--     아니면 CALC_STALE_OR_UNTRUSTED → 화면은 /api/trip-compute 를 다시 부른 뒤 재시도한다.
--   - 저장 직전 방어선: 활성 규칙 버전 일치, 근무일 집합 완전성, 수치 범위, 지역 코드 유효성
--     (함수 검사 + 010 의 CHECK 제약 이중).
--   - 미리보기는 지금처럼 브라우저에서 같은 엔진으로 계산한다 (표시 전용, 저장되지 않음).
--
-- 흐름 (계약 1절)
--   직원  : trip_create_claim / trip_update_draft → POST /api/trip-compute → trip_submit
--   관리자: trip_admin_adjust_day → POST /api/trip-compute → trip_review
--
-- 승인 권한: 초안은 role='admin'(대표)만. service.ts 의 actor.role === 'admin' 과 같고,
--   CLAUDE.md "야근 승인/반려는 대표만" 관례와 같다.
--   [미결정] HANDOFF 5-2 의 "인사담당 1차 → 대표 최종" 2단계 경로 (K7). 결정되면 trip_reviews.action 에
--            'first_approve' 를 추가하는 별도 마이그레이션으로 처리.
-- ============================================================


-- ============================================================
-- 0. 내부 보조 함수 (클라이언트 실행 권한 없음 — 파일 끝에서 revoke)
-- ============================================================

-- 현재 사용자(직원) id. 로그인 안 했거나, 직원 등록이 없거나, 비활성이면 거부
create or replace function public._trip_actor_id()
returns uuid
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using detail = '로그인이 필요합니다';
  end if;
  if not exists (select 1 from public.employees where id = v_uid and is_active = true) then
    raise exception 'FORBIDDEN' using detail = '활성 직원만 사용할 수 있습니다';
  end if;
  return v_uid;
end;
$$;

create or replace function public._trip_actor_role(p_uid uuid)
returns text
language sql security definer stable
set search_path = public, pg_temp
as $$
  select role from public.employees where id = p_uid
$$;

-- 지역 코드가 그 날짜에 유효한지
create or replace function public._trip_region_valid(p_code text, p_date date)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.trip_regions
    where code = p_code
      and effective_from <= p_date
      and (effective_to is null or effective_to >= p_date)
  )
$$;

-- ClaimHeader 검증 + 조회용 칼럼 추출 (service.ts validateHeader)
create or replace function public._trip_parse_header(
  p_header jsonb,
  out o_regions text[],
  out o_kind text,
  out o_start date,
  out o_end date
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using detail = '출장 공통 입력이 없습니다';
  end if;
  if jsonb_typeof(p_header -> 'regions') is distinct from 'array'
     or jsonb_array_length(p_header -> 'regions') = 0 then
    raise exception 'REGION_REQUIRED' using detail = '지역을 고르세요';
  end if;
  o_regions := array(select jsonb_array_elements_text(p_header -> 'regions'));

  o_kind := p_header #>> '{schedule,kind}';
  begin
    if o_kind = 'day' then
      o_start := (p_header #>> '{schedule,date}')::date;
      o_end := o_start;
    elsif o_kind = 'stay' then
      o_start := (p_header #>> '{schedule,startDate}')::date;
      o_end := (p_header #>> '{schedule,endDate}')::date;
    end if;
  exception when others then
    raise exception 'INVALID_DATE' using detail = '날짜가 올바르지 않습니다';
  end;
  if o_kind is null or o_kind not in ('day', 'stay') or o_start is null or o_end is null then
    raise exception 'INVALID_DATE' using detail = '날짜가 올바르지 않습니다';
  end if;
  if o_kind = 'stay' and o_end <= o_start then
    raise exception 'INVALID_DATE' using detail = '숙박 출장은 끝나는 날이 시작일보다 뒤여야 합니다';
  end if;
  -- 숙박 기간 상한: service.ts MAX_STAY_DAYS = 31 (eachDate(start, end).length > 31 거부, 임시 상한)과 같게.
  --   날짜 개수 31일 = 끝날 - 시작일 차이 30일.
  if o_end - o_start > 30 then
    raise exception 'INVALID_DATE' using detail = '출장 기간이 너무 깁니다 (31일 이하)';
  end if;

  foreach v_code in array o_regions loop
    if not public._trip_region_valid(v_code, o_start) then
      raise exception 'INVALID_REGION' using detail = format('알 수 없는 지역입니다: %s', v_code);
    end if;
  end loop;
end;
$$;

-- DayEntry[] 검증 (service.ts validateEntries)
create or replace function public._trip_validate_entries(p_entries jsonb, p_start date, p_end date)
returns void
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_e    jsonb;
  v_date date;
  v_seen date[] := '{}';
  v_code text;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'NO_DAYS' using detail = '근무일을 하나 이상 입력하세요';
  end if;
  for v_e in select * from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_e) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using detail = '근무일 입력 형식이 올바르지 않습니다';
    end if;
    begin
      v_date := (v_e ->> 'date')::date;
    exception when others then
      raise exception 'INVALID_DATE' using detail = '날짜가 올바르지 않습니다';
    end;
    if v_date is null then
      raise exception 'INVALID_DATE' using detail = '날짜가 올바르지 않습니다';
    end if;
    if v_date < p_start or v_date > p_end then
      raise exception 'DATE_OUT_OF_SCHEDULE' using detail = format('%s은 출장 일정 밖의 날짜입니다', v_date);
    end if;
    if v_date = any(v_seen) then
      raise exception 'DUPLICATE_DATE' using detail = format('%s을 두 번 입력했습니다', v_date);
    end if;
    v_seen := v_seen || v_date;
    if jsonb_typeof(v_e -> 'regions') = 'array' then
      for v_code in select jsonb_array_elements_text(v_e -> 'regions') loop
        if not public._trip_region_valid(v_code, v_date) then
          raise exception 'INVALID_REGION' using detail = format('알 수 없는 지역입니다: %s', v_code);
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

-- 같은 직원·날짜의 진행 중 근무일 (repository.findActiveDay) — 첫 충돌 날짜 반환
create or replace function public._trip_conflict_date(p_employee uuid, p_dates date[], p_exclude_claim uuid)
returns date
language sql security definer stable
set search_path = public, pg_temp
as $$
  select min(d.work_date)
  from public.trip_claim_days d
  where d.employee_id = p_employee
    and d.work_date = any(p_dates)
    and not d.is_removed
    and d.claim_status in ('draft', 'submitted', 'returned', 'approved')
    and (p_exclude_claim is null or d.claim_id <> p_exclude_claim)
$$;

-- 실제 출발·도착 기록 사본 저장 (entry.actual 이 있을 때만, 표준값은 절대 넣지 않음)
create or replace function public._trip_record_actual(p_day public.trip_claim_days, p_actor uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_day.entry -> 'actual') is distinct from 'object' then
    return;
  end if;
  insert into public.trip_actual_times (day_id, day_revision, depart_min, arrive_min, source, recorded_by)
  values (
    p_day.id,
    p_day.revision,
    public.trip_clock_to_min(p_day.entry #>> '{actual,departAt}'),
    -- 자정 넘긴 도착: arriveNextDay = true 면 +1440 (trip_clock_to_min 의 두 번째 인자)
    public.trip_clock_to_min(
      p_day.entry #>> '{actual,arriveAt}',
      coalesce((p_day.entry #>> '{actual,arriveNextDay}')::boolean, false)
    ),
    p_day.entry #>> '{actual,source}',
    p_actor
  )
  on conflict (day_id, day_revision) do nothing;
end;
$$;

-- 근무일 추가 (UNIQUE 위반 → DUPLICATE_DAY)
create or replace function public._trip_insert_day(p_claim_id uuid, p_employee uuid, p_entry jsonb, p_actor uuid)
returns public.trip_claim_days
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_day public.trip_claim_days;
begin
  begin
    insert into public.trip_claim_days (
      claim_id, employee_id, work_date, entry, revision,
      site_start_min, site_end_min, office_start_min, office_end_min, lunch_taken, claim_status
    ) values (
      p_claim_id, p_employee, (p_entry ->> 'date')::date, p_entry, 1,
      public.trip_clock_to_min(p_entry #>> '{site,start}',   (p_entry #>> '{site,startNextDay}')::boolean),
      public.trip_clock_to_min(p_entry #>> '{site,end}',     (p_entry #>> '{site,endNextDay}')::boolean),
      public.trip_clock_to_min(p_entry #>> '{office,start}', (p_entry #>> '{office,startNextDay}')::boolean),
      public.trip_clock_to_min(p_entry #>> '{office,end}',   (p_entry #>> '{office,endNextDay}')::boolean),
      coalesce((p_entry ->> 'lunchTaken')::boolean, true),
      'draft'  -- 트리거가 신청 상태로 덮어씀
    )
    returning * into v_day;
  exception when unique_violation then
    raise exception 'DUPLICATE_DAY' using detail = format('%s에 이미 신청한 근무일이 있습니다', p_entry ->> 'date');
  end;
  perform public._trip_record_actual(v_day, p_actor);
  return v_day;
end;
$$;

-- 근무일 입력 교체 (revision + 1)
create or replace function public._trip_update_day_entry(p_day_id uuid, p_entry jsonb, p_actor uuid)
returns public.trip_claim_days
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_day public.trip_claim_days;
begin
  update public.trip_claim_days set
    entry            = p_entry,
    revision         = revision + 1,
    site_start_min   = public.trip_clock_to_min(p_entry #>> '{site,start}',   (p_entry #>> '{site,startNextDay}')::boolean),
    site_end_min     = public.trip_clock_to_min(p_entry #>> '{site,end}',     (p_entry #>> '{site,endNextDay}')::boolean),
    office_start_min = public.trip_clock_to_min(p_entry #>> '{office,start}', (p_entry #>> '{office,startNextDay}')::boolean),
    office_end_min   = public.trip_clock_to_min(p_entry #>> '{office,end}',   (p_entry #>> '{office,endNextDay}')::boolean),
    lunch_taken      = coalesce((p_entry ->> 'lunchTaken')::boolean, true),
    updated_at       = now()
  where id = p_day_id
  returning * into v_day;
  perform public._trip_record_actual(v_day, p_actor);
  return v_day;
end;
$$;

-- ------------------------------------------------------------
-- 규칙 버전 · 계산 신뢰 판정 (v2 서버 재계산, 계약 2-2)
-- ------------------------------------------------------------

-- 지금 계산에 쓰는 규칙 버전 (trip_rule_versions.is_active, 부분 UNIQUE 로 최대 1건). 없으면 null
--   compute 함수는 이 값이 서버 번들 RULE_VERSION 과 같은지 먼저 본다 (다르면 RULE_VERSION_MISMATCH, 계약 3절).
--   시행일(effective_from) 미정이라 유효기간은 보지 않는다. 시행일 확정 시 근무일 기준 검사 추가 (계약 5절).
create or replace function public.trip_active_rule_version()
returns text
language sql security definer stable
set search_path = public, pg_temp
as $$
  select version from public.trip_rule_versions where is_active limit 1
$$;

-- 근무일의 최신 계산이 "현재 입력에 대한 서버 계산"인지 (내부용)
--   최신(seq 최대) 계산이 있고
--     engine_source = 'server'
--     day_revision  = 현재 revision
--     entry_snapshot = 현재 entry (jsonb 동등 비교 — 키 순서 무관)
--     rule_version  = 활성 버전
--   이면 true. 계산이 없거나 활성 버전이 없으면(null 비교) false.
create or replace function public._trip_calc_is_current(p_day public.trip_claim_days)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.engine_source = 'server'
       and c.day_revision = p_day.revision
       and c.entry_snapshot = p_day.entry
       and c.rule_version = public.trip_active_rule_version()
    from public.trip_day_calcs c
    where c.day_id = p_day.id
    order by c.seq desc
    limit 1
  ), false)
$$;


-- ============================================================
-- trip_store_server_calcs — 서버 계산 결과 저장 (service_role 전용, 계약 2-2)
-- ============================================================
--   호출자: api/trip-compute.ts (Vercel Function, SUPABASE_SERVICE_ROLE_KEY). 브라우저는 호출할 수 없다.
--   p_claim_id      : 계산한 신청
--   p_claim_version : 함수가 입력을 읽은 시점의 trip_claims.version
--   p_rule_version  : 서버 번들의 RULE_VERSION (engine/rules.ts)
--   p_calcs         : { "<day_id uuid>": DayComputation & { dayRevision: number } }
--                     DayComputation = { classification, engineInput, result, carryIn?, carryOut? }
--                     (src/features/trip/data/compute.ts 의 DayComputation 을 JSON 으로. null 허용 필드는 JSON null)
--                     dayRevision = 함수가 읽은 그 근무일의 revision (src/features/trip/server/types.ts StoredDayComputation)
--   p_computed_by  : 함수가 검증한 JWT 의 사용자 id (감사용)
--   반환           : { "<day_id>": "<calc_id>" }
--
--   검사 (계약 2-2 의 1~8). 하나라도 실패하면 예외 → 함수 전체 롤백 (일부 근무일만 저장되는 일 없음)
--     0. 호출 역할 service_role                         → FORBIDDEN
--        (+ 기능 스위치 employee_form / admin_review 둘 다 꺼짐 → FEATURE_DISABLED, 계약 0-5 방어선)
--     1. 신청 존재 / status ∈ (draft, returned, submitted) → NOT_FOUND / NOT_EDITABLE
--     2. p_rule_version = trip_active_rule_version()      → RULE_VERSION_MISMATCH
--     3. 키 집합 = 빠지지 않은 근무일 id 전부              → CALC_INCOMPLETE_SET
--     4. p_computed_by 가 employees 에 존재                → UNKNOWN_USER
--     5. 형식·수치 불변식                                  → CALC_INVARIANT
--     6. engineInput.regions 가 근무일에 유효한 지역       → UNKNOWN_REGION
--     7. p_claim_version = 잠근 trip_claims.version        → VERSION_CONFLICT
--     8. 근무일마다 dayRevision(정수) = trip_claim_days.revision → VERSION_CONFLICT
--   실행 순서: 7 은 신청을 잠근 직후 판정이 가능하므로 근무일 루프 전(4 다음)에, 8 은 근무일 루프 안에서
--              그날의 5·6 검사 다음에 본다. 어느 순서든 실패하면 전부 롤백되어 결과는 같다.
--   저장: entry_snapshot := day.entry(DB 값), day_revision := day.revision,
--         engine_source := 'server', computed_by := p_computed_by.
--         직전 계산과 같으면(아래 비교) 새 행 없이 기존 id 반환 — 승인 화면의 calc id 묶음이 불필요하게 깨지지 않게.
--
--   계산과 저장 사이 경쟁 → 7·8 로 해결
--      함수가 입력을 읽은 뒤 이 RPC 를 부르기 전에 직원이 trip_update_draft(또는 관리자가 trip_admin_adjust_day)로
--      입력을 바꾸면, 옛 입력으로 낸 계산이 새 입력(entry_snapshot = 저장 시점 DB 값)에 붙어 "현재 계산"으로
--      판정될 수 있었다. 두 RPC 는 모두 trip_claims.version 을 올리고, 입력이 바뀐 근무일은 revision 을 올린다.
--      그래서 함수가 읽은 시점의 version(7)과 근무일 revision(8)을 저장 시점 DB 값과 대조하면 그 사이의 변경이
--      전부 VERSION_CONFLICT 로 걸리고, 옛 입력의 계산은 저장되지 않는다 (화면은 다시 계산).
--      신청을 for update 로 잠근 뒤 비교하므로, 비교와 저장 사이에 다른 수정이 끼어들 수 없다.
--      dayRevision 은 비교에만 쓰고 계산 행에 따로 저장하지 않는다 (day_revision 칼럼은 DB 의 revision).
create or replace function public.trip_store_server_calcs(
  p_claim_id uuid,
  p_claim_version integer,
  p_rule_version text,
  p_calcs jsonb,
  p_computed_by uuid
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_role    text;
  v_active_version text;
  v_claim   public.trip_claims;
  v_day     public.trip_claim_days;
  v_key     text;
  v_day_id  uuid;
  v_keys    uuid[] := '{}';
  v_active  uuid[];
  v_calc    jsonb;
  v_cls     jsonb;
  v_input   jsonb;
  v_result  jsonb;
  v_cin     jsonb;
  v_cout    jsonb;
  v_ok      boolean;
  v_path    text[];
  v_code    text;
  v_codes   text[];
  v_latest  public.trip_day_calcs;
  v_id      uuid;
  v_out     jsonb := '{}'::jsonb;
begin
  -- 0. 호출 역할: service_role 만 (EXECUTE 권한 회수와 이중 방어)
  --    [미확인] request.jwt.claims 가 없는 연결에서는 빈 문자열이 올 수 있어 nullif 로 감쌈 (''::jsonb 는 오류).
  --    [미확인] SECURITY DEFINER 안에서도 current_setting('role') 은 호출 연결의 SET ROLE 값을 돌려준다고 보고
  --             계약대로 둠 → 대조-체크리스트 C-11 로 확인. SQL Editor(postgres)에서 직접 부르면 FORBIDDEN 이 정상.
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('role', true)
  );
  if v_role is distinct from 'service_role' then
    raise exception 'FORBIDDEN' using detail = '계산 결과는 서버 계산 함수만 저장할 수 있습니다';
  end if;

  -- 기능 스위치 (계약 0-5). 함수가 먼저 경로별(employee_form / admin_review)로 검사하고,
  --   여기서는 둘 다 꺼진 경우만 막는다. [보고] 계약 2-2 검사 목록에 없는 추가 방어선.
  if not (public.trip_feature_enabled('employee_form') or public.trip_feature_enabled('admin_review')) then
    raise exception 'FEATURE_DISABLED' using detail = '출장 기능이 꺼져 있어 계산 결과를 저장할 수 없습니다';
  end if;

  -- 1. 신청 존재·상태. 잠금 순서는 공개 RPC 와 같게 trip_claims 먼저 (교착 방지)
  select * into v_claim from public.trip_claims where id = p_claim_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = '신청을 찾을 수 없습니다';
  end if;
  if v_claim.status not in ('draft', 'returned', 'submitted') then
    raise exception 'NOT_EDITABLE' using detail = '승인·반려·취소된 신청은 다시 계산해 저장할 수 없습니다';
  end if;

  -- 2. 규칙 버전 = 활성 버전 (활성 버전이 없으면 무엇이든 불일치)
  v_active_version := public.trip_active_rule_version();
  if p_rule_version is null or v_active_version is null or p_rule_version <> v_active_version then
    raise exception 'RULE_VERSION_MISMATCH'
      using detail = format('계산 규칙 버전(%s)이 현재 활성 버전(%s)과 다릅니다',
                            coalesce(p_rule_version, '(없음)'), coalesce(v_active_version, '(없음)'));
  end if;

  -- 3. 근무일 집합: 키 = 이 신청의 빠지지 않은 근무일 id 전부 (빠진 날도, 남는 키도 불허)
  if p_calcs is null or jsonb_typeof(p_calcs) <> 'object' then
    raise exception 'CALC_INCOMPLETE_SET' using detail = '계산 결과 묶음 형식이 올바르지 않습니다';
  end if;
  for v_key in select jsonb_object_keys(p_calcs) loop
    begin
      v_day_id := v_key::uuid;
    exception when others then
      raise exception 'CALC_INCOMPLETE_SET' using detail = format('근무일 id 형식이 아닙니다: %s', v_key);
    end;
    -- 대문자·중괄호 등 다른 표기로 같은 id 를 두 번 넣는 것 방지 (정규 표기만 허용)
    if v_day_id::text <> v_key then
      raise exception 'CALC_INCOMPLETE_SET' using detail = format('근무일 id 는 소문자 표준 형식이어야 합니다: %s', v_key);
    end if;
    v_keys := v_keys || v_day_id;
  end loop;
  v_active := array(
    select id from public.trip_claim_days
    where claim_id = p_claim_id and not is_removed
  );
  if cardinality(v_active) = 0 then
    raise exception 'CALC_INCOMPLETE_SET' using detail = '계산할 근무일이 없습니다';
  end if;
  if exists (select unnest(v_keys) except select unnest(v_active))
     or exists (select unnest(v_active) except select unnest(v_keys)) then
    raise exception 'CALC_INCOMPLETE_SET'
      using detail = '계산 결과의 근무일이 신청의 현재 근무일과 맞지 않습니다. 다시 계산하세요';
  end if;

  -- 4. 계산을 요청한 사용자(감사용)가 직원으로 존재
  if p_computed_by is null or not exists (select 1 from public.employees where id = p_computed_by) then
    raise exception 'UNKNOWN_USER' using detail = '계산을 요청한 사용자를 찾을 수 없습니다';
  end if;

  -- 7. 계산-저장 경쟁 방어: 함수가 읽은 신청 version = 지금(잠근) version
  if p_claim_version is null or p_claim_version <> v_claim.version then
    raise exception 'VERSION_CONFLICT' using detail = '계산 뒤 입력이 바뀌었습니다. 다시 계산하세요';
  end if;

  -- 5·6. 근무일마다 형식·불변식·지역 검사 후 저장
  --   근무일 순서로 처리. 뒤에서 예외가 나면 앞에서 저장한 것도 함께 롤백된다.
  for v_day in
    select * from public.trip_claim_days
    where claim_id = p_claim_id and not is_removed
    order by work_date
    for update
  loop
    v_calc := p_calcs -> v_day.id::text;
    if jsonb_typeof(v_calc) is distinct from 'object' then
      raise exception 'CALC_INVARIANT' using detail = format('%s 계산 결과 형식이 올바르지 않습니다', v_day.work_date);
    end if;
    v_cls    := v_calc -> 'classification';
    v_input  := nullif(v_calc -> 'engineInput', 'null'::jsonb);
    v_result := nullif(v_calc -> 'result',      'null'::jsonb);
    v_cin    := nullif(v_calc -> 'carryIn',     'null'::jsonb);
    v_cout   := nullif(v_calc -> 'carryOut',    'null'::jsonb);

    -- 5-a. 형식: classification(missing·notices 배열), 나머지는 객체 또는 null
    if jsonb_typeof(v_cls) is distinct from 'object'
       or jsonb_typeof(v_cls -> 'missing') is distinct from 'array'
       or jsonb_typeof(v_cls -> 'notices') is distinct from 'array' then
      raise exception 'CALC_INVARIANT' using detail = format('%s 분류 결과 형식이 올바르지 않습니다', v_day.work_date);
    end if;
    if (v_input  is not null and jsonb_typeof(v_input)  <> 'object')
       or (v_result is not null and jsonb_typeof(v_result) <> 'object')
       or (v_cin    is not null and jsonb_typeof(v_cin)    <> 'object')
       or (v_cout   is not null and jsonb_typeof(v_cout)   <> 'object') then
      raise exception 'CALC_INVARIANT' using detail = format('%s 계산 결과 형식이 올바르지 않습니다', v_day.work_date);
    end if;
    if v_result is not null and jsonb_typeof(v_result -> 'ok') is distinct from 'boolean' then
      raise exception 'CALC_INVARIANT' using detail = format('%s 계산 결과에 성공 여부(ok)가 없습니다', v_day.work_date);
    end if;
    v_ok := coalesce((v_result ->> 'ok')::boolean, false);

    -- 5-b. 성공 결과(TripDayResult)의 불변식
    if v_ok then
      if (v_result ->> 'ruleVersion') is distinct from p_rule_version then
        raise exception 'CALC_INVARIANT' using detail = format('%s 계산 결과의 규칙 버전이 맞지 않습니다', v_day.work_date);
      end if;
      if jsonb_typeof(v_result -> 'flags') is distinct from 'array'
         or jsonb_typeof(coalesce(v_result -> 'proposedBy', '[]'::jsonb)) <> 'array'
         or jsonb_typeof(coalesce(v_result -> 'requiresLegalReview', '[]'::jsonb)) <> 'array' then
        raise exception 'CALC_INVARIANT' using detail = format('%s 계산 결과의 목록 형식이 올바르지 않습니다', v_day.work_date);
      end if;
      -- 필수 수치: 숫자이고 0 이상 (CASE 로 숫자가 아닐 때 형변환 오류가 나지 않게)
      foreach v_path slice 1 in array array[
        array['trip', 'hours'],          array['trip', 'nightTravelHours'],
        array['overtime', 'hours'],      array['overtime', 'nightHours'],
        array['legal', 'totalWorkHours'], array['legal', 'dailyOver8Hours'],
        array['actualNight', 'workHours']
      ] loop
        -- plpgsql 의 IF 는 괄호 밖 첫 THEN 에서 조건식을 끝내므로 CASE 전체를 괄호로 감싼다 (로컬 시험에서 발견)
        if (case when jsonb_typeof(v_result #> v_path) = 'number'
                 then (v_result #>> v_path)::numeric < 0
                 else true end) then
          raise exception 'CALC_INVARIANT'
            using detail = format('%s %s 값이 올바르지 않습니다 (0 이상 숫자)', v_day.work_date, array_to_string(v_path, '.'));
        end if;
      end loop;
      -- 상한: 출장 인정 ≤ 8 (표준 편도 최대 4h × 왕복), 연장 ≤ 24
      if (v_result #>> '{trip,hours}')::numeric > 8 then
        raise exception 'CALC_INVARIANT' using detail = format('%s 출장 인정시간이 8시간을 넘습니다', v_day.work_date);
      end if;
      if (v_result #>> '{overtime,hours}')::numeric > 24 then
        raise exception 'CALC_INVARIANT' using detail = format('%s 연장 인정시간이 24시간을 넘습니다', v_day.work_date);
      end if;
      -- 휴일근로: 평일·토요일은 JSON null, 일요일·공휴일은 두 값 모두 0~24
      if jsonb_typeof(v_result -> 'holiday') = 'object' then
        foreach v_path slice 1 in array array[array['holiday', 'within8Hours'], array['holiday', 'over8Hours']] loop
          if (case when jsonb_typeof(v_result #> v_path) = 'number'
                   then (v_result #>> v_path)::numeric not between 0 and 24
                   else true end) then
            raise exception 'CALC_INVARIANT'
              using detail = format('%s %s 값이 올바르지 않습니다 (0~24)', v_day.work_date, array_to_string(v_path, '.'));
          end if;
        end loop;
      elsif jsonb_typeof(v_result -> 'holiday') is distinct from 'null' then
        raise exception 'CALC_INVARIANT' using detail = format('%s 휴일근로 값 형식이 올바르지 않습니다', v_day.work_date);
      end if;
    end if;

    -- 6. 엔진 입력의 지역 코드가 trip_regions 에 있고 근무일에 유효한지
    if v_input is not null and v_input ? 'regions' then
      if jsonb_typeof(v_input -> 'regions') <> 'array' then
        raise exception 'CALC_INVARIANT' using detail = format('%s 엔진 입력의 지역 형식이 올바르지 않습니다', v_day.work_date);
      end if;
      for v_code in select jsonb_array_elements_text(v_input -> 'regions') loop
        if not public._trip_region_valid(v_code, v_day.work_date) then
          raise exception 'UNKNOWN_REGION'
            using detail = format('%s 계산에 알 수 없는 지역이 쓰였습니다: %s', v_day.work_date, v_code);
        end if;
      end loop;
    end if;

    -- 8. 근무일 단위 경쟁 방어: 함수가 읽은 revision = 지금 revision (정수만 허용, 없으면 거부)
    if jsonb_typeof(v_calc -> 'dayRevision') is distinct from 'number'
       or (v_calc ->> 'dayRevision') !~ '^[0-9]+$'
       or (v_calc ->> 'dayRevision')::bigint <> v_day.revision then
      raise exception 'VERSION_CONFLICT'
        using detail = format('계산 뒤 %s 입력이 바뀌었습니다. 다시 계산하세요', v_day.work_date);
    end if;

    -- 직전 계산과 같으면 재사용 (v1 비교 로직 + 서버 계산·현재 입력 조건)
    select * into v_latest
    from public.trip_day_calcs
    where day_id = v_day.id
    order by seq desc
    limit 1;
    if found
       and v_latest.engine_source = 'server'
       and v_latest.day_revision = v_day.revision
       and v_latest.entry_snapshot = v_day.entry
       and v_latest.rule_version = p_rule_version
       and v_latest.classification = v_cls
       and v_latest.engine_input is not distinct from v_input
       and v_latest.result is not distinct from v_result
       and v_latest.carry_in is not distinct from v_cin
       and v_latest.carry_out is not distinct from v_cout then
      v_out := v_out || jsonb_build_object(v_day.id::text, v_latest.id);
      continue;
    end if;

    -- 확인 표시 코드 = 엔진 flags + 분류 안내 중 관리자 확인 대상
    --   service.ts reviewItems / REVIEW_NOTICE_CODES 와 같아야 한다 (6개).
    --   v1 은 NEXT_DAY_ENTRY_MISSING 하나만 올려 service.ts 와 달랐음 → v2 에서 맞춤.
    v_codes := array(
      select distinct x from (
        select f ->> 'code' as x
        from jsonb_array_elements(case when v_ok then v_result -> 'flags' else '[]'::jsonb end) f
        union
        select n ->> 'code'
        from jsonb_array_elements(v_cls -> 'notices') n
        where n ->> 'code' = any (array[
          'NEXT_DAY_ENTRY_MISSING', 'HOLIDAY_SOURCE_UNVERIFIED',
          'CARRY_IN_NOT_ENTERED', 'CARRY_IN_OVERLAP', 'CARRY_IN_GAP', 'OTHER_REQUEST_SAME_DAY'
        ])
      ) s
      where x is not null
      order by x
    );

    insert into public.trip_day_calcs (
      claim_id, day_id, day_revision, rule_version, entry_snapshot,
      classification, engine_input, result, carry_out, carry_in,
      result_ok, missing_count, review_codes,
      value_status, trip_status, night_travel_status, overtime_status, night_overtime_status,
      trip_hours, trip_night_travel_hours, overtime_hours, overtime_night_hours,
      holiday_within8_hours, holiday_over8_hours,
      legal_total_work_hours, legal_daily_over8_hours, legal_basis,
      actual_night_work_hours, proposed_by, requires_legal_review,
      engine_source, computed_by
    ) values (
      v_day.claim_id, v_day.id, v_day.revision, p_rule_version,
      v_day.entry,                                   -- DB 의 근무일 입력 (호출자 값 아님)
      v_cls, v_input, v_result, v_cout, v_cin,
      v_ok, jsonb_array_length(v_cls -> 'missing'), v_codes,
      case when v_ok then v_result ->> 'status' end,
      case when v_ok then v_result #>> '{valueStatus,trip}' end,
      case when v_ok then v_result #>> '{valueStatus,nightTravel}' end,
      case when v_ok then v_result #>> '{valueStatus,overtime}' end,
      case when v_ok then v_result #>> '{valueStatus,nightOvertime}' end,
      case when v_ok then (v_result #>> '{trip,hours}')::numeric end,
      case when v_ok then (v_result #>> '{trip,nightTravelHours}')::numeric end,
      case when v_ok then (v_result #>> '{overtime,hours}')::numeric end,
      case when v_ok then (v_result #>> '{overtime,nightHours}')::numeric end,
      case when v_ok then (v_result #>> '{holiday,within8Hours}')::numeric end,
      case when v_ok then (v_result #>> '{holiday,over8Hours}')::numeric end,
      case when v_ok then (v_result #>> '{legal,totalWorkHours}')::numeric end,
      case when v_ok then (v_result #>> '{legal,dailyOver8Hours}')::numeric end,
      case when v_ok then v_result #>> '{legal,basis}' end,
      case when v_ok then (v_result #>> '{actualNight,workHours}')::numeric end,
      case when v_ok then array(select jsonb_array_elements_text(coalesce(v_result -> 'proposedBy', '[]'::jsonb))) else '{}' end,
      case when v_ok then array(select jsonb_array_elements_text(coalesce(v_result -> 'requiresLegalReview', '[]'::jsonb))) else '{}' end,
      'server',
      p_computed_by
    )
    returning id into v_id;

    insert into public.trip_review_flags (calc_id, claim_id, code)
    select v_id, v_day.claim_id, c from unnest(v_codes) as c;

    v_out := v_out || jsonb_build_object(v_day.id::text, v_id);
  end loop;

  return v_out;
end;
$$;

-- 진행 중 근무일의 최신 계산 결과 id (정렬)
create or replace function public._trip_latest_calc_ids(p_claim_id uuid)
returns uuid[]
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(id order by id), '{}')
  from (
    select distinct on (c.day_id) c.id
    from public.trip_day_calcs c
    join public.trip_claim_days d on d.id = c.day_id and not d.is_removed
    where c.claim_id = p_claim_id
    order by c.day_id, c.seq desc
  ) s
$$;

-- 동행 초안 복사 규칙 (service.ts companionCopy 와 동일)
--   복사: date, site, regions, noSiteWork, travelStarts, directedWaits, jeju.legs(증빙 제외), actual(출처=companion_copy)
--   복사 안 함: 점심·휴게·사무실 근무·경유 증빙 (사람마다 다름)
create or replace function public._trip_companion_copy(p_entry jsonb)
returns jsonb
language sql immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object('date', p_entry -> 'date')
    || case when p_entry ? 'site'          then jsonb_build_object('site', p_entry -> 'site') else '{}'::jsonb end
    || case when p_entry ? 'regions'       then jsonb_build_object('regions', p_entry -> 'regions') else '{}'::jsonb end
    || case when p_entry ? 'noSiteWork'    then jsonb_build_object('noSiteWork', p_entry -> 'noSiteWork') else '{}'::jsonb end
    || case when p_entry ? 'travelStarts'  then jsonb_build_object('travelStarts', p_entry -> 'travelStarts') else '{}'::jsonb end
    || case when p_entry ? 'directedWaits' then jsonb_build_object('directedWaits', p_entry -> 'directedWaits') else '{}'::jsonb end
    || case when p_entry ? 'jeju'
            then jsonb_build_object('jeju', jsonb_build_object('legs', p_entry #> '{jeju,legs}', 'evidenceFileIds', '[]'::jsonb))
            else '{}'::jsonb end
    || case when jsonb_typeof(p_entry -> 'actual') = 'object'
            then jsonb_build_object('actual', (p_entry -> 'actual') || jsonb_build_object('source', 'companion_copy'))
            else '{}'::jsonb end
$$;


-- ============================================================
-- 1. trip_create_claim — 작성 (service.ts createClaim)
-- ============================================================
--   p_header      : ClaimHeader
--   p_entries     : DayEntry[]
--   p_employee_id : 대리 작성 대상 (admin 만). null 이면 본인
--   반환          : { "id": uuid, "version": integer } (계약 1절)
--   v2: 계산 결과(p_calcs)를 받지 않는다. 저장 뒤 화면이 POST /api/trip-compute 를 부른다.
create or replace function public.trip_create_claim(
  p_header jsonb,
  p_entries jsonb,
  p_employee_id uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid;
  v_role     text;
  v_employee uuid;
  v_h        record;
  v_dates    date[];
  v_clash    date;
  v_id       uuid := gen_random_uuid();
  v_entry    jsonb;
  v_claim    public.trip_claims;
begin
  perform public.trip_require_feature('employee_form');
  v_uid  := public._trip_actor_id();
  v_role := public._trip_actor_role(v_uid);

  v_employee := coalesce(p_employee_id, v_uid);
  if v_employee <> v_uid then
    if v_role is distinct from 'admin' then
      raise exception 'FORBIDDEN' using detail = '다른 직원의 신청은 관리자만 대신 작성할 수 있습니다';
    end if;
    if not exists (select 1 from public.employees where id = v_employee and is_active = true) then
      raise exception 'NOT_FOUND' using detail = '대상 직원을 찾을 수 없습니다';
    end if;
  end if;

  select * into v_h from public._trip_parse_header(p_header);
  perform public._trip_validate_entries(p_entries, v_h.o_start, v_h.o_end);

  -- 하나라도 겹치면 아무것도 만들지 않는다 (함수 전체가 한 트랜잭션)
  v_dates := array(select (e ->> 'date')::date from jsonb_array_elements(p_entries) e);
  v_clash := public._trip_conflict_date(v_employee, v_dates, null);
  if v_clash is not null then
    raise exception 'DUPLICATE_DAY' using detail = format('%s에 이미 신청한 근무일이 있습니다', v_clash);
  end if;

  insert into public.trip_claims (
    id, employee_id, group_id, initiator_id, origin, input_route,
    header, regions, schedule_kind, start_date, end_date, status, version
  ) values (
    v_id, v_employee, v_id, v_uid, 'self',
    case when v_employee = v_uid then 'self' else 'proxy' end,
    p_header, v_h.o_regions, v_h.o_kind, v_h.o_start, v_h.o_end, 'draft', 1
  );

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    perform public._trip_insert_day(v_id, v_employee, v_entry, v_uid);
  end loop;

  select * into v_claim from public.trip_claims where id = v_id;
  return jsonb_build_object('id', v_claim.id, 'version', v_claim.version);
end;
$$;


-- ============================================================
-- 2. trip_update_draft — 초안·되돌림 건 수정 (service.ts updateDraft)
-- ============================================================
--   p_header / p_entries 가 null 이면 기존 값 유지.
--   p_entries 에서 빠진 날은 is_removed 표시 (계산 결과가 참조하므로 물리 삭제 안 함).
--   반환: { "id": uuid, "version": integer } (계약 1절)
--   v2: 계산 결과(p_calcs)를 받지 않는다. 입력이 바뀐 날은 revision 이 올라가 기존 계산이 "오래된 계산"이 되고,
--       화면이 POST /api/trip-compute 를 다시 불러야 제출할 수 있다.
--   동시 수정: 시작에서 trip_claims 행을 for update 로 잠근 뒤 version 비교 (보안검토 2-6).
create or replace function public.trip_update_draft(
  p_claim_id uuid,
  p_expected_version integer,
  p_header jsonb default null,
  p_entries jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid;
  v_claim   public.trip_claims;
  v_header  jsonb;
  v_entries jsonb;
  v_h       record;
  v_new     date[];
  v_clash   date;
  v_day     public.trip_claim_days;
  v_next    jsonb;
  v_entry   jsonb;
begin
  perform public.trip_require_feature('employee_form');
  v_uid := public._trip_actor_id();

  select * into v_claim from public.trip_claims where id = p_claim_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = '신청을 찾을 수 없습니다';
  end if;
  if v_claim.employee_id <> v_uid then
    raise exception 'FORBIDDEN' using detail = '본인 신청만 수정할 수 있습니다';
  end if;
  if v_claim.status not in ('draft', 'returned') then
    raise exception 'NOT_EDITABLE' using detail = '작성 중이거나 반려되어 돌아온 신청만 수정할 수 있습니다';
  end if;
  if v_claim.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using detail = '다른 곳에서 먼저 수정되었습니다. 새로 불러오세요';
  end if;

  v_header := coalesce(p_header, v_claim.header);
  select * into v_h from public._trip_parse_header(v_header);

  v_entries := coalesce(
    p_entries,
    (select jsonb_agg(entry order by work_date) from public.trip_claim_days where claim_id = p_claim_id and not is_removed)
  );
  perform public._trip_validate_entries(v_entries, v_h.o_start, v_h.o_end);

  v_new := array(
    select (e ->> 'date')::date from jsonb_array_elements(v_entries) e
    where not exists (
      select 1 from public.trip_claim_days d
      where d.claim_id = p_claim_id and not d.is_removed and d.work_date = (e ->> 'date')::date
    )
  );
  v_clash := public._trip_conflict_date(v_claim.employee_id, v_new, p_claim_id);
  if v_clash is not null then
    raise exception 'DUPLICATE_DAY' using detail = format('%s에 이미 신청한 근무일이 있습니다', v_clash);
  end if;

  update public.trip_claims set
    header        = v_header,
    regions       = v_h.o_regions,
    schedule_kind = v_h.o_kind,
    start_date    = v_h.o_start,
    end_date      = v_h.o_end,
    version       = version + 1,
    updated_at    = now()
  where id = p_claim_id;

  -- 기존 근무일: 빠진 날 표시 / 바뀐 날 revision + 1
  for v_day in select * from public.trip_claim_days where claim_id = p_claim_id and not is_removed loop
    select e into v_next from jsonb_array_elements(v_entries) e where (e ->> 'date')::date = v_day.work_date;
    if v_next is null then
      update public.trip_claim_days set is_removed = true, removed_at = now() where id = v_day.id;
    elsif v_next is distinct from v_day.entry then
      perform public._trip_update_day_entry(v_day.id, v_next, v_uid);
    end if;
    v_next := null;
  end loop;

  -- 새 날짜
  for v_entry in
    select e from jsonb_array_elements(v_entries) e where (e ->> 'date')::date = any(v_new)
  loop
    perform public._trip_insert_day(p_claim_id, v_claim.employee_id, v_entry, v_uid);
  end loop;

  select * into v_claim from public.trip_claims where id = p_claim_id;
  return jsonb_build_object('id', v_claim.id, 'version', v_claim.version);
end;
$$;


-- ============================================================
-- 3. trip_submit — 제출 (service.ts submit)
-- ============================================================
--   검사 순서 (계약 2-2)
--     1. 모든 진행 중 근무일의 최신 계산이 _trip_calc_is_current (서버 계산 · 현재 revision · 현재 입력 ·
--        활성 규칙 버전) → 아니면 CALC_STALE_OR_UNTRUSTED (계산 없음 / 오래됨 / 규칙 버전 바뀜)
--        화면은 이 코드를 받으면 POST /api/trip-compute 를 부른 뒤 다시 제출한다.
--     2. 그 계산에 입력 누락이 없고(missing_count = 0) 계산이 성공(result_ok) → 아니면 INCOMPLETE
--   동시 수정: trip_claims 를 for update 로 잠근 뒤 version 비교 (보안검토 2-6).
--   [미확인] K11 증빙·다음 영업일 마감 검사는 기존 overtime-window 규칙 재사용 방식 결정 후 추가.
create or replace function public.trip_submit(p_claim_id uuid, p_expected_version integer)
returns public.trip_claims
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid;
  v_claim   public.trip_claims;
  v_days    integer;
  v_blocked text;
begin
  perform public.trip_require_feature('employee_form');
  v_uid := public._trip_actor_id();

  select * into v_claim from public.trip_claims where id = p_claim_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = '신청을 찾을 수 없습니다';
  end if;
  if v_claim.employee_id <> v_uid then
    raise exception 'FORBIDDEN' using detail = '본인 신청만 수정할 수 있습니다';
  end if;
  if v_claim.status not in ('draft', 'returned') then
    raise exception 'NOT_EDITABLE' using detail = '작성 중이거나 반려되어 돌아온 신청만 수정할 수 있습니다';
  end if;
  if v_claim.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using detail = '다른 곳에서 먼저 수정되었습니다. 새로 불러오세요';
  end if;

  select count(*) into v_days from public.trip_claim_days where claim_id = p_claim_id and not is_removed;
  if v_days = 0 then
    raise exception 'NO_DAYS' using detail = '근무일을 하나 이상 입력하세요';
  end if;

  -- 1. 서버 계산이 현재 입력과 맞는지
  select string_agg(to_char(d.work_date, 'YYYY-MM-DD'), ', ' order by d.work_date) into v_blocked
  from public.trip_claim_days d
  where d.claim_id = p_claim_id and not d.is_removed
    and not public._trip_calc_is_current(d);
  if v_blocked is not null then
    raise exception 'CALC_STALE_OR_UNTRUSTED'
      using detail = format('서버 계산이 없거나 지금 입력과 맞지 않는 날이 있습니다. 다시 계산한 뒤 제출하세요: %s', v_blocked);
  end if;

  -- 2. 입력 누락·계산 실패
  select string_agg(to_char(d.work_date, 'YYYY-MM-DD'), ', ' order by d.work_date) into v_blocked
  from public.trip_claim_days d
  join lateral (
    select * from public.trip_day_calcs c where c.day_id = d.id order by c.seq desc limit 1
  ) lc on true
  where d.claim_id = p_claim_id and not d.is_removed
    and (lc.missing_count > 0 or not lc.result_ok);
  if v_blocked is not null then
    raise exception 'INCOMPLETE' using detail = format('입력이 더 필요한 날이 있습니다: %s', v_blocked);
  end if;

  update public.trip_claims set
    status       = 'submitted',
    submitted_at = now(),
    version      = version + 1,
    updated_at   = now()
  where id = p_claim_id
  returning * into v_claim;
  return v_claim;
end;
$$;


-- ============================================================
-- 4. trip_cancel — 취소 (service.ts cancel)
-- ============================================================
--   draft / submitted / returned 만. 승인 후 정정은 관리자 조정(후속: 다음 달 조정 행).
--   취소되면 트리거가 근무일 claim_status 를 바꿔 같은 날짜로 다시 신청할 수 있게 된다.
create or replace function public.trip_cancel(p_claim_id uuid, p_expected_version integer)
returns public.trip_claims
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid;
  v_claim public.trip_claims;
begin
  perform public.trip_require_feature('employee_form');
  v_uid := public._trip_actor_id();

  select * into v_claim from public.trip_claims where id = p_claim_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = '신청을 찾을 수 없습니다';
  end if;
  if v_claim.employee_id <> v_uid then
    raise exception 'FORBIDDEN' using detail = '본인 신청만 취소할 수 있습니다';
  end if;
  if v_claim.status not in ('draft', 'submitted', 'returned') then
    raise exception 'NOT_CANCELLABLE' using detail = '승인·반려·취소된 신청은 직원이 취소할 수 없습니다 (승인 후 정정은 관리자 조정)';
  end if;
  if v_claim.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using detail = '다른 곳에서 먼저 수정되었습니다. 새로 불러오세요';
  end if;

  update public.trip_claims set
    status     = 'cancelled',
    version    = version + 1,
    updated_at = now()
  where id = p_claim_id
  returning * into v_claim;
  return v_claim;
end;
$$;


-- ============================================================
-- 5. trip_invite_companions — 동행 초안 보내기 (service.ts inviteCompanions)
-- ============================================================
--   동행자마다 자기 건(origin='companion_draft', 같은 group_id)을 draft 로 만든다. 제출은 각자.
--   복사 규칙은 서버 함수 _trip_companion_copy 로 강제 (클라이언트가 점심·휴게를 끼워 넣지 못함).
--   v2: 계산 결과(p_calcs)를 받지 않는다 (v1 의 _trip_apply_calcs 삭제에 따른 변경 — 계약 2-2 표에는 없음).
--     동행 초안은 계산 없이 만들어지고, 동행자가 자기 건을 열면 화면이 POST /api/trip-compute 를 부른다
--     (함수는 "본인 건" 이므로 동행자가 호출 가능). 계산이 없으면 trip_submit 이 CALC_STALE_OR_UNTRUSTED 로 막는다.
--   [미확인] 동행자 알림(ot_notifications) 연동은 기존 테이블 쓰기라 이번 초안에서 제외.
create or replace function public.trip_invite_companions(
  p_claim_id uuid,
  p_companion_ids uuid[]
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid;
  v_claim    public.trip_claims;
  v_dates    date[];
  v_cid      uuid;
  v_clash    date;
  v_new_id   uuid;
  v_day      public.trip_claim_days;
  v_created  jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
begin
  perform public.trip_require_feature('employee_form');
  v_uid := public._trip_actor_id();

  select * into v_claim from public.trip_claims where id = p_claim_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = '신청을 찾을 수 없습니다';
  end if;
  if v_claim.employee_id <> v_uid then
    raise exception 'FORBIDDEN' using detail = '본인 신청에서만 동행자를 추가할 수 있습니다';
  end if;
  if v_claim.status not in ('draft', 'submitted', 'returned') then
    raise exception 'NOT_EDITABLE' using detail = '진행 중인 신청에서만 동행자를 추가할 수 있습니다';
  end if;
  v_dates := array(select work_date from public.trip_claim_days where claim_id = p_claim_id and not is_removed);

  for v_cid in select distinct x from unnest(coalesce(p_companion_ids, '{}')) as x loop
    if v_cid = v_claim.employee_id then
      continue;
    end if;
    if not exists (select 1 from public.employees where id = v_cid and is_active = true) then
      v_skipped := v_skipped || jsonb_build_object('employeeId', v_cid, 'reason', '활성 직원이 아님');
      continue;
    end if;
    v_clash := public._trip_conflict_date(v_cid, v_dates, null);
    if v_clash is not null then
      v_skipped := v_skipped || jsonb_build_object('employeeId', v_cid, 'reason', format('%s에 이미 신청한 근무일이 있음', v_clash));
      continue;
    end if;

    v_new_id := gen_random_uuid();
    insert into public.trip_claims (
      id, employee_id, group_id, initiator_id, origin, input_route,
      header, regions, schedule_kind, start_date, end_date, status, version
    ) values (
      v_new_id, v_cid, v_claim.group_id, v_uid, 'companion_draft', 'self',
      v_claim.header, v_claim.regions, v_claim.schedule_kind, v_claim.start_date, v_claim.end_date, 'draft', 1
    );
    for v_day in
      select * from public.trip_claim_days where claim_id = p_claim_id and not is_removed order by work_date
    loop
      perform public._trip_insert_day(v_new_id, v_cid, public._trip_companion_copy(v_day.entry), v_uid);
    end loop;

    v_created := v_created || to_jsonb(v_new_id);
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;


-- ============================================================
-- 6. trip_admin_adjust_day — 관리자 수정 (service.ts adminAdjustDay)
-- ============================================================
--   제출된 건만. 사유 필수. 날짜 변경 금지. 근무일 revision 불일치 → VERSION_CONFLICT.
--   수정 전후 입력을 trip_adjustments 에 남기고(K4 재발 방지), 신청 version 을 올린다
--   (검토 화면이 들고 있던 계산 id 집합이 바뀌므로 뒤이은 승인은 STALE_CALC 로 막힘).
--   v2: 계산 결과(p_calcs)를 받지 않는다 (v1 의 _trip_apply_calcs 삭제에 따른 변경 — 계약 2-2 표에는 없음).
--     흐름은 계약 1절대로 trip_admin_adjust_day → POST /api/trip-compute → trip_review.
--     수정한 날은 revision 이 올라가 기존 계산이 오래된 계산이 되므로, 다시 계산하기 전에는
--     trip_review(approve) 가 STALE_CALC 또는 CALC_STALE_OR_UNTRUSTED 로 막힌다.
--     v1 의 반환(수정한 날의 새 계산 행)과 INCOMPLETE_CALC 검사는 없앴다.
--   반환: { "claimId", "dayId", "revision", "version" } — 화면이 다음 compute·검토에 쓰는 값
--   [미확인] 관리자가 본인 건을 수정하는 것을 막을지. service.ts 는 막지 않음(승인은 SELF_REVIEW 로 막힘).
create or replace function public.trip_admin_adjust_day(
  p_claim_id uuid,
  p_day_id uuid,
  p_expected_revision integer,
  p_entry jsonb,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid;
  v_role  text;
  v_claim public.trip_claims;
  v_day   public.trip_claim_days;
  v_new   public.trip_claim_days;
  v_code  text;
begin
  perform public.trip_require_feature('admin_review');
  v_uid  := public._trip_actor_id();
  v_role := public._trip_actor_role(v_uid);

  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN' using detail = '관리자만 수정할 수 있습니다';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'REASON_REQUIRED' using detail = '수정 사유를 입력하세요';
  end if;

  select * into v_claim from public.trip_claims where id = p_claim_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = '신청을 찾을 수 없습니다';
  end if;
  if v_claim.status <> 'submitted' then
    raise exception 'NOT_EDITABLE' using detail = '제출된 신청만 관리자가 수정할 수 있습니다 (승인 후 정정은 다음 달 조정)';
  end if;

  select * into v_day from public.trip_claim_days
  where id = p_day_id and claim_id = p_claim_id and not is_removed
  for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = '근무일을 찾을 수 없습니다';
  end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using detail = '근무일 입력 형식이 올바르지 않습니다';
  end if;
  if (p_entry ->> 'date') is distinct from to_char(v_day.work_date, 'YYYY-MM-DD') then
    raise exception 'DATE_CHANGE_NOT_ALLOWED' using detail = '근무일 날짜는 바꿀 수 없습니다';
  end if;
  if v_day.revision <> p_expected_revision then
    raise exception 'VERSION_CONFLICT' using detail = format('근무일 %s이 먼저 수정되었습니다', v_day.work_date);
  end if;
  if jsonb_typeof(p_entry -> 'regions') = 'array' then
    for v_code in select jsonb_array_elements_text(p_entry -> 'regions') loop
      if not public._trip_region_valid(v_code, v_day.work_date) then
        raise exception 'INVALID_REGION' using detail = format('알 수 없는 지역입니다: %s', v_code);
      end if;
    end loop;
  end if;

  v_new := public._trip_update_day_entry(v_day.id, p_entry, v_uid);

  insert into public.trip_adjustments (
    day_id, claim_id, admin_id, before_entry, after_entry, from_revision, to_revision, reason
  ) values (
    v_day.id, p_claim_id, v_uid, v_day.entry, p_entry, v_day.revision, v_new.revision, btrim(p_reason)
  );

  update public.trip_claims set version = version + 1, updated_at = now()
  where id = p_claim_id
  returning * into v_claim;

  return jsonb_build_object(
    'claimId',  v_claim.id,
    'dayId',    v_new.id,
    'revision', v_new.revision,
    'version',  v_claim.version
  );
end;
$$;


-- ============================================================
-- 7. trip_review — 승인·반려·되돌림 (service.ts review)
-- ============================================================
--   검사 순서는 service.ts 와 같다:
--     FORBIDDEN → NOT_FOUND → SELF_REVIEW → NOT_SUBMITTED → (INVALID_ARGUMENT) → REASON_REQUIRED
--     → STALE_CALC → (승인만) CALC_STALE_OR_UNTRUSTED → CALC_ERROR → UNRESOLVED_FLAGS
--   v2: 승인은 모든 진행 중 근무일의 최신 계산이 _trip_calc_is_current 일 때만 (계약 2-2).
--       서버 계산이 아니거나, 입력·revision·활성 규칙 버전과 맞지 않으면 CALC_STALE_OR_UNTRUSTED.
--       계산이 아예 없는 근무일도 여기서 걸린다 (STALE_CALC 는 계산이 있는 날의 id 집합만 비교하므로).
--   동시 수정: trip_claims 를 for update 로 잠근 뒤 검사 (보안검토 2-6).
--   trip_reviews 의 calc_ids 소속은 010 트리거(REVIEW_CALC_MISMATCH)가 한 번 더 검사한다.
--   p_flag_decisions: FlagDecision[] = [{ "calcId": uuid, "code": text, "decision": "acknowledged", "note"?: text }]
--   승인일 때만 확인 표시를 acknowledged 로 바꾼다. 반려·되돌림 때 보낸 결정은 검토 기록에만 남긴다
--   (service.ts 는 매 검토마다 결정을 새로 요구하므로, 되돌림 후 재제출 시 다시 확인해야 함).
--   [미확인] K5(승인 취소 시 승인 칼럼 잔존) 대응 RPC(trip_revoke_approval)는 정산 단계와 함께 설계.
create or replace function public.trip_review(
  p_claim_id uuid,
  p_action text,
  p_expected_calc_ids uuid[],
  p_flag_decisions jsonb default '[]'::jsonb,
  p_reason text default null
)
returns public.trip_claims
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid;
  v_role       text;
  v_claim      public.trip_claims;
  v_current    uuid[];
  v_expected   uuid[];
  v_unresolved text;
  v_stale      text;
  v_review_id  uuid;
  v_decisions  jsonb := coalesce(p_flag_decisions, '[]'::jsonb);
begin
  perform public.trip_require_feature('admin_review');
  v_uid  := public._trip_actor_id();
  v_role := public._trip_actor_role(v_uid);

  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN' using detail = '관리자만 검토할 수 있습니다';
  end if;

  select * into v_claim from public.trip_claims where id = p_claim_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = '신청을 찾을 수 없습니다';
  end if;
  if v_claim.employee_id = v_uid then
    raise exception 'SELF_REVIEW' using detail = '본인 신청은 직접 검토할 수 없습니다';
  end if;
  if v_claim.status <> 'submitted' then
    raise exception 'NOT_SUBMITTED' using detail = '제출된 신청만 검토할 수 있습니다';
  end if;
  if p_action is null or p_action not in ('approve', 'reject', 'return') then
    raise exception 'INVALID_ARGUMENT' using detail = '검토 동작은 approve / reject / return 중 하나입니다';
  end if;
  if p_action <> 'approve' and length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'REASON_REQUIRED' using detail = '반려·되돌림 사유를 입력하세요';
  end if;
  if jsonb_typeof(v_decisions) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using detail = '확인 표시 처리 형식이 올바르지 않습니다';
  end if;

  -- 화면에 보였던 계산 결과 집합과 지금의 최신 계산 결과 집합이 같아야 한다
  v_current  := public._trip_latest_calc_ids(p_claim_id);
  v_expected := array(select distinct x from unnest(coalesce(p_expected_calc_ids, '{}')) as x order by x);
  if v_current is distinct from v_expected then
    raise exception 'STALE_CALC' using detail = '화면을 연 뒤 계산 결과가 바뀌었습니다. 새로 불러온 뒤 다시 검토하세요';
  end if;

  if p_action = 'approve' then
    -- 서버 계산이 현재 입력·활성 규칙 버전과 맞는지 (계산 없는 날 포함)
    select string_agg(to_char(d.work_date, 'YYYY-MM-DD'), ', ' order by d.work_date) into v_stale
    from public.trip_claim_days d
    where d.claim_id = p_claim_id and not d.is_removed
      and not public._trip_calc_is_current(d);
    if v_stale is not null then
      raise exception 'CALC_STALE_OR_UNTRUSTED'
        using detail = format('서버 계산이 없거나 지금 입력과 맞지 않는 날이 있습니다. 다시 계산한 뒤 검토하세요: %s', v_stale);
    end if;

    -- 계산 실패 또는 근무일 현재 입력과 맞지 않는(오래된) 계산이 하나라도 있으면 승인 불가
    if exists (
      select 1
      from public.trip_day_calcs c
      join public.trip_claim_days d on d.id = c.day_id
      where c.id = any(v_current)
        and (not c.result_ok or c.missing_count > 0 or c.day_revision <> d.revision)
    ) then
      raise exception 'CALC_ERROR' using detail = '계산되지 않은 근무일이 있어 승인할 수 없습니다';
    end if;

    select string_agg(f.calc_id::text || ':' || f.code, ', ' order by f.calc_id, f.code) into v_unresolved
    from public.trip_review_flags f
    where f.calc_id = any(v_current)
      and f.state = 'open'
      and not exists (
        select 1 from jsonb_array_elements(v_decisions) d
        where d ->> 'calcId' = f.calc_id::text
          and d ->> 'code' = f.code
          and d ->> 'decision' = 'acknowledged'
      );
    if v_unresolved is not null then
      raise exception 'UNRESOLVED_FLAGS' using detail = format('확인하지 않은 표시가 있습니다: %s', v_unresolved);
    end if;
  end if;

  insert into public.trip_reviews (claim_id, admin_id, action, calc_ids, flag_decisions, reason, claim_version)
  values (p_claim_id, v_uid, p_action, v_current, v_decisions, nullif(btrim(coalesce(p_reason, '')), ''), v_claim.version)
  returning id into v_review_id;

  if p_action = 'approve' then
    update public.trip_review_flags f set
      state      = 'acknowledged',
      note       = (
        select d ->> 'note' from jsonb_array_elements(v_decisions) d
        where d ->> 'calcId' = f.calc_id::text and d ->> 'code' = f.code
        limit 1
      ),
      review_id  = v_review_id,
      decided_by = v_uid,
      decided_at = now()
    where f.calc_id = any(v_current) and f.state = 'open';
  end if;

  update public.trip_claims set
    status     = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'returned' end,
    version    = version + 1,
    updated_at = now()
  where id = p_claim_id
  returning * into v_claim;

  -- [미확인] 기존 approval_history 기록 여부: 운영 DB 에 테이블은 있으나 마이그레이션 파일에 정의가 없어
  --          FK·칼럼 타입(request_type 허용값 등)을 확인할 수 없음 → 대조-체크리스트 C-4 확인 후 결정.
  --          그 전까지 출장 검토 이력은 trip_reviews 만 사용.
  return v_claim;
end;
$$;


-- ============================================================
-- 실행 권한
--   내부 보조 함수: 클라이언트 실행 불가 (공개 RPC 는 SECURITY DEFINER 소유자 권한으로 호출)
--   공개 RPC: authenticated 만 (anon 불가)
--   서버 계산 저장(trip_store_server_calcs): service_role 만 (계약 2-2). anon·authenticated 는 EXECUTE 없음.
--   [미확인] Supabase 는 public 스키마 새 함수에 anon·authenticated·service_role 로 직접 EXECUTE 를 주는
--            기본 권한(default privileges)을 쓸 수 있다 → 그래서 public 뿐 아니라 anon·authenticated 도 명시해 회수.
--            service_role 의 함수 실행 권한은 아래 grant 로 명시 (대조-체크리스트 C-8·C-11).
-- ============================================================
revoke all on function public._trip_actor_id()                                         from public, anon, authenticated;
revoke all on function public._trip_actor_role(uuid)                                   from public, anon, authenticated;
revoke all on function public._trip_region_valid(text, date)                           from public, anon, authenticated;
revoke all on function public._trip_parse_header(jsonb)                                from public, anon, authenticated;
revoke all on function public._trip_validate_entries(jsonb, date, date)                from public, anon, authenticated;
revoke all on function public._trip_conflict_date(uuid, date[], uuid)                  from public, anon, authenticated;
revoke all on function public._trip_record_actual(public.trip_claim_days, uuid)        from public, anon, authenticated;
revoke all on function public._trip_insert_day(uuid, uuid, jsonb, uuid)                from public, anon, authenticated;
revoke all on function public._trip_update_day_entry(uuid, jsonb, uuid)                from public, anon, authenticated;
revoke all on function public._trip_calc_is_current(public.trip_claim_days)            from public, anon, authenticated;
revoke all on function public._trip_latest_calc_ids(uuid)                              from public, anon, authenticated;
revoke all on function public._trip_companion_copy(jsonb)                              from public, anon, authenticated;
revoke all on function public.trip_clock_to_min(text, boolean)                         from public, anon;
grant execute on function public.trip_clock_to_min(text, boolean)                      to authenticated;

-- 활성 규칙 버전: 화면(미리보기 버전 표시)·서버 함수(배포 불일치 검사)가 읽는다. 값 자체는 비밀 아님
revoke all on function public.trip_active_rule_version()                               from public, anon;
grant execute on function public.trip_active_rule_version()                            to authenticated, service_role;

-- 서버 계산 저장: service_role 전용
revoke all on function public.trip_store_server_calcs(uuid, integer, text, jsonb, uuid)    from public, anon, authenticated;
grant execute on function public.trip_store_server_calcs(uuid, integer, text, jsonb, uuid) to service_role;

revoke all on function public.trip_create_claim(jsonb, jsonb, uuid)                    from public, anon;
grant execute on function public.trip_create_claim(jsonb, jsonb, uuid)                 to authenticated;
revoke all on function public.trip_update_draft(uuid, integer, jsonb, jsonb)           from public, anon;
grant execute on function public.trip_update_draft(uuid, integer, jsonb, jsonb)        to authenticated;
revoke all on function public.trip_submit(uuid, integer)                               from public, anon;
grant execute on function public.trip_submit(uuid, integer)                            to authenticated;
revoke all on function public.trip_cancel(uuid, integer)                               from public, anon;
grant execute on function public.trip_cancel(uuid, integer)                            to authenticated;
revoke all on function public.trip_invite_companions(uuid, uuid[])                     from public, anon;
grant execute on function public.trip_invite_companions(uuid, uuid[])                  to authenticated;
revoke all on function public.trip_admin_adjust_day(uuid, uuid, integer, jsonb, text)    from public, anon;
grant execute on function public.trip_admin_adjust_day(uuid, uuid, integer, jsonb, text) to authenticated;
revoke all on function public.trip_review(uuid, text, uuid[], jsonb, text)             from public, anon;
grant execute on function public.trip_review(uuid, text, uuid[], jsonb, text)          to authenticated;

-- ============================================================
-- 적용 후 단언. 하나라도 어긋나면 예외로 전체를 취소한다.
-- ============================================================
do $post$
declare
  v_n int;
  names text[];
  expected text[] := array[
    'trip_active_rule_version', 'trip_admin_adjust_day',
    'trip_can_view_all', 'trip_cancel', 'trip_clock_to_min',
    'trip_create_claim', 'trip_feature_enabled', 'trip_has_view_grant',
    'trip_invite_companions', 'trip_is_admin', 'trip_review',
    'trip_set_feature', 'trip_set_view_grant', 'trip_submit',
    'trip_update_draft', 'trip_view_grant_candidates',
    'trip_view_grant_eligible'];
  b record;
begin
  for b in select t, n from trip_apply_before loop
    if b.t = 'employees' then
      select count(*) into v_n from public.employees;
    elsif b.t = 'employees_active' then
      select count(*) into v_n from public.employees where is_active;
    elsif b.t = 'employees_inactive' then
      select count(*) into v_n from public.employees where not is_active;
    elsif b.t = 'overtime_requests' then
      select count(*) into v_n from public.overtime_requests;
    elsif b.t = 'payslips' then
      select count(*) into v_n from public.payslips;
    else
      continue;
    end if;
    if v_n <> b.n then
      raise exception 'POSTCONDITION rows_changed % before=% after=%',
        b.t, b.n, v_n;
    end if;
  end loop;
  select count(*) into v_n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'POSTCONDITION anon_can_execute_definer count=%', v_n;
  end if;
  select count(*) into v_n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public'
    and (p.proname like 'trip\_%' or p.proname like '\_trip\_%')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or exists (select 1 from aclexplode(
              coalesce(p.proacl, acldefault('f', p.proowner))) a
            where a.grantee = 0));
  if v_n <> 0 then
    raise exception 'POSTCONDITION trip_function_open_to_anon_or_public count=%', v_n;
  end if;
  select count(*) into v_n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prosecdef
    and (p.proname like 'trip\_%' or p.proname like '\_trip\_%')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                    where c like 'search_path=%');
  if v_n <> 0 then
    raise exception 'POSTCONDITION definer_without_search_path count=%', v_n;
  end if;
  select array_agg(p.proname::text order by p.proname) into names
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public'
    and (p.proname like 'trip\_%' or p.proname like '\_trip\_%')
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if names is distinct from expected then
    raise exception 'POSTCONDITION authenticated_function_set_differs %', names;
  end if;
  select count(*) into v_n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r'
    and (c.relname like 'trip\_%' or c.relname = 'holidays')
    and not c.relrowsecurity;
  if v_n <> 0 then
    raise exception 'POSTCONDITION table_without_rls count=%', v_n;
  end if;
  select count(*) into v_n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind in ('r', 'v')
    and (c.relname like 'trip\_%' or c.relname = 'holidays')
    and (has_table_privilege('anon', c.oid, 'SELECT')
         or has_table_privilege('authenticated', c.oid, 'INSERT')
         or has_table_privilege('authenticated', c.oid, 'UPDATE')
         or has_table_privilege('authenticated', c.oid, 'DELETE')
         or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
  if v_n <> 0 then
    raise exception 'POSTCONDITION table_privileges_too_open count=%', v_n;
  end if;
  select count(*) into v_n from public.trip_feature_flags where enabled;
  if v_n <> 0 then
    raise exception 'POSTCONDITION feature_flag_enabled count=%', v_n;
  end if;
  if has_table_privilege('authenticated', 'public.employees', 'DELETE')
     or has_table_privilege('anon', 'public.employees', 'SELECT') then
    raise exception 'POSTCONDITION employees_privileges_changed';
  end if;
end $post$;
select
  (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r'
      and (c.relname like 'trip\_%' or c.relname = 'holidays')) as new_tables,
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public'
      and (p.proname like 'trip\_%' or p.proname like '\_trip\_%')) as new_functions,
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prosecdef) as definer_functions_now,
  (select n from trip_apply_before where t = 'definer_functions') as definer_functions_before,
  (select count(*) from public.trip_feature_flags where enabled) as flags_on,
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_can_execute;
commit;

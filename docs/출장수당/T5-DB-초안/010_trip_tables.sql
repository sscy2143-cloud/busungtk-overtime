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
  for each row execute function update_updated_at_column();

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

-- updated_at 은 RPC 가 명시적으로 넣지만, 누락 방지용으로 기존 공통 트리거 함수를 재사용한다.
create trigger trip_claims_updated_at
  before update on public.trip_claims
  for each row execute function update_updated_at_column();

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
  for each row execute function update_updated_at_column();

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

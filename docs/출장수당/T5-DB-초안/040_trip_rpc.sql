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
--
-- 예외 형식: raise exception '<코드>' using detail = '<한국어 안내>'
--   PostgREST 응답의 message = 코드, details = 안내. 클라이언트는 service.ts 의 Result.code 와 같은 코드로 매핑.
--
-- ⚠ 계산 신뢰 문제 (README "위험" 절 참고)
--   계산 엔진은 TypeScript(src/features/trip/engine)라 이 RPC 는 서버에서 다시 계산하지 않는다.
--   클라이언트가 보낸 계산 결과(p_calcs)를 "형식·소속·버전"만 검사하고 저장한다.
--   즉 조작된 클라이언트는 입력과 맞지 않는 시간을 보낼 수 있다.
--   완화: (1) 입력 사본(entry_snapshot)은 클라이언트 값이 아니라 서버가 저장한 근무일 입력에서 복사
--         (2) 관리자 검토 화면이 entry_snapshot 으로 엔진을 다시 돌려 불일치를 표시 (T6/T7 과제)
--         (3) 근본 대안: Supabase Edge Function 에서 같은 엔진을 실행해 engine_source='edge' 로 저장
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
  -- [미확인] 숙박 기간 상한. service.ts 에는 없음. 오입력(연도 오타) 방지용 임시 상한 31일
  if o_end - o_start > 31 then
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
    public.trip_clock_to_min(p_day.entry #>> '{actual,arriveAt}'),
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

-- 계산 결과 1건 저장 (TripCalcRecord). 직전 결과와 같으면 새로 만들지 않고 기존 id 반환
--   (service.ts recompute: 승인 묶음이 불필요하게 깨지지 않게)
-- p_calc 형식 (클라이언트 엔진 결과, id·claimId·dayId·dayRevision·computedAt 은 서버가 정함):
--   { "ruleVersion": "...", "classification": {...}, "engineInput": {...}|null,
--     "result": {...}|null, "carryOut": {...}?, "carryIn": {...}? }
create or replace function public._trip_store_calc(p_day public.trip_claim_days, p_calc jsonb, p_actor uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_latest  public.trip_day_calcs;
  v_id      uuid;
  v_rule    text;
  v_cls     jsonb;
  v_input   jsonb;
  v_result  jsonb;
  v_cin     jsonb;
  v_cout    jsonb;
  v_ok      boolean;
  v_codes   text[];
begin
  if p_calc is null or jsonb_typeof(p_calc) <> 'object' then
    raise exception 'INVALID_CALC' using detail = format('%s 계산 결과 형식이 올바르지 않습니다', p_day.work_date);
  end if;

  v_rule   := p_calc ->> 'ruleVersion';
  v_cls    := p_calc -> 'classification';
  v_input  := nullif(p_calc -> 'engineInput', 'null'::jsonb);
  v_result := nullif(p_calc -> 'result',      'null'::jsonb);
  v_cin    := nullif(p_calc -> 'carryIn',     'null'::jsonb);
  v_cout   := nullif(p_calc -> 'carryOut',    'null'::jsonb);

  if v_rule is null or not exists (select 1 from public.trip_rule_versions where version = v_rule) then
    raise exception 'UNKNOWN_RULE_VERSION' using detail = format('등록되지 않은 규칙 버전입니다: %s', coalesce(v_rule, '(없음)'));
  end if;
  -- [미확인] 근무일에 적용되는 규칙 버전인지(effective_from/to) 검사. 시행일 미정이라 지금은 존재만 검사
  if jsonb_typeof(v_cls) is distinct from 'object'
     or jsonb_typeof(v_cls -> 'missing') is distinct from 'array'
     or jsonb_typeof(v_cls -> 'notices') is distinct from 'array' then
    raise exception 'INVALID_CALC' using detail = format('%s 분류 결과 형식이 올바르지 않습니다', p_day.work_date);
  end if;

  v_ok := coalesce((v_result ->> 'ok')::boolean, false);
  if v_ok and (v_result ->> 'ruleVersion') is distinct from v_rule then
    raise exception 'CALC_RULE_MISMATCH' using detail = '계산 결과의 규칙 버전이 맞지 않습니다';
  end if;

  -- 직전 결과와 같으면 재사용
  select * into v_latest
  from public.trip_day_calcs
  where day_id = p_day.id
  order by seq desc
  limit 1;
  if found
     and v_latest.day_revision = p_day.revision
     and v_latest.rule_version = v_rule
     and v_latest.classification = v_cls
     and v_latest.engine_input is not distinct from v_input
     and v_latest.result is not distinct from v_result
     and v_latest.carry_in is not distinct from v_cin
     and v_latest.carry_out is not distinct from v_cout then
    return v_latest.id;
  end if;

  -- 확인 표시 코드 = 엔진 flags + 다음 날 기록 누락 (service.ts reviewItems)
  v_codes := array(
    select distinct x from (
      select f ->> 'code' as x
      from jsonb_array_elements(case when v_ok then coalesce(v_result -> 'flags', '[]'::jsonb) else '[]'::jsonb end) f
      union
      select n ->> 'code'
      from jsonb_array_elements(v_cls -> 'notices') n
      where n ->> 'code' = 'NEXT_DAY_ENTRY_MISSING'
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
    p_day.claim_id, p_day.id, p_day.revision, v_rule,
    p_day.entry,                                   -- 서버가 가진 입력 사본 (클라이언트 값 아님)
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
    'client',
    p_actor
  )
  returning id into v_id;

  insert into public.trip_review_flags (calc_id, claim_id, code)
  select v_id, p_day.claim_id, c from unnest(v_codes) as c;

  return v_id;
end;
$$;

-- 신청의 진행 중 근무일 전부에 계산 결과 저장
--   p_calcs: { "YYYY-MM-DD": <p_calc>, ... }. 키가 없는 날은 저장하지 않음 (제출 단계에서 INCOMPLETE)
create or replace function public._trip_apply_calcs(p_claim_id uuid, p_calcs jsonb, p_actor uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_day public.trip_claim_days;
begin
  if p_calcs is null or p_calcs = '{}'::jsonb then
    return;
  end if;
  if jsonb_typeof(p_calcs) <> 'object' then
    raise exception 'INVALID_CALC' using detail = '계산 결과 묶음 형식이 올바르지 않습니다';
  end if;
  for v_key in select jsonb_object_keys(p_calcs) loop
    if not exists (
      select 1 from public.trip_claim_days
      where claim_id = p_claim_id and not is_removed and to_char(work_date, 'YYYY-MM-DD') = v_key
    ) then
      raise exception 'DATE_OUT_OF_SCHEDULE' using detail = format('%s 계산 결과에 해당하는 근무일이 없습니다', v_key);
    end if;
  end loop;
  for v_day in
    select * from public.trip_claim_days
    where claim_id = p_claim_id and not is_removed
    order by work_date
  loop
    if p_calcs ? to_char(v_day.work_date, 'YYYY-MM-DD') then
      perform public._trip_store_calc(v_day, p_calcs -> to_char(v_day.work_date, 'YYYY-MM-DD'), p_actor);
    end if;
  end loop;
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
--   p_calcs       : { "YYYY-MM-DD": 계산 결과 } — 미리보기 엔진 결과
--   p_employee_id : 대리 작성 대상 (admin 만). null 이면 본인
create or replace function public.trip_create_claim(
  p_header jsonb,
  p_entries jsonb,
  p_calcs jsonb default '{}'::jsonb,
  p_employee_id uuid default null
)
returns public.trip_claims
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

  perform public._trip_apply_calcs(v_id, p_calcs, v_uid);

  select * into v_claim from public.trip_claims where id = v_id;
  return v_claim;
end;
$$;


-- ============================================================
-- 2. trip_update_draft — 초안·되돌림 건 수정 (service.ts updateDraft)
-- ============================================================
--   p_header / p_entries 가 null 이면 기존 값 유지.
--   p_entries 에서 빠진 날은 is_removed 표시 (계산 결과가 참조하므로 물리 삭제 안 함).
create or replace function public.trip_update_draft(
  p_claim_id uuid,
  p_expected_version integer,
  p_header jsonb default null,
  p_entries jsonb default null,
  p_calcs jsonb default '{}'::jsonb
)
returns public.trip_claims
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

  perform public._trip_apply_calcs(p_claim_id, p_calcs, v_uid);

  select * into v_claim from public.trip_claims where id = p_claim_id;
  return v_claim;
end;
$$;


-- ============================================================
-- 3. trip_submit — 제출 (service.ts submit)
-- ============================================================
--   모든 진행 중 근무일에 "현재 revision 의 최신 계산 결과"가 있고, 입력 누락이 없고, 계산이 성공해야 한다.
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

  select string_agg(to_char(d.work_date, 'YYYY-MM-DD'), ', ' order by d.work_date) into v_blocked
  from public.trip_claim_days d
  left join lateral (
    select * from public.trip_day_calcs c where c.day_id = d.id order by c.seq desc limit 1
  ) lc on true
  where d.claim_id = p_claim_id and not d.is_removed
    and (lc.id is null or lc.day_revision <> d.revision or lc.missing_count > 0 or not lc.result_ok);
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
--   p_calcs: { "<동행자 uuid>": { "YYYY-MM-DD": 계산 결과 } } — 선택.
--     없으면 계산 결과 없이 만들어지고, 동행자가 열어서 저장(trip_update_draft)할 때 계산된다.
--     계산이 없으면 trip_submit 이 INCOMPLETE 로 막으므로 미계산 초안이 정산될 수 없다.
--   [미확인] 동행자 알림(ot_notifications) 연동은 기존 테이블 쓰기라 이번 초안에서 제외.
create or replace function public.trip_invite_companions(
  p_claim_id uuid,
  p_companion_ids uuid[],
  p_calcs jsonb default '{}'::jsonb
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
  if p_calcs is not null and jsonb_typeof(p_calcs) <> 'object' then
    raise exception 'INVALID_CALC' using detail = '계산 결과 묶음 형식이 올바르지 않습니다';
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
    perform public._trip_apply_calcs(v_new_id, coalesce(p_calcs -> v_cid::text, '{}'::jsonb), v_uid);

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
--   p_calcs: 수정 후 신청 전체 재계산 결과 { "YYYY-MM-DD": 계산 결과 }.
--     수정한 날의 새 revision 계산 결과는 필수 (없으면 INCOMPLETE_CALC).
--   [미확인] 관리자가 본인 건을 수정하는 것을 막을지. service.ts 는 막지 않음(승인은 SELF_REVIEW 로 막힘).
create or replace function public.trip_admin_adjust_day(
  p_claim_id uuid,
  p_day_id uuid,
  p_expected_revision integer,
  p_entry jsonb,
  p_reason text,
  p_calcs jsonb
)
returns public.trip_day_calcs
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid;
  v_role  text;
  v_claim public.trip_claims;
  v_day   public.trip_claim_days;
  v_new   public.trip_claim_days;
  v_calc  public.trip_day_calcs;
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

  update public.trip_claims set version = version + 1, updated_at = now() where id = p_claim_id;

  perform public._trip_apply_calcs(p_claim_id, p_calcs, v_uid);

  select * into v_calc from public.trip_day_calcs where day_id = v_day.id order by seq desc limit 1;
  if not found or v_calc.day_revision <> v_new.revision then
    raise exception 'INCOMPLETE_CALC' using detail = '수정한 근무일의 다시 계산한 결과가 없습니다';
  end if;
  return v_calc;
end;
$$;


-- ============================================================
-- 7. trip_review — 승인·반려·되돌림 (service.ts review)
-- ============================================================
--   검사 순서는 service.ts 와 같다:
--     FORBIDDEN → NOT_FOUND → SELF_REVIEW → NOT_SUBMITTED → (INVALID_ARGUMENT) → REASON_REQUIRED
--     → STALE_CALC → (승인만) CALC_ERROR → UNRESOLVED_FLAGS
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
revoke all on function public._trip_store_calc(public.trip_claim_days, jsonb, uuid)    from public, anon, authenticated;
revoke all on function public._trip_apply_calcs(uuid, jsonb, uuid)                     from public, anon, authenticated;
revoke all on function public._trip_latest_calc_ids(uuid)                              from public, anon, authenticated;
revoke all on function public._trip_companion_copy(jsonb)                              from public, anon, authenticated;
revoke all on function public.trip_clock_to_min(text, boolean)                         from public, anon;
grant execute on function public.trip_clock_to_min(text, boolean)                      to authenticated;

revoke all on function public.trip_create_claim(jsonb, jsonb, jsonb, uuid)             from public, anon;
grant execute on function public.trip_create_claim(jsonb, jsonb, jsonb, uuid)          to authenticated;
revoke all on function public.trip_update_draft(uuid, integer, jsonb, jsonb, jsonb)    from public, anon;
grant execute on function public.trip_update_draft(uuid, integer, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.trip_submit(uuid, integer)                               from public, anon;
grant execute on function public.trip_submit(uuid, integer)                            to authenticated;
revoke all on function public.trip_cancel(uuid, integer)                               from public, anon;
grant execute on function public.trip_cancel(uuid, integer)                            to authenticated;
revoke all on function public.trip_invite_companions(uuid, uuid[], jsonb)              from public, anon;
grant execute on function public.trip_invite_companions(uuid, uuid[], jsonb)           to authenticated;
revoke all on function public.trip_admin_adjust_day(uuid, uuid, integer, jsonb, text, jsonb)    from public, anon;
grant execute on function public.trip_admin_adjust_day(uuid, uuid, integer, jsonb, text, jsonb) to authenticated;
revoke all on function public.trip_review(uuid, text, uuid[], jsonb, text)             from public, anon;
grant execute on function public.trip_review(uuid, text, uuid[], jsonb, text)          to authenticated;

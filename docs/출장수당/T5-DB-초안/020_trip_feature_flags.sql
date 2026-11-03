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
--   admin 이 특정 직원(팀장)을 골라 "전체 출장 내역 조회" 를 부여·회수한다. 기본값: 아무도 없음.
--   - 직급 칼럼이 운영 employees 에 없으므로(11-03 대조: role·employee_type 뿐) 부여 대상은
--     "활성 직원 중 admin 이 아닌 사람" 이다. 팀장 여부는 admin 이 판단한다. 직급 칼럼이 생기면
--     trip_view_grant_eligible() 한 곳만 좁히면 된다.
--   - 부여되는 것은 SELECT(030 의 *_select_admin 정책이 trip_can_view_all() 을 통해 허용)뿐.
--     수정·승인·반려·급여 반영 RPC 는 040 이 role='admin' 만 받으므로 그대로 막힌다.
--   - 퇴사·비활성화(is_active=false)·admin 승격 시 trip_has_view_grant() 가 false 가 되어 즉시 막힌다.
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
  action       text not null check (action in ('grant', 'revoke')),
  changed_by   uuid not null references public.employees(id) on delete restrict,
  note         text not null default '',
  changed_at   timestamptz not null default now()
);

create index idx_trip_view_grant_history_emp on public.trip_view_grant_history(employee_id, changed_at desc);

create trigger trip_view_grant_history_append_only
  before update or delete on public.trip_view_grant_history
  for each row execute function public.trip_append_only();

-- 부여 대상인가: 활성 직원이고 admin 이 아닌 사람 (직급 칼럼이 생기면 여기만 좁힌다)
create or replace function public.trip_view_grant_eligible(p_employee uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee and e.is_active = true and e.role <> 'admin'
  )
$$;

-- 지금 로그인한 사람에게 유효한 조회 권한이 있는가 (행이 있어도 비활성·admin 이면 false)
create or replace function public.trip_has_view_grant()
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.trip_view_grants g
    join public.employees e on e.id = g.employee_id
    where g.employee_id = auth.uid() and e.is_active = true and e.role <> 'admin'
  )
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
      raise exception 'NOT_FOUND' using detail = '활성 직원이 아니거나 관리자(admin)라 부여 대상이 아닙니다';
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
revoke all on function public.trip_set_view_grant(uuid, boolean, text)   from public, anon;
grant execute on function public.trip_set_view_grant(uuid, boolean, text) to authenticated;

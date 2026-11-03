-- ⚠ 초안. 실행 금지. 근태관리 Supabase(wvwbaqyxztgcrkiacvql)는 일시정지 상태이며 재개·적용은 사용자 승인 후.
-- 적용 전 필수: 운영 스키마 읽기 전용 대조 (HANDOFF 9절), 롤백 SQL 검증, 스테이징 없음 → 트랜잭션 단위 적용.
-- ============================================================
-- 출장수당 030: RLS
--
-- 원칙
--   - 직원: 본인 행 SELECT 만.
--   - 관리자(admin 만): SELECT 전체. manager 는 출장 기능에서 직원과 같다 (본인 건만) — 11-03 사용자 기준.
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

create or replace function public.trip_can_view_all()
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

-- ------------------------------------------------------------
-- 직접 쓰기 권한 회수 (RLS 와 이중 방어). SELECT 권한은 RLS 정책으로 거른다.
-- Supabase 기본값은 public 스키마 새 테이블에 anon/authenticated 전체 권한을 준다.
-- ------------------------------------------------------------
revoke all on table
  public.trip_rule_versions, public.trip_regions, public.holidays,
  public.trip_claims, public.trip_claim_days, public.trip_actual_times,
  public.trip_day_calcs, public.trip_adjustments, public.trip_reviews, public.trip_review_flags,
  public.trip_feature_flags, public.trip_feature_flag_history
from anon, authenticated;

grant select on table
  public.trip_rule_versions, public.trip_regions, public.holidays,
  public.trip_claims, public.trip_claim_days, public.trip_actual_times,
  public.trip_day_calcs, public.trip_adjustments, public.trip_reviews, public.trip_review_flags,
  public.trip_feature_flags, public.trip_feature_flag_history
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

-- 스위치 변경 이력: admin 만
create policy "trip_feature_flag_history_select_admin"
  on public.trip_feature_flag_history for select to authenticated
  using (public.trip_can_view_all());

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

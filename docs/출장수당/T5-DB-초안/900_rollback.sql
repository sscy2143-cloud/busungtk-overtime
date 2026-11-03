-- ⚠ 초안. 실행 금지. 근태관리 Supabase(wvwbaqyxztgcrkiacvql)는 일시정지 상태이며 재개·적용은 사용자 승인 후.
-- 적용 전 필수: 운영 스키마 읽기 전용 대조 (HANDOFF 9절), 롤백 SQL 검증, 스테이징 없음 → 트랜잭션 단위 적용.
-- ============================================================
-- 출장수당 900: 롤백 (010 → 020 → 030 → 040 전부 되돌림, 역순)
--
-- 기존 테이블 무영향
--   - 010~040 은 기존 테이블에 칼럼·제약·트리거·정책을 추가하지 않았다.
--     따라서 이 롤백은 trip_* 객체와 holidays 만 지운다.
--   - 기존 함수 is_admin(), get_my_role() 등은 출장 객체가 쓰지 않는다 (11-03 부터 update_updated_at_column·is_manager_or_admin 의존도 제거). 지우는 것은 trip_* 와 holidays 뿐.
--   - cascade 를 쓰지 않는다. 예상하지 못한 의존 객체(다른 기능이 출장 테이블을 참조 등)가 있으면
--     조용히 같이 지우지 않고 오류로 멈추게 하기 위함이다.
--
-- holidays 주의
--   - 010 은 `create table holidays` (if not exists 아님) 이므로, 010 이 성공했다면 holidays 는 출장 초안이 만든 것이다.
--   - 단, 출장 적용 뒤 다른 기능이 holidays 를 쓰기 시작했다면 지우면 안 된다 → 아래 사전 점검 1번.
--
-- 데이터 주의
--   - 실제 신청이 들어간 뒤 롤백하면 신청·계산·검토 기록이 사라진다 (3년 보관 대상).
--     운영 중 롤백이 필요하면 먼저 trip_* 테이블을 내보내기(CSV) 한 뒤 사용자 승인을 받는다.
--   - trip_day_calcs 의 수정·삭제 금지 트리거는 DROP TABLE 을 막지 않는다 (DELETE/TRUNCATE 만 막음).
--
-- 사용: begin; \i 900_rollback.sql; (아래 확인 쿼리 결과 점검) commit;   — 문제가 있으면 rollback;
--
-- 자료 보호 (11-03): trip_claims 에 행이 하나라도 있으면 ROLLBACK_BLOCKED_DATA_EXISTS 로 멈춘다.
--   내보내기(CSV·pg_dump)를 마친 뒤 같은 세션에서  select set_config('trip.confirm_drop', 'yes', false);  를 실행하고 다시 돌린다.
--   운영에서 "기능을 끄는 것" 은 이 파일이 아니라 trip_set_feature(…, false) 다 — 표·자료는 그대로 두고 화면·RPC·조회가 전부 막힌다.
-- ============================================================

-- ------------------------------------------------------------
-- 사전 점검 (읽기 전용) — 출장 외 객체가 출장 테이블에 의존하는지
--   결과가 0행이어야 진행. 행이 나오면 중단하고 보고.
-- ------------------------------------------------------------
-- 1) 출장 객체가 아닌 뷰·함수가 holidays / trip_* 를 참조하는지
-- select distinct dependent.relname as dependent_view
-- from pg_depend d
-- join pg_rewrite r on r.oid = d.objid
-- join pg_class dependent on dependent.oid = r.ev_class
-- join pg_class source on source.oid = d.refobjid
-- where source.relname in ('holidays') or source.relname like 'trip\_%'
--   and dependent.relname not like 'trip\_%';
-- 2) 출장 외 테이블이 출장 테이블을 FK 로 참조하는지
-- select conrelid::regclass as from_table, confrelid::regclass as to_table, conname
-- from pg_constraint
-- where contype = 'f'
--   and (confrelid::regclass::text in ('holidays', 'public.holidays') or confrelid::regclass::text like '%trip\_%')
--   and conrelid::regclass::text not like '%trip\_%';

-- ============================================================
-- 040 되돌리기: RPC
-- ============================================================
--   v2(서버 재계산) 시그니처. v1 의 _trip_store_calc / _trip_apply_calcs 는 040 에서 삭제되어 여기서도 뺐다.
--   (v1 은 어떤 DB 에도 적용된 적 없음. v1 롤백은 ../T5-DB-초안_v1_클라이언트계산_백업/900_rollback.sql)
do $$
begin
  if to_regclass('public.trip_claims') is not null
     and exists (select 1 from public.trip_claims)
     and coalesce(current_setting('trip.confirm_drop', true), '') <> 'yes' then
    raise exception 'ROLLBACK_BLOCKED_DATA_EXISTS'
      using detail = '출장 신청 자료가 있습니다. 내보내기를 마친 뒤 set_config(''trip.confirm_drop'', ''yes'', false) 로 확인하고 다시 실행하세요';
  end if;
end
$$;

drop function if exists public.trip_review(uuid, text, uuid[], jsonb, text);
drop function if exists public.trip_admin_adjust_day(uuid, uuid, integer, jsonb, text);
drop function if exists public.trip_invite_companions(uuid, uuid[]);
drop function if exists public.trip_cancel(uuid, integer);
drop function if exists public.trip_submit(uuid, integer);
drop function if exists public.trip_update_draft(uuid, integer, jsonb, jsonb);
drop function if exists public.trip_create_claim(jsonb, jsonb, uuid);

-- 서버 계산 저장·판정 (v2 신규, 만든 순서의 역순)
drop function if exists public.trip_store_server_calcs(uuid, integer, text, jsonb, uuid);
drop function if exists public._trip_calc_is_current(public.trip_claim_days);
drop function if exists public.trip_active_rule_version();

drop function if exists public._trip_companion_copy(jsonb);
drop function if exists public._trip_latest_calc_ids(uuid);
drop function if exists public._trip_update_day_entry(uuid, jsonb, uuid);
drop function if exists public._trip_insert_day(uuid, uuid, jsonb, uuid);
drop function if exists public._trip_record_actual(public.trip_claim_days, uuid);
drop function if exists public._trip_conflict_date(uuid, date[], uuid);
drop function if exists public._trip_validate_entries(jsonb, date, date);
drop function if exists public._trip_parse_header(jsonb);
drop function if exists public._trip_region_valid(text, date);
drop function if exists public._trip_actor_role(uuid);
drop function if exists public._trip_actor_id();

-- ============================================================
-- 020 되돌리기 (1): 테이블 행 형식을 반환하는 함수는 테이블보다 먼저
--   trip_set_feature 는 trip_feature_flags 행을 반환하므로 테이블 삭제 전에 지운다.
-- ============================================================
drop function if exists public.trip_set_feature(text, boolean, text);
drop function if exists public.trip_set_view_grant(uuid, boolean, text);   -- 11-03 조회 권한
drop function if exists public.trip_require_feature(text);

-- ============================================================
-- 030 되돌리기: RLS
--   정책은 테이블과 함께 사라진다.
--   ⚠ 순서 수정(v2): 정책 식이 trip_can_view_all() 과 (v2부터) trip_feature_enabled() 를 참조하므로,
--      cascade 없이 함수를 먼저 지우면 "다른 객체가 의존" 오류로 멈춘다. 두 함수는 테이블 삭제 뒤(맨 아래)에 지운다.
--      (v1 초안은 trip_can_view_all() 을 테이블보다 먼저 지워 같은 오류가 날 수 있었다.)
-- ============================================================

-- ============================================================
-- 020 되돌리기 (2): 기능 스위치 테이블
-- ============================================================
drop table if exists public.trip_feature_flag_history;
drop table if exists public.trip_feature_flags;
-- 11-03 조회 권한 표 — 이력 트리거가 trip_append_only() 를 쓰므로 트리거 함수보다 먼저 지운다
drop table if exists public.trip_view_grant_history;
drop table if exists public.trip_view_grants;

-- ============================================================
-- 010 되돌리기: 테이블 (FK 역순). 트리거·인덱스·정책은 테이블과 함께 삭제됨
--   v2 추가분도 테이블과 함께 사라진다:
--     trip_rule_versions.is_active 칼럼 · uq_trip_rule_versions_active 인덱스
--     trip_day_calcs 수치 CHECK 제약 · engine_source CHECK
--     trip_claim_days_lock 트리거 · trip_reviews_calc_guard 트리거
--   트리거 함수는 아래에서 따로 지운다.
-- ============================================================
drop view  if exists public.trip_latest_day_calcs;
drop table if exists public.trip_review_flags;
drop table if exists public.trip_reviews;
drop table if exists public.trip_adjustments;
drop table if exists public.trip_day_calcs;
drop table if exists public.trip_actual_times;
drop table if exists public.trip_claim_days;
drop table if exists public.trip_claims;
drop table if exists public.holidays;
drop table if exists public.trip_regions;
drop table if exists public.trip_rule_versions;

-- 트리거 함수 (테이블 삭제 뒤)
drop function if exists public.trip_review_flags_guard();
drop function if exists public.trip_reviews_calc_guard();      -- v2
drop function if exists public.trip_append_only();
drop function if exists public.trip_day_calcs_immutable();
drop function if exists public.trip_claims_sync_day_status();
drop function if exists public.trip_claim_days_lock_guard();   -- v2
drop function if exists public.trip_claim_days_before_insert();
drop function if exists public.trip_rule_versions_guard();
drop function if exists public.trip_touch_updated_at();         -- 11-03
drop function if exists public.trip_clock_to_min(text, boolean);

-- 정책이 참조하던 함수 (정책은 위 테이블 삭제로 이미 사라짐)
drop function if exists public.trip_feature_enabled(text);
drop function if exists public.trip_can_view_all();
drop function if exists public.trip_has_view_grant();                      -- 11-03 조회 권한
drop function if exists public.trip_view_grant_eligible(uuid);
drop function if exists public.trip_is_admin();

-- ============================================================
-- 확인 (읽기 전용) — commit 전에 실행
-- ============================================================
-- 1) 출장 객체가 남지 않았는지: 0행이어야 함
-- select 'table' as kind, table_name as name from information_schema.tables
--  where table_schema = 'public' and (table_name like 'trip\_%' or table_name = 'holidays')
-- union all
-- select 'function', p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and (p.proname like 'trip\_%' or p.proname like '\_trip\_%');
--
-- 2) 기존 공통 함수가 그대로 있는지: 4행이어야 함 (has_admin_permission 은 20260916 적용 시에만 존재)
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and proname in ('update_updated_at_column', 'is_manager_or_admin', 'is_admin', 'get_my_role');
--
-- 3) 기존 테이블 정책 수가 적용 전 기록(대조-체크리스트 C-3 결과)과 같은지
-- select tablename, count(*) from pg_policies where schemaname = 'public' group by tablename order by tablename;

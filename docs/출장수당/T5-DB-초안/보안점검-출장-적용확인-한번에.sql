-- READ ONLY. 출장수당 DB(005·010·020·030·040)가 운영에 적용돼 있는지 한 결과로 확인. 아무것도 바꾸지 않는다.
-- 출장 표가 아직 없어도 오류 없이 돈다(to_regclass). 이름·금액·신청 내용은 읽지 않고 건수만 본다.
-- 기대값: applied=true, tables_present=14, tables_missing=[], rls_off=[], anon_table_select=[],
--        anon_trip_exec=[], flags 3개 모두 false, payroll_lock=true, trip_claims_rows=0 (기능 OFF 상태)
begin read only;
select jsonb_pretty(jsonb_build_object(
  'applied', to_regclass('public.trip_feature_flags') is not null,
  'tables_present', (select count(*) from unnest(array['holidays','trip_actual_times','trip_adjustments','trip_claim_days','trip_claims',
      'trip_day_calcs','trip_feature_flag_history','trip_feature_flags','trip_regions','trip_review_flags','trip_reviews',
      'trip_rule_versions','trip_view_grant_history','trip_view_grants']) t where to_regclass('public.' || t) is not null),
  'tables_missing', (select coalesce(jsonb_agg(t order by t), '[]'::jsonb) from unnest(array['holidays','trip_actual_times','trip_adjustments',
      'trip_claim_days','trip_claims','trip_day_calcs','trip_feature_flag_history','trip_feature_flags','trip_regions','trip_review_flags',
      'trip_reviews','trip_rule_versions','trip_view_grant_history','trip_view_grants']) t where to_regclass('public.' || t) is null),
  'rls_off', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and (c.relname like 'trip\_%' or c.relname = 'holidays') and not c.relrowsecurity),
  'anon_table_select', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v') and (c.relname like 'trip\_%' or c.relname = 'holidays')
        and has_table_privilege('anon', c.oid, 'SELECT')),
  'trip_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'trip\_%' or p.proname like '\_trip\_%')),
  'anon_trip_exec', (select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'trip\_%' or p.proname like '\_trip\_%') and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'flags', case when to_regclass('public.trip_feature_flags') is null then null
      else (xpath('//row/f/text()', query_to_xml('select coalesce(jsonb_object_agg(key, enabled), ''{}''::jsonb)::text as f from public.trip_feature_flags', false, false, '')))[1]::text::jsonb end,
  'payroll_lock', exists (select 1 from pg_constraint where conname = 'trip_feature_flags_payroll_locked'),
  'trip_claims_rows', case when to_regclass('public.trip_claims') is null then null
      else (xpath('//row/n/text()', query_to_xml('select count(*) as n from public.trip_claims', false, false, '')))[1]::text::int end,
  'employees_position_column', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'employees' and column_name = 'position')
)) as trip_apply_check;
rollback;

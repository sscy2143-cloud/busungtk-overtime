-- READ ONLY. 015 적용 전 점검을 한 결과로 모은 것. 아무것도 바꾸지 않는다.
select jsonb_pretty(jsonb_build_object(
  '1_schema_exists', exists (select 1 from pg_namespace where nspname = 'app_private'),
  '1_relations', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app_private'),
  '1_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private'),
  '2_schema_acl', (select jsonb_build_object('acl', n.nspacl::text, 'anon_usage', has_schema_privilege('anon', n.oid, 'USAGE')) from pg_namespace n where n.nspname = 'app_private'),
  '3_api_settings', (select jsonb_agg(c) from pg_roles r, unnest(coalesce(r.rolconfig, array[]::text[])) c where r.rolname = 'authenticator' and c like 'pgrst.db_%'),
  '4_view', (select jsonb_build_object(
      'options', array_to_string(c.reloptions, ','),
      'columns', (select string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' order by attnum) from pg_attribute where attrelid = c.oid and attnum > 0 and not attisdropped),
      'anon_select', has_table_privilege('anon', c.oid, 'SELECT'),
      'auth_select', has_table_privilege('authenticated', c.oid, 'SELECT'),
      'owner', pg_get_userbyid(c.relowner))
    from pg_class c where c.oid = to_regclass('public.employees_directory')),
  '5_existing_function', (select jsonb_agg(p.oid::regprocedure::text) from pg_proc p where p.proname = 'employees_directory_rows'),
  '6_public_definer', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef),
  '6_anon_exec', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
)) as precheck_015;

-- READ ONLY. 015 적용 후 남은 항목을 한 결과로 확인. 아무것도 바꾸지 않는다.
select jsonb_pretty(jsonb_build_object(
  'views_without_invoker', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)),
  'view_updatable_mask', pg_relation_is_updatable('public.employees_directory'::regclass, false),
  'function', (select jsonb_build_object('definer', p.prosecdef, 'config', p.proconfig, 'owner', pg_get_userbyid(p.proowner),
      'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE'), 'auth_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'auth_check', pg_get_functiondef(p.oid) like '%auth.uid() is not null%', 'active_check', pg_get_functiondef(p.oid) like '%me.is_active = true%')
    from pg_proc p where p.oid = to_regprocedure('app_private.employees_directory_rows()')),
  'employees_rls', (select relrowsecurity from pg_class where oid = 'public.employees'::regclass),
  'employees_policies', (select jsonb_agg(policyname order by policyname) from pg_policies where schemaname = 'public' and tablename = 'employees'),
  'employees_triggers', (select jsonb_object_agg(tgname, tgenabled) from pg_trigger where tgrelid = 'public.employees'::regclass and not tgisinternal),
  'trip_flags_on', (select count(*) from public.trip_feature_flags where enabled)
)) as postcheck_015;

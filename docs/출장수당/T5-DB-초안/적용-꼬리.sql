
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

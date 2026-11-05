-- READ ONLY. 012, 013 적용 전 사전 점검.
-- 아무것도 바꾸지 않는다.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.employees'::regclass
  and not tgisinternal
order by tgname;

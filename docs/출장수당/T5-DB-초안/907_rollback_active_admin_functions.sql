-- ⚠ 초안. 실행 금지. 007 되돌리기 — 적용 스크립트가 security_patch_backup 에 보존한 운영 원본 정의(pg_get_functiondef)를 그대로 실행한다.
-- 보존 행이 없으면(적용 스크립트를 거치지 않은 경우) 20260225210000 마이그레이션 정의로 복원하고 notice 를 남긴다.
-- 한 번에 실행. 실행 뒤 보안점검 S-6: is_admin_checks_active·is_manager_or_admin_checks_active = false 확인.
do $rb$
declare r record; n int := 0;
begin
  if to_regclass('public.security_patch_backup') is not null then
    for r in
      select distinct on (object) object, definition
      from public.security_patch_backup
      where patch = '007' and object in ('is_admin()', 'is_manager_or_admin()')
      order by object, id desc
    loop
      execute r.definition;
      n := n + 1;
    end loop;
  end if;
  if n < 2 then
    raise notice 'security_patch_backup 에 보존된 원본이 % 건뿐 → 마이그레이션(20260225210000) 정의로 복원', n;
    execute $f$
      create or replace function public.is_admin()
      returns boolean
      language sql security definer stable
      as $b$ select exists (select 1 from public.employees where id = auth.uid() and role = 'admin') $b$
    $f$;
    execute $f$
      create or replace function public.is_manager_or_admin()
      returns boolean
      language sql security definer stable
      as $b$ select exists (select 1 from public.employees where id = auth.uid() and role in ('manager', 'admin')) $b$
    $f$;
  end if;
end $rb$;

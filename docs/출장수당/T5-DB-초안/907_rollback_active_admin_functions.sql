-- ⚠ 초안. 실행 금지. 007 되돌리기 — 20260225210000 의 정의로 복원 (운영 실제 정의가 다르면 S-3 결과대로 고쳐서 쓴다).
create or replace function public.is_admin()
returns boolean
language sql security definer stable
as $$
  select exists (select 1 from public.employees where id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql security definer stable
as $$
  select exists (select 1 from public.employees where id = auth.uid() and role in ('manager', 'admin'))
$$;

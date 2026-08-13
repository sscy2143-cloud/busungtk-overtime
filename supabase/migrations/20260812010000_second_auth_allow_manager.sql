-- 2차 인증 PIN을 manager(인사담당)에게도 허용
-- 기존엔 admin 전용이었으나, 급여 페이지 접근용 PayPasswordGate(로그인 비밀번호 재사용, 독립된 2차 인증 아님)를
-- SecondAuthGate(완전히 별도의 PIN)로 대체하면서 manager도 대상에 포함

create or replace function public.set_second_auth_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_manager_or_admin() then raise exception 'manager or admin only'; end if;
  if p_password is null or length(p_password) < 4 then
    raise exception 'Password must be at least 4 characters';
  end if;
  select second_auth_hash into v_existing from public.employees where id = auth.uid();
  if v_existing is not null then raise exception 'Password already set'; end if;
  update public.employees
    set second_auth_hash = crypt(p_password, gen_salt('bf', 10))
    where id = auth.uid();
end;
$$;

create or replace function public.verify_second_auth_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then return false; end if;
  if not public.is_manager_or_admin() then return false; end if;
  select second_auth_hash into v_hash from public.employees where id = auth.uid();
  if v_hash is null then return false; end if;
  return v_hash = crypt(p_password, v_hash);
end;
$$;

create or replace function public.change_second_auth_password(p_old_password text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_manager_or_admin() then raise exception 'manager or admin only'; end if;
  if p_new_password is null or length(p_new_password) < 4 then
    raise exception 'Password must be at least 4 characters';
  end if;
  select second_auth_hash into v_hash from public.employees where id = auth.uid();
  if v_hash is null or v_hash <> crypt(p_old_password, v_hash) then
    return false;
  end if;
  update public.employees
    set second_auth_hash = crypt(p_new_password, gen_salt('bf', 10))
    where id = auth.uid();
  return true;
end;
$$;

create or replace function public.has_second_auth_password()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then return false; end if;
  if not public.is_manager_or_admin() then return false; end if;
  select second_auth_hash into v_hash from public.employees where id = auth.uid();
  return v_hash is not null;
end;
$$;

-- 분실 복구 대상도 manager까지 확장 (admin이 매니저 PIN 초기화 가능)
create or replace function public.admin_reset_second_auth(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_target_id is null then raise exception 'target required'; end if;
  if not exists (select 1 from public.employees where id = p_target_id and role in ('admin', 'manager')) then
    raise exception 'target must be admin or manager';
  end if;
  update public.employees set second_auth_hash = null where id = p_target_id;
end;
$$;

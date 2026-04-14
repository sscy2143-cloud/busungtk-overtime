-- ============================================================
-- 2차 인증 비밀번호 (admin 로그인용)
-- pgcrypto의 crypt()/gen_salt('bf') 사용
-- ============================================================

create extension if not exists pgcrypto;

alter table public.employees add column if not exists second_auth_hash text;

-- 현재 사용자의 2차 비밀번호 설정 여부
create or replace function public.has_second_auth_password()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then return false; end if;
  select second_auth_hash into v_hash from public.employees where id = auth.uid();
  return v_hash is not null;
end;
$$;

-- 최초 설정 (기존 해시가 없을 때만 허용)
create or replace function public.set_second_auth_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
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

-- 검증
create or replace function public.verify_second_auth_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then return false; end if;
  select second_auth_hash into v_hash from public.employees where id = auth.uid();
  if v_hash is null then return false; end if;
  return v_hash = crypt(p_password, v_hash);
end;
$$;

-- 비밀번호 재설정(변경): 기존 비밀번호 검증 후 갱신
create or replace function public.change_second_auth_password(p_old_password text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
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

grant execute on function public.has_second_auth_password() to authenticated;
grant execute on function public.set_second_auth_password(text) to authenticated;
grant execute on function public.verify_second_auth_password(text) to authenticated;
grant execute on function public.change_second_auth_password(text, text) to authenticated;

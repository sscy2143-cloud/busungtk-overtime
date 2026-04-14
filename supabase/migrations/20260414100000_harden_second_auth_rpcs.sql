-- ============================================================
-- Second Auth RPC 하드닝
-- 1. set/change/verify 함수를 admin 전용으로 제한
-- 2. admin 재설정 경로 추가 (분실 복구)
-- 3. search_path에 pg_temp 포함
-- ============================================================

-- 최초 설정: admin만 호출 가능하게 제한
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
  if not public.is_admin() then raise exception 'admin only'; end if;
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

-- 검증: admin만
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
  if not public.is_admin() then return false; end if;
  select second_auth_hash into v_hash from public.employees where id = auth.uid();
  if v_hash is null then return false; end if;
  return v_hash = crypt(p_password, v_hash);
end;
$$;

-- 변경: admin만, 본인의 기존 비밀번호 검증
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
  if not public.is_admin() then raise exception 'admin only'; end if;
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

-- has_second_auth_password: admin만 (다른 사용자는 false 반환)
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
  if not public.is_admin() then return false; end if;
  select second_auth_hash into v_hash from public.employees where id = auth.uid();
  return v_hash is not null;
end;
$$;

-- 신규: admin의 비밀번호 분실 시 다른 admin이 대신 초기화
-- (admin 2명 이상 체제에서만 작동. 단일 admin이면 DB 직접 접근 필요)
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
  -- 대상이 admin인지 확인 (비admin에게 2차 인증 설정할 이유 없음)
  if not exists (select 1 from public.employees where id = p_target_id and role = 'admin') then
    raise exception 'target must be admin';
  end if;
  update public.employees set second_auth_hash = null where id = p_target_id;
end;
$$;

grant execute on function public.has_second_auth_password() to authenticated;
grant execute on function public.set_second_auth_password(text) to authenticated;
grant execute on function public.verify_second_auth_password(text) to authenticated;
grant execute on function public.change_second_auth_password(text, text) to authenticated;
grant execute on function public.admin_reset_second_auth(uuid) to authenticated;

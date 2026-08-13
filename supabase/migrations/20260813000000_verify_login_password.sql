-- 로그인 비밀번호 재확인용 RPC
-- 기존엔 재확인 화면에서 supabase.auth.signInWithPassword()를 다시 호출했는데,
-- 이게 매번 전역 인증 세션을 갱신시켜서 onAuthStateChange가 발생 → AuthContext의 loading이 잠깐 true가 됨
-- → ProtectedRoute가 화면 전체를 언마운트했다가 다시 그려서, 열려있던 모달/탭 상태가 초기화되는 버그 발생
-- 세션을 건드리지 않고 현재 로그인한 사용자의 비밀번호 해시만 대조하도록 변경

create or replace function public.verify_login_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then return false; end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash is null then return false; end if;
  return v_hash = crypt(p_password, v_hash);
end;
$$;

grant execute on function public.verify_login_password(text) to authenticated;

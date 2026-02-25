-- 개발자 모드 관리자 계정 생성
-- email: dev@busungtk.com, password: busungtk6325
-- 로그인 페이지에서 비밀번호 6325로 접속 시 실제 Supabase 인증 사용
DO $$
DECLARE
  dev_user_id uuid := gen_random_uuid();
BEGIN
  -- 이미 dev 계정이 존재하면 스킵
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = 'dev@busungtk.com') THEN
    RETURN;
  END IF;

  -- auth.users에 dev 사용자 생성 (이메일 인증 완료 상태)
  INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at,
    confirmation_token, recovery_token
  ) VALUES (
    dev_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'dev@busungtk.com',
    extensions.crypt('busungtk6325', extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "개발자 (관리자)"}'::jsonb,
    false,
    now(),
    now(),
    '',
    ''
  );

  -- auth.identities에 email provider 추가
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    dev_user_id,
    dev_user_id,
    jsonb_build_object('sub', dev_user_id::text, 'email', 'dev@busungtk.com'),
    'email',
    dev_user_id::text,
    now(),
    now(),
    now()
  );

  -- employees 테이블에 admin 권한으로 등록
  INSERT INTO public.employees (
    id, name, email, department, role, employee_type, hourly_wage, is_active
  ) VALUES (
    dev_user_id,
    '개발자 (관리자)',
    'dev@busungtk.com',
    '경영지원',
    'admin',
    'office',
    0,
    true
  );
END;
$$;

-- Auth API로 생성된 dev 계정 이메일 인증 확인 + employee admin 등록
DO $$
DECLARE
  dev_id uuid;
BEGIN
  SELECT id INTO dev_id FROM auth.users WHERE email = 'dev@busungtk.com';
  IF dev_id IS NULL THEN
    RAISE NOTICE 'dev user not found';
    RETURN;
  END IF;

  -- 이메일 인증 완료 처리
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = dev_id;

  -- employees 테이블에 admin으로 등록 (이미 있으면 스킵)
  INSERT INTO public.employees (id, name, email, department, role, employee_type, hourly_wage, is_active)
  VALUES (dev_id, '개발자 (관리자)', 'dev@busungtk.com', '경영지원', 'admin', 'office', 0, true)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

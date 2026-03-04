DO $$
DECLARE dev_id uuid;
BEGIN
  SELECT id INTO dev_id FROM auth.users WHERE email = 'sscy2143@gmail.com';
  IF dev_id IS NULL THEN RAISE NOTICE 'dev user not found'; RETURN; END IF;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = dev_id;
  INSERT INTO public.employees (id, name, email, department, role, employee_type, hourly_wage, is_active)
  VALUES (dev_id, '관리자', 'sscy2143@gmail.com', '경영지원', 'admin', 'office', 0, true)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

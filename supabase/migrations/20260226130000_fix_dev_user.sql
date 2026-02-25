-- 깨진 dev 계정 정리 후 재생성
-- 이전 마이그레이션에서 직접 INSERT한 레코드가 GoTrue와 호환되지 않아 삭제

DO $$
DECLARE
  dev_id uuid;
BEGIN
  SELECT id INTO dev_id FROM auth.users WHERE email = 'dev@busungtk.com';
  IF dev_id IS NOT NULL THEN
    DELETE FROM public.employees WHERE id = dev_id;
    DELETE FROM auth.identities WHERE user_id = dev_id;
    DELETE FROM auth.users WHERE id = dev_id;
  END IF;
END;
$$;

-- overtime_requests 테이블의 status CHECK 제약에 'manager_approved' 추가
-- (인사담당자 1차 승인 → 대표 최종 승인 2단계 승인 흐름)

DO $$
DECLARE
  r RECORD;
BEGIN
  -- 기존 status 관련 CHECK 제약 제거
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.overtime_requests'::regclass
    AND contype = 'c'
    AND conname LIKE '%status%'
  LOOP
    EXECUTE 'ALTER TABLE public.overtime_requests DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- 새 제약 추가 (manager_approved 포함)
ALTER TABLE public.overtime_requests
  ADD CONSTRAINT overtime_requests_status_check
  CHECK (status IN ('pending', 'manager_approved', 'approved', 'rejected', 'cancelled'));

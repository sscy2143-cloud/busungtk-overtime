-- leave_requests 테이블에 2단계 승인 지원 추가
-- (인사담당자 1차 승인 + 대표 최종 승인)

-- 1. 인사담당자 승인 컬럼 추가
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS manager_approved_by uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS manager_approved_at timestamptz;

-- 2. 기존 status CHECK 제약 제거
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.leave_requests'::regclass
    AND contype = 'c'
    AND conname LIKE '%status%'
  LOOP
    EXECUTE 'ALTER TABLE public.leave_requests DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- 3. 새 제약 추가 (manager_approved 포함)
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN ('pending', 'manager_approved', 'approved', 'rejected', 'cancelled'));

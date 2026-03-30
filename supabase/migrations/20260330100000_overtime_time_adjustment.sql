-- overtime_requests 테이블에 시간 조정 기능 추가
-- (대표가 시간 조정 → 인사담당자 확인 후 적용)

-- 1. 시간 조정 관련 컬럼 추가
ALTER TABLE overtime_requests
  ADD COLUMN IF NOT EXISTS original_start text,
  ADD COLUMN IF NOT EXISTS original_end text,
  ADD COLUMN IF NOT EXISTS adjusted_by uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS adjusted_at timestamptz,
  ADD COLUMN IF NOT EXISTS adjustment_reason text,
  ADD COLUMN IF NOT EXISTS adjustment_confirmed_by uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS adjustment_confirmed_at timestamptz;

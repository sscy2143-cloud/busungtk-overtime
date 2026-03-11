-- 경비 지급 처리 관련 컬럼 추가
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_bank TEXT,
  ADD COLUMN IF NOT EXISTS payment_account TEXT,
  ADD COLUMN IF NOT EXISTS payment_note TEXT,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES employees(id);

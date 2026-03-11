-- 경비 지급 금액 기록 컬럼 추가
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2);

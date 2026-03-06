-- 경비 지급방식 컬럼 추가 (현금/계좌이체/기타)
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payout_method TEXT;

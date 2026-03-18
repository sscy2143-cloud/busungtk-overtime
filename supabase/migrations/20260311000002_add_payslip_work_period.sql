-- 급여명세서: 실근로일 기간 추가
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS work_start DATE;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS work_end DATE;

-- 급여명세서: 전달 문구 + 관리자 메모 컬럼 추가
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS admin_note TEXT;

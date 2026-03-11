-- 휴가 신청 시 대체휴가 우선 사용 여부 컬럼 추가
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS use_substitute BOOLEAN DEFAULT FALSE;

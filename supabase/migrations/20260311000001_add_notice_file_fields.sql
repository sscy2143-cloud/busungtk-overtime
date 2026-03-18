-- 공지사항: 첨부파일 컬럼 추가
ALTER TABLE notices ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS file_name TEXT;

-- 공지사항 테이블
CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '공지',
  content TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;

-- 전체 직원 조회 가능
CREATE POLICY "notices_select_all" ON notices
  FOR SELECT USING (true);

-- 관리자만 작성/수정/삭제 가능
CREATE POLICY "notices_insert_admin" ON notices
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "notices_update_admin" ON notices
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "notices_delete_admin" ON notices
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

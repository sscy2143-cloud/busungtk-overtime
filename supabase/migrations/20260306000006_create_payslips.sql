-- 급여명세서 테이블
CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- 'YYYY-MM' 형식
  file_path TEXT NOT NULL, -- storage 경로: {employee_id}/{period}.{ext}
  file_name TEXT NOT NULL, -- 원본 파일명
  uploaded_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, period)
);

ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;

-- 직원: 본인 명세서만 조회
CREATE POLICY "employees_see_own_payslips" ON payslips
  FOR SELECT USING (employee_id = auth.uid());

-- 관리자: 전체 관리
CREATE POLICY "admin_manage_payslips" ON payslips
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- ⚠️ Supabase 대시보드 > Storage에서 'payslips' 버킷을 수동으로 생성하세요.
-- 버킷 설정: Private (비공개), 파일 크기 제한 10MB 권장

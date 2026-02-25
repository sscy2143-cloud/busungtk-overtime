-- expenses 테이블: 경비 청구
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date date NOT NULL,
  category text NOT NULL CHECK (category IN ('meal', 'transport', 'supplies', 'other')),
  amount integer NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  receipt_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by uuid REFERENCES employees(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS 활성화
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 본인 조회
CREATE POLICY "expenses_select_own" ON expenses
  FOR SELECT USING (employee_id = auth.uid()::uuid OR is_manager_or_admin());

-- RLS 정책: 본인 삽입
CREATE POLICY "expenses_insert_own" ON expenses
  FOR INSERT WITH CHECK (employee_id = auth.uid()::uuid);

-- RLS 정책: 관리자 수정 (승인/반려)
CREATE POLICY "expenses_update_admin" ON expenses
  FOR UPDATE USING (is_manager_or_admin());

-- 휴가 종류별 발생 기준 테이블
CREATE TABLE IF NOT EXISTS leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  consumes_annual boolean NOT NULL DEFAULT false,
  annual_days numeric(3,1) NOT NULL DEFAULT 0,
  absence_days numeric(3,1) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS 활성화
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

-- 모든 인증된 사용자가 조회 가능
CREATE POLICY "leave_types_select_all" ON leave_types
  FOR SELECT USING (true);

-- 관리자만 생성/수정/삭제 가능
CREATE POLICY "leave_types_insert_admin" ON leave_types
  FOR INSERT WITH CHECK (is_manager_or_admin());

CREATE POLICY "leave_types_update_admin" ON leave_types
  FOR UPDATE USING (is_manager_or_admin());

CREATE POLICY "leave_types_delete_admin" ON leave_types
  FOR DELETE USING (is_manager_or_admin());

-- 초기 데이터 시드
INSERT INTO leave_types (name, consumes_annual, annual_days, absence_days, sort_order) VALUES
  ('휴가', true, 1, 1, 1),
  ('반차', true, 0.5, 0.5, 2),
  ('본인/배우자의 조부모·외조부모·형제 자매 사망', false, 0, 2, 3),
  ('본인/배우자의 부모·배우자 사망', false, 0, 3, 4),
  ('본인 결혼', false, 0, 5, 5),
  ('건강검진', false, 0, 0.5, 6),
  ('예비군/민방위 훈련', false, 0, 1, 7),
  ('배우자 출산', false, 0, 3, 8);

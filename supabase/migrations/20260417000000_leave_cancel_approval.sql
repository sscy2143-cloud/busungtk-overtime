-- ============================================================
-- leave_requests 테이블에 취소 승인 프로세스 컬럼 추가
-- 용도: 연차 취소 시 관리자 승인 필요하게 변경
-- cancel_requested_at: 직원 취소 요청 시각
-- cancel_reason: 직원 취소 사유
-- cancel_approved_at/by: 관리자 취소 승인
-- cancel_rejected_at/by/rejection_reason: 관리자 취소 반려
-- ============================================================

alter table leave_requests add column if not exists cancel_requested_at timestamptz;
alter table leave_requests add column if not exists cancel_reason text;
alter table leave_requests add column if not exists cancel_approved_at timestamptz;
alter table leave_requests add column if not exists cancel_approved_by uuid references employees(id);
alter table leave_requests add column if not exists cancel_rejected_at timestamptz;
alter table leave_requests add column if not exists cancel_rejected_by uuid references employees(id);
alter table leave_requests add column if not exists cancel_rejection_reason text;

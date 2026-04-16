-- ============================================================
-- overtime_requests 테이블에 work_category 컬럼 추가
-- 용도: 야근 작업 카테고리 분류 (점검/유지보수, 긴급출동, AS건 등)
-- 기존 type 컬럼(extended/night/holiday)과 구분됨
-- nullable: 과거 데이터는 NULL로 유지
-- ============================================================

alter table overtime_requests add column if not exists work_category text;

comment on column overtime_requests.work_category is
  '야근 작업 카테고리 (점검/유지보수, 긴급출동, 납품/설치, AS건, 시공건, 설계건, 기타)';

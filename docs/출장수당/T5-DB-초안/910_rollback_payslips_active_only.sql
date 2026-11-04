-- ⚠ 최후 수단. 010 되돌리기 — 추가한 RESTRICTIVE 정책 2개만 지운다. 기존 8개 정책은 건드리지 않았으므로 그대로 남는다.
-- 실행하면 비활성 admin·manager·직원의 급여명세서 표·파일 접근이 다시 열린다(운영 S-8 상태). 사용자가 명시 결정한 경우에만 실행.
drop policy if exists "payslips_active_only_restrictive" on public.payslips;
drop policy if exists "payslips_storage_active_only_restrictive" on storage.objects;

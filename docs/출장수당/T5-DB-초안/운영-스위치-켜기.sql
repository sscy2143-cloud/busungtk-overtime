-- 출장 기능 서버 스위치 켜기 (employee_form, admin_review). 2026-11-25 사용자 지시.
-- Supabase SQL Editor 에서 통째로 실행. 급여 반영(payroll_apply)은 켜지지 않는다(함수·CHECK 제약으로 잠김).
-- 표 직접 UPDATE 대신 정식 함수 trip_set_feature 를 쓴다 → 변경 이력(trip_feature_flag_history)이 남는다.
-- SQL Editor 에는 로그인 사용자가 없어서, 이 트랜잭션 안에서만 재직 중인 대표(admin) 계정으로 실행한다.
-- 되돌리기: 아래 두 줄의 true 를 false 로 바꿔 다시 실행.
begin;
with a as (select id::text as id from public.employees where role = 'admin' and is_active order by id limit 1)
select set_config('request.jwt.claim.sub', (select id from a), true),
       set_config('request.jwt.claims', json_build_object('sub', (select id from a), 'role', 'authenticated')::text, true);
select key, enabled from public.trip_set_feature('employee_form', true, '2026-11-25 출장 기능 시범 오픈 (사용자 지시)');
select key, enabled from public.trip_set_feature('admin_review',  true, '2026-11-25 출장 기능 시범 오픈 (사용자 지시)');
select key, enabled from public.trip_feature_flags order by key;
commit;

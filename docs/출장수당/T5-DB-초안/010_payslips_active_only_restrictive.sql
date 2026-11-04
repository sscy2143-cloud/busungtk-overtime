-- ⚠ 초안. 실행 금지. 급여명세서 정책 변경 — 별도 승인 후 (D13 최종판, 2026-11-04).
-- ============================================================
-- 010: 급여명세서(payslips 표 + Storage 'payslips' 버킷)에 "호출자가 활성 직원일 때만" RESTRICTIVE 정책을 추가
--
-- 운영 S-8 확정(11-04): payslips 정책 4개(payslips_select_own, payslips_insert_admin, payslips_update_admin, payslips_delete_admin)와
--   storage.objects 정책 4개(payslips_storage_select/insert/update/delete). 관리자 판정은 employees.role in ('admin','manager') 이고
--   is_active 검사가 없다. payslips 버킷 private, receipts 버킷 public, is_manager_or_admin() 은 is_active 검사(007 적용).
--
-- 방식: 기존 8개 정책(PERMISSIVE, OR 결합)은 본문 그대로 둔다. 대신 표와 storage.objects 에 각각 RESTRICTIVE 정책 1개를 더한다.
--   RESTRICTIVE 는 PERMISSIVE 와 AND 로 결합되므로 "기존에 허용되던 사람 중 활성 직원만" 으로 좁아진다.
--   - 활성 admin·manager: 기존 권한 그대로 (조회·업로드·수정·삭제·서명 URL)
--   - 비활성 admin·manager: 표·파일 모두 SELECT/INSERT/UPDATE/DELETE 전부 차단 (서명 URL 생성도 SELECT 라 차단)
--   - 활성 일반 직원: 본인 명세서 조회(기존 payslips_select_own·storage select) 그대로
--   - 비활성 일반 직원: 본인 명세서 조회도 차단
--   - storage 쪽 조건은 bucket_id <> 'payslips' 를 OR 로 두어 receipts 등 다른 버킷(공지 첨부 포함)은 영향 없음
--   - service_role 은 RLS 를 지나지 않으므로 서버 작업 무영향. anon 은 기존에도 허용 정책이 없다.
--   기존 정책 본문을 몰라도 적용 가능하고, 본문을 바꾸지 않으므로 복원(910)은 추가한 2개를 지우는 것뿐이다.
-- 전제(사전 점검): 8개 정책 이름 존재, is_manager_or_admin 에 is_active, 추가할 정책 이름 미존재, payslips 버킷 존재·private.
-- 적용 뒤: 보안점검-S8-payslips-storage.sql → payslips_policies / storage_objects_policies 에 permissive=RESTRICTIVE 인
--   payslips_active_only_restrictive / payslips_storage_active_only_restrictive 가 보이면 정상.
-- ============================================================
begin;

do $chk$
declare v_missing text;
begin
  select string_agg(p, ', ') into v_missing from unnest(array[
    'payslips_select_own', 'payslips_insert_admin', 'payslips_update_admin', 'payslips_delete_admin']) p
  where not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payslips' and policyname = p);
  if v_missing is not null then
    raise exception 'PRECONDITION_CHANGED' using detail = 'payslips 정책 없음: ' || v_missing;
  end if;
  select string_agg(p, ', ') into v_missing from unnest(array[
    'payslips_storage_select', 'payslips_storage_insert', 'payslips_storage_update', 'payslips_storage_delete']) p
  where not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = p);
  if v_missing is not null then
    raise exception 'PRECONDITION_CHANGED' using detail = 'storage.objects 정책 없음: ' || v_missing;
  end if;
  if exists (select 1 from pg_policies where (schemaname = 'public' and tablename = 'payslips' and policyname = 'payslips_active_only_restrictive')
                                           or (schemaname = 'storage' and tablename = 'objects' and policyname = 'payslips_storage_active_only_restrictive')) then
    raise exception 'ALREADY_APPLIED' using detail = '활성 직원 제한 정책이 이미 있습니다';
  end if;
  if (select pg_get_functiondef('public.is_manager_or_admin()'::regprocedure)) not like '%is_active%' then
    raise exception 'PRECONDITION_CHANGED' using detail = 'is_manager_or_admin() 에 is_active 가 없습니다 (007 미적용)';
  end if;
  if not exists (select 1 from storage.buckets where id = 'payslips' and public = false) then
    raise exception 'PRECONDITION_CHANGED' using detail = 'payslips 버킷이 없거나 public 입니다';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.payslips'::regclass) then
    raise exception 'PRECONDITION_CHANGED' using detail = 'payslips RLS 가 꺼져 있습니다';
  end if;
end $chk$;

-- 표: 호출자가 활성 직원일 때만 (모든 명령). with check 도 같은 조건 → 비활성 계정은 INSERT/UPDATE 결과 행도 만들 수 없다
create policy "payslips_active_only_restrictive"
  on public.payslips
  as restrictive
  for all
  to authenticated
  using (exists (select 1 from public.employees me where me.id = auth.uid() and me.is_active = true))
  with check (exists (select 1 from public.employees me where me.id = auth.uid() and me.is_active = true));

-- Storage: payslips 버킷의 객체만 활성 직원으로 제한. 다른 버킷은 조건이 참이라 영향 없음
create policy "payslips_storage_active_only_restrictive"
  on storage.objects
  as restrictive
  for all
  to authenticated
  using (bucket_id <> 'payslips' or exists (select 1 from public.employees me where me.id = auth.uid() and me.is_active = true))
  with check (bucket_id <> 'payslips' or exists (select 1 from public.employees me where me.id = auth.uid() and me.is_active = true));

select schemaname, tablename, policyname, permissive, cmd
from pg_policies
where (schemaname = 'public' and tablename = 'payslips')
   or (schemaname = 'storage' and tablename = 'objects' and policyname like 'payslips%')
order by schemaname, policyname;

commit;

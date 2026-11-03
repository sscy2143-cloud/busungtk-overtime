-- D13 사전 확인 — 읽기 전용 (SELECT 1개). 급여명세서·공지 첨부가 쓰는 payslips 버킷의 정책을 본다. 파일 이름·금액은 읽지 않는다.
-- Supabase SQL Editor 에 전체를 붙여 넣고 Run → 1행, 각 칼럼이 JSON.
select
  (
    select coalesce(
      jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles::text[], 'qual', qual, 'with_check', with_check) order by policyname),
      '[]'::jsonb
    )
    from pg_policies
    where schemaname = 'public' and tablename = 'payslips'
  ) as payslips_policies,
  (
    select relrowsecurity from pg_class where oid = 'public.payslips'::regclass
  ) as payslips_rls,
  (
    select coalesce(
      jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types) order by id),
      '[]'::jsonb
    )
    from storage.buckets
  ) as buckets,
  (
    select coalesce(
      jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles::text[], 'qual', qual, 'with_check', with_check) order by policyname),
      '[]'::jsonb
    )
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
  ) as storage_objects_policies,
  (
    select jsonb_build_object(
      'payslips_objects', count(*) filter (where bucket_id = 'payslips' and name not like 'notices/%'),
      'notice_objects', count(*) filter (where bucket_id = 'payslips' and name like 'notices/%'),
      'other_buckets_objects', count(*) filter (where bucket_id <> 'payslips')
    )
    from storage.objects
  ) as object_counts,
  (
    select pg_get_functiondef('public.is_manager_or_admin()'::regprocedure) like '%is_active%'
  ) as is_manager_or_admin_checks_active;

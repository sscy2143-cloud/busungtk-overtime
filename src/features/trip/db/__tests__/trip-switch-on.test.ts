import { it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const D = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const r = (n: string) => readFileSync(resolve(D, n), 'utf8').replace(/\r\n/g, '\n')
// 운영-스위치-켜기.sql 검증 — 합성 데이터, 재직 대표 계정으로 이력이 남고 급여 반영은 꺼진 채
it('운영 스위치 켜기 SQL: 화면 두 스위치만 켜지고 재직 대표 이름으로 이력이 남는다', async () => {
  const db = new PGlite()
  await db.exec(r('로컬시험/000_local_shim.sql'))
  for (const f of ['006_employees_role_guard.sql','007_active_admin_functions.sql','008a_employees_directory_view.sql','008b_drop_group_select_policy.sql','011_employees_privileges_minimal.sql','012_rpc_revoke_anon_execute.sql','013_employees_active_guard.sql']) await db.exec(r(f))
  await db.exec(r('적용-단일실행본-출장수당.sql'))
  await db.exec("insert into public.employees (id, name, role, is_active) values ('00000000-0000-0000-0000-00000000000b','대표','admin',true),('00000000-0000-0000-0000-00000000000a','퇴사대표','admin',false)")
  await db.exec(r('운영-스위치-켜기.sql'))
  const f = (await db.query<{ key: string; enabled: boolean }>('select key, enabled from public.trip_feature_flags order by key')).rows
  const h = (await db.query<{ key: string; changed_by: string }>('select key, changed_by from public.trip_feature_flag_history order by key')).rows
  expect(f).toEqual([{ key: 'admin_review', enabled: true }, { key: 'employee_form', enabled: true }, { key: 'payroll_apply', enabled: false }])
  const admins = (await db.query<{ id: string }>("select id from public.employees where role = 'admin' and is_active")).rows.map((x) => x.id)
  expect(h).toHaveLength(2)
  expect(h.every((x) => admins.includes(x.changed_by))).toBe(true) // 재직 대표만, 퇴사 대표(…0a) 아님
}, 60000)

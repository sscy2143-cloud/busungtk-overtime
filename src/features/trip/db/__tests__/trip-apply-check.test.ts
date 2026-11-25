// 운영 사용자 실행용 읽기 전용 점검(보안점검-출장-적용확인-한번에.sql) 검증 — 합성 데이터만, 운영 DB 와 무관.
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const read = (name: string) => readFileSync(resolve(DRAFT, name), 'utf8').replace(/\r\n/g, '\n')
const CHECK = read('보안점검-출장-적용확인-한번에.sql')
const PRE = ['006_employees_role_guard.sql', '007_active_admin_functions.sql', '008a_employees_directory_view.sql', '008b_drop_group_select_policy.sql', '011_employees_privileges_minimal.sql', '012_rpc_revoke_anon_execute.sql', '013_employees_active_guard.sql']

async function prodDb() {
  const db = new PGlite()
  await db.exec(read('로컬시험/000_local_shim.sql'))
  for (const f of PRE) await db.exec(read(f))
  return db
}
async function run(db: PGlite): Promise<Record<string, unknown>> {
  const res = await db.exec(CHECK)
  const row = res.find((r) => r.rows.length > 0)!.rows[0] as { trip_apply_check: string }
  return JSON.parse(row.trip_apply_check)
}

describe('출장 적용 확인 (읽기 전용 한 번에)', () => {
  it('읽기 전용 구문만 있다', () => {
    const code = CHECK.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/^begin read only;/m)
    expect(code).toMatch(/^rollback;/m)
    expect(code).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|commit)\b/i)
  })

  it('출장 SQL 적용 전 DB 에서도 오류 없이 applied=false 를 보여 준다', async () => {
    const r = await run(await prodDb())
    expect(r.applied).toBe(false)
    expect(r.tables_present).toBe(0)
    expect((r.tables_missing as string[]).length).toBe(14)
    expect(r.flags).toBeNull()
    expect(r.trip_claims_rows).toBeNull()
  }, 60_000)

  it('단일 실행본 적용 후에는 기대값과 같다', async () => {
    const db = await prodDb()
    await db.exec(read('적용-단일실행본-출장수당.sql'))
    const r = await run(db)
    expect(r).toMatchObject({
      applied: true, tables_present: 14, tables_missing: [], rls_off: [], anon_table_select: [], anon_trip_exec: [],
      flags: { admin_review: false, employee_form: false, payroll_apply: false }, payroll_lock: true, trip_claims_rows: 0,
      employees_position_column: true,
    })
    expect(Number(r.trip_functions)).toBeGreaterThanOrEqual(40)
  }, 60_000)

  it('스위치가 켜져 있으면 그대로 드러난다', async () => {
    const db = await prodDb()
    await db.exec(read('적용-단일실행본-출장수당.sql'))
    await db.exec("update public.trip_feature_flags set enabled = true where key = 'employee_form'")
    expect((await run(db)).flags).toMatchObject({ employee_form: true, payroll_apply: false })
  }, 60_000)
})

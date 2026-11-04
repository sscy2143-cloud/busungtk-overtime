// D16 — employees 최소 권한 정리(011) 로컬 검증. 합성 데이터만 사용, 운영 DB 와 무관.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const sql = (name: string) => readFileSync(resolve(DRAFT, name), 'utf8')
const ALICE = '00000000-0000-0000-0000-000000000001'
const BOSS = '00000000-0000-0000-0000-000000000009'

let db: PGlite
const exec = (s: string) => db.exec(s)
const asUser = (uid: string | null) => exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claims', '${JSON.stringify({ role: 'authenticated', sub: uid ?? '' })}', false);`)
async function run(uid: string | null, stmt: string, role: 'authenticated' | 'anon' = 'authenticated'): Promise<string> {
  await asUser(uid)
  await exec(`set role ${role}`)
  try { await exec(stmt); return 'ok' } catch (e) { return String((e as Error).message) } finally { await exec('reset role') }
}
const grantsOf = async (grantee: string) => (await db.query<{ p: string }>(
  "select privilege_type as p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'employees' and grantee = $1 order by 1", [grantee])).rows.map(r => r.p)

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
}, 60_000)
afterAll(async () => { await db?.close() })

describe('D16 011 — employees 최소 권한', () => {
  it('재현: 적용 전에는 기본 권한 때문에 anon·authenticated 가 TRUNCATE·DELETE 권한까지 가진다', async () => {
    expect(await grantsOf('anon')).toContain('SELECT')
    expect(await grantsOf('authenticated')).toEqual(expect.arrayContaining(['TRUNCATE', 'DELETE', 'REFERENCES', 'TRIGGER']))
  })

  it('적용: anon 권한 없음, authenticated 는 SELECT·INSERT·UPDATE 만, service_role 은 그대로', async () => {
    await exec(sql('011_employees_privileges_minimal.sql'))
    expect(await grantsOf('anon')).toEqual([])
    expect(await grantsOf('authenticated')).toEqual(['INSERT', 'SELECT', 'UPDATE'])
    expect(await grantsOf('service_role')).toEqual(expect.arrayContaining(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']))
  })

  it('anon 은 employees 를 읽지 못하고, authenticated 는 TRUNCATE·DELETE 를 못 한다', async () => {
    expect(await run(null, 'select id from public.employees', 'anon')).toMatch(/permission denied/)
    expect(await run(ALICE, 'truncate public.employees')).toMatch(/permission denied/)
    expect(await run(BOSS, `delete from public.employees where id = '${ALICE}'`)).toMatch(/permission denied/)
  })

  it('기존 업무는 그대로: 본인 행 조회, 대표의 직원 조회·수정, 서비스 롤의 변경', async () => {
    expect(await run(ALICE, `select id, name from public.employees where id = '${ALICE}'`)).toBe('ok')
    expect(await run(BOSS, 'select id from public.employees')).toBe('ok')
    expect(await run(BOSS, `update public.employees set hourly_wage = 10000 where id = '${ALICE}'`)).toBe('ok')
    await asUser(null)
    await exec('set role service_role')
    await exec(`update public.employees set is_active = true where id = '${ALICE}'`)
    await exec('reset role')
  })

  it('멱등: 한 번 더 실행해도 같은 결과', async () => {
    await exec(sql('011_employees_privileges_minimal.sql'))
    expect(await grantsOf('authenticated')).toEqual(['INSERT', 'SELECT', 'UPDATE'])
  })

  it('911 롤백: authenticated 권한 복구, anon 은 SELECT 만', async () => {
    await exec(sql('911_rollback_employees_privileges.sql'))
    expect(await grantsOf('authenticated')).toEqual(expect.arrayContaining(['DELETE', 'TRUNCATE']))
    expect(await grantsOf('anon')).toEqual(['SELECT'])
  })
})

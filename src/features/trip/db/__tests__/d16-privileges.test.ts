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

describe('D16 012 — SECURITY DEFINER 함수의 anon EXECUTE 회수 (011 과 별도 승인 범위)', () => {
  const anonCan = async (fn: string) => (await db.query<{ ok: boolean }>(`select has_function_privilege('anon', '${fn}'::regprocedure, 'EXECUTE') as ok`)).rows[0].ok
  const authCan = async (fn: string) => (await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', '${fn}'::regprocedure, 'EXECUTE') as ok`)).rows[0].ok

  it('재현: 적용 전에는 anon 이 definer 함수를 실행할 수 있다', async () => {
    expect(await anonCan('public.is_admin()')).toBe(true)
  })
  it('적용: anon 은 모든 definer 함수 실행 불가, authenticated 는 그대로', async () => {
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
    const r = (await db.query<{ n: string; m: string }>(
      "select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))::text as n, count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text as m from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef")).rows[0]
    expect(r.n).toBe('0')
    expect(Number(r.m)).toBeGreaterThan(0)
    expect(await anonCan('public.is_admin()')).toBe(false)
    expect(await authCan('public.is_admin()')).toBe(true)
  })
  it('로그인 사용자의 기존 업무는 그대로 (RLS 안의 is_admin 호출 포함)', async () => {
    expect(await run(BOSS, 'select id from public.employees')).toBe('ok')
    expect(await run(BOSS, 'select * from public.list_all_employees()')).toBe('ok')
    expect(await run(ALICE, `select id from public.employees where id = '${ALICE}'`)).toBe('ok')
  })
  it('익명 호출은 함수 실행 단계에서 permission denied', async () => {
    expect(await run(null, 'select public.is_admin()', 'anon')).toMatch(/permission denied/)
  })
  it('멱등 + 912 롤백', async () => {
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
    expect(await anonCan('public.is_admin()')).toBe(false)
    await exec(sql('912_rollback_rpc_anon_execute.sql'))
    expect(await anonCan('public.is_admin()')).toBe(true)
  })
})

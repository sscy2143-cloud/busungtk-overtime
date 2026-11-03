/**
 * 기존 employees 권한 상승 경로 재현과 006·007 차단 — 출장 객체(005·010~040) 없이 shim(운영 정책·함수 사본)만 올린 빈 DB.
 * 006·007 이 단독으로 적용·되돌려지고, 트랜잭션 안에서 적용했다가 ROLLBACK 하면 흔적이 없음을 확인한다.
 *
 * 운영 DB 와 연결되지 않는다. shim 은 레포 마이그레이션 사본이므로 운영 실제 정의는 보안점검-읽기전용.sql(S-1·S-3)로 확정한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const sql = (name: string) => readFileSync(resolve(DRAFT, name), 'utf8')

const ALICE = '00000000-0000-0000-0000-000000000001'   // employee (shim)
const BOSS = '00000000-0000-0000-0000-000000000009'    // admin (shim)
const MGR = '00000000-0000-0000-0000-000000000005'     // manager 활성
const GONE_MGR = '00000000-0000-0000-0000-000000000007' // manager 비활성 (퇴사, auth 계정은 남아 있다고 가정)
const GONE_ADM = '00000000-0000-0000-0000-000000000008' // admin 비활성
const NEWBIE = '00000000-0000-0000-0000-00000000000a'   // auth 사용자이지만 employees 행이 없음

let db: PGlite
const exec = (s: string) => db.exec(s)
const one = async <T,>(s: string, params: unknown[] = []): Promise<T> => (await db.query<T>(s, params)).rows[0]
const rows = async <T,>(s: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(s, params)).rows
const asUser = (uid: string | null) => exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claims', '${JSON.stringify({ role: 'authenticated', sub: uid ?? '' })}', false);`)
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK' } catch (e) { return String((e as Error).message).split('\n')[0].trim() }
}
/** PostgREST 처럼: 세션 사용자 + authenticated 역할로 employees 를 직접 UPDATE */
const restUpdate = async (uid: string, setClause: string, target: string) => {
  await asUser(uid)
  await exec('set role authenticated')
  try { return await codeOf(exec(`update public.employees set ${setClause} where id = '${target}'`)) } finally { await exec('reset role') }
}
const restInsert = async (uid: string, role: string) => {
  await asUser(uid)
  await exec('set role authenticated')
  try { return await codeOf(exec(`insert into public.employees (id, name, role) values ('${uid}', '신규', '${role}')`)) } finally { await exec('reset role') }
}
const roleOf = async (id: string) => (await one<{ r: string | null }>('select role as r from public.employees where id = $1', [id]))?.r ?? null
const nameOf = async (id: string) => (await one<{ n: string }>('select name as n from public.employees where id = $1', [id])).n
const rpcUpdate = (id: string, role: string) => codeOf(one('select public.update_employee_admin(p_id => $1::uuid, p_role => $2) as r', [id, role]))
const listAll = () => codeOf(rows('select * from public.list_all_employees()'))
const triggerCount = async () => Number((await one<{ n: string }>("select count(*)::text as n from pg_trigger where tgname = 'employees_role_admin_only'")).n)
const isAdminChecksActive = async () => (await one<{ ok: boolean }>("select pg_get_functiondef('public.is_admin()'::regprocedure) like '%is_active%' as ok")).ok

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
  await exec(`insert into public.employees (id, name, role, is_active) values
    ('${MGR}', '인사담당', 'manager', true), ('${GONE_MGR}', '퇴사인사', 'manager', false), ('${GONE_ADM}', '전대표', 'admin', false) on conflict (id) do nothing`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('A. 재현 — 운영 정책·함수 사본만 있을 때 (006·007 없음)', () => {
  it('인사담당이 REST 로 자기·남의 role 을 admin 으로 바꿀 수 있다', async () => {
    expect(await restUpdate(MGR, "role = 'admin'", MGR)).toBe('OK')
    expect(await roleOf(MGR)).toBe('admin')
    expect(await restUpdate(MGR, "role = 'admin'", ALICE)).toBe('OK')
    expect(await roleOf(ALICE)).toBe('admin')
    await asUser(null)
    await exec(`update public.employees set role = 'manager' where id = '${MGR}'`)
    await exec(`update public.employees set role = 'employee' where id = '${ALICE}'`)
  })

  it('비활성(퇴사) 인사담당의 세션도 같다 — is_manager_or_admin() 이 is_active 를 보지 않는다', async () => {
    expect(await restUpdate(GONE_MGR, "role = 'admin'", GONE_MGR)).toBe('OK')
    expect(await roleOf(GONE_MGR)).toBe('admin')
    await asUser(null)
    await exec(`update public.employees set role = 'manager' where id = '${GONE_MGR}'`)
    expect(await restUpdate(GONE_MGR, "name = '퇴사인사x'", ALICE)).toBe('OK')
    expect(await nameOf(ALICE)).toBe('퇴사인사x')
    await asUser(null)
    await exec(`update public.employees set name = '김직원' where id = '${ALICE}'`)
  })

  it('비활성 admin 의 RPC(update_employee_admin·list_all_employees)도 통과한다 — is_admin() 이 is_active 를 보지 않는다', async () => {
    await asUser(GONE_ADM)
    expect(await rpcUpdate(ALICE, 'manager')).toBe('OK')
    expect(await roleOf(ALICE)).toBe('manager')
    expect(await listAll()).toBe('OK')
    await asUser(null)
    await exec(`update public.employees set role = 'employee' where id = '${ALICE}'`)
  })

  it('employees 행이 없는 auth 사용자는 employees_insert_self 로 admin 행을 만들 수 있다', async () => {
    expect(await restInsert(NEWBIE, 'admin')).toBe('OK')
    expect(await roleOf(NEWBIE)).toBe('admin')
    await asUser(null)
    await exec(`delete from public.employees where id = '${NEWBIE}'`)
  })

  it('직원(employee)은 처음부터 0행 — UPDATE 정책이 없다', async () => {
    expect(await restUpdate(ALICE, "role = 'admin'", ALICE)).toBe('OK')
    expect(await roleOf(ALICE)).toBe('employee')
  })
})

describe('B. 006 — 트랜잭션 ROLLBACK 가능, 단독 적용으로 role 경로 차단', () => {
  it('begin → 006 → rollback: 트리거·함수가 남지 않는다', async () => {
    await exec('begin')
    await exec(sql('006_employees_role_guard.sql'))
    expect(await triggerCount()).toBe(1)
    await exec('rollback')
    expect(await triggerCount()).toBe(0)
    expect((await one<{ ok: boolean }>("select to_regprocedure('public.employees_role_guard()') is null as ok")).ok).toBe(true)
  })

  it('006 적용: 인사담당의 자기·남의 role 변경과 대표 강등은 ROLE_ADMIN_ONLY, 다른 칼럼·같은 값 저장은 그대로', async () => {
    await exec(sql('006_employees_role_guard.sql'))
    expect(await triggerCount()).toBe(1)
    expect(await restUpdate(MGR, "role = 'admin'", MGR)).toBe('ROLE_ADMIN_ONLY')
    expect(await restUpdate(MGR, "role = 'admin'", ALICE)).toBe('ROLE_ADMIN_ONLY')
    expect(await restUpdate(MGR, "role = 'employee'", BOSS)).toBe('ROLE_ADMIN_ONLY')
    expect(await roleOf(MGR)).toBe('manager')
    expect(await roleOf(BOSS)).toBe('admin')
    expect(await restUpdate(MGR, "name = '김직원', role = 'employee', is_active = true", ALICE)).toBe('OK')   // 직원관리 저장 경로
    expect(await restUpdate(MGR, "name = '김직원2'", ALICE)).toBe('OK')
    expect(await nameOf(ALICE)).toBe('김직원2')
    await asUser(null)
    await exec(`update public.employees set name = '김직원' where id = '${ALICE}'`)
  })

  it('INSERT 경로: 행 없는 auth 사용자의 admin·manager 행은 거부, employee 행과 register_employee 는 통과', async () => {
    expect(await restInsert(NEWBIE, 'admin')).toBe('ROLE_ADMIN_ONLY')
    expect(await restInsert(NEWBIE, 'manager')).toBe('ROLE_ADMIN_ONLY')
    expect(await roleOf(NEWBIE)).toBeNull()
    expect(await restInsert(NEWBIE, 'employee')).toBe('OK')
    expect(await roleOf(NEWBIE)).toBe('employee')
    await asUser(null)
    await exec(`delete from public.employees where id = '${NEWBIE}'`)
    await asUser(NEWBIE)
    expect(await codeOf(one("select public.register_employee($1::uuid, '신규', 'n@x') as r", [NEWBIE]))).toBe('OK')
    expect(await roleOf(NEWBIE)).toBe('employee')
    await asUser(null)
    await exec(`delete from public.employees where id = '${NEWBIE}'`)
  })

  it('admin 은 REST·RPC 모두 정상, 인사담당의 RPC 는 Unauthorized, 세션 없는 경로는 통과', async () => {
    expect(await restUpdate(BOSS, "role = 'manager'", ALICE)).toBe('OK')
    await asUser(BOSS)
    expect(await rpcUpdate(ALICE, 'employee')).toBe('OK')
    expect(await roleOf(ALICE)).toBe('employee')
    await asUser(MGR)
    expect(await rpcUpdate(ALICE, 'admin')).toBe('Unauthorized')
    await asUser(null)
    expect(await codeOf(exec(`update public.employees set role = 'manager' where id = '${ALICE}'`))).toBe('OK')
    await exec(`update public.employees set role = 'employee' where id = '${ALICE}'`)
  })

  it('비활성 인사담당·비활성 admin: role 변경은 006 이 막지만(활성 admin 만), 다른 칼럼·RPC 는 007 전까지 열려 있다', async () => {
    expect(await restUpdate(GONE_MGR, "role = 'admin'", GONE_MGR)).toBe('ROLE_ADMIN_ONLY')
    expect(await restUpdate(GONE_ADM, "role = 'admin'", GONE_MGR)).toBe('ROLE_ADMIN_ONLY')
    await asUser(GONE_ADM)
    expect(await rpcUpdate(ALICE, 'manager')).toBe('ROLE_ADMIN_ONLY')     // RPC 안의 UPDATE 도 같은 트리거를 지난다
    expect(await roleOf(ALICE)).toBe('employee')
    expect(await listAll()).toBe('OK')                                     // 아직 열려 있음 (007 대상)
    expect(await restUpdate(GONE_MGR, "name = '김직원x'", ALICE)).toBe('OK')
    expect(await nameOf(ALICE)).toBe('김직원x')
    await asUser(null)
    await exec(`update public.employees set name = '김직원' where id = '${ALICE}'`)
  })
})

describe('C. 007 — 관리자 판정 함수에 is_active', () => {
  it('적용 후 비활성 인사담당은 0행, 비활성 admin 의 RPC 는 Unauthorized, 활성 계정은 그대로', async () => {
    await exec(sql('007_active_admin_functions.sql'))
    expect(await isAdminChecksActive()).toBe(true)
    expect(await restUpdate(GONE_MGR, "name = '김직원x'", ALICE)).toBe('OK')   // 오류 없이 0행
    expect(await nameOf(ALICE)).toBe('김직원')
    await asUser(GONE_ADM)
    expect(await rpcUpdate(ALICE, 'manager')).toBe('Unauthorized')
    expect(await listAll()).toBe('Unauthorized')
    expect(await restUpdate(MGR, "name = '김직원2'", ALICE)).toBe('OK')
    expect(await nameOf(ALICE)).toBe('김직원2')
    await asUser(BOSS)
    expect(await listAll()).toBe('OK')
    expect(await rpcUpdate(ALICE, 'employee')).toBe('OK')
    await asUser(null)
    await exec(`update public.employees set name = '김직원' where id = '${ALICE}'`)
  })

  it('907 → 원래 정의로 복원(비활성 인사담당이 다시 수정 가능), 906 → 트리거 제거, 다시 적용(멱등)', async () => {
    await exec(sql('907_rollback_active_admin_functions.sql'))
    expect(await isAdminChecksActive()).toBe(false)
    expect(await restUpdate(GONE_MGR, "name = '김직원x'", ALICE)).toBe('OK')
    expect(await nameOf(ALICE)).toBe('김직원x')
    await asUser(null)
    await exec(`update public.employees set name = '김직원' where id = '${ALICE}'`)
    await exec(sql('906_rollback_role_guard.sql'))
    expect(await triggerCount()).toBe(0)
    expect(await restUpdate(MGR, "role = 'admin'", ALICE)).toBe('OK')          // 되돌리면 다시 열린다
    await asUser(null)
    await exec(`update public.employees set role = 'employee' where id = '${ALICE}'`)
    await exec(sql('006_employees_role_guard.sql'))
    await exec(sql('006_employees_role_guard.sql'))
    await exec(sql('007_active_admin_functions.sql'))
    await exec(sql('007_active_admin_functions.sql'))
    expect(await triggerCount()).toBe(1)
    expect(await isAdminChecksActive()).toBe(true)
    expect(await restUpdate(MGR, "role = 'admin'", ALICE)).toBe('ROLE_ADMIN_ONLY')
  })
})

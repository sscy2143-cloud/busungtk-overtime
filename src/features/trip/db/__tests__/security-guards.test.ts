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
const BOB = '00000000-0000-0000-0000-000000000002'     // employee (shim)
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
const countAs = async (uid: string, q: string) => {
  await asUser(uid)
  await exec('set role authenticated')
  try { return Number((await one<{ n: string }>(`select count(*)::text as n from (${q}) s`)).n) } finally { await exec('reset role') }
}
/** PostgREST 처럼 세션 사용자 + authenticated 역할로 임의 문장 실행 */
const restRun = async (uid: string | null, stmt: string, role: 'authenticated' | 'anon' = 'authenticated') => {
  await asUser(uid)
  await exec(`set role ${role}`)
  try { return await codeOf(exec(stmt)) } finally { await exec('reset role') }
}
const fnAttrs = (name: string) => one<{ a: string }>(`select prosecdef::text || '|' || provolatile::text || '|' || coalesce(proacl::text, '-') || '|' || coalesce(proconfig::text, '-') || '|' || proowner::regrole::text as a from pg_proc where oid = $1::regprocedure`, [name]).then((x) => x.a)
const isAdminChecksActive = async () => (await one<{ ok: boolean }>("select pg_get_functiondef('public.is_admin()'::regprocedure) like '%is_active%' as ok")).ok

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
  await exec(`insert into public.employees (id, name, role, is_active) values
    ('${MGR}', '인사담당', 'manager', true), ('${GONE_MGR}', '퇴사인사', 'manager', false), ('${GONE_ADM}', '전대표', 'admin', false) on conflict (id) do nothing`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('D. 시급·2차 인증 해시 노출 — employees_select_active_for_group 재현과 008 차단 (금액은 읽지 않고 행 수만)', () => {
  it('재현: 일반 직원이 다른 활성 직원 전원의 행을 읽고, 그 행에 hourly_wage·second_auth_hash 가 포함된다', async () => {
    await asUser(null)
    await exec(`update public.employees set hourly_wage = 12345, second_auth_hash = 'hash' where id = '${BOSS}'`)
    expect(await countAs(ALICE, `select id from public.employees where id <> '${ALICE}'`)).toBeGreaterThanOrEqual(3)   // BOSS·MGR·BOB…
    expect(await countAs(ALICE, `select 1 from public.employees where id = '${BOSS}' and hourly_wage is not null and second_auth_hash is not null`)).toBe(1)
    expect(await countAs(ALICE, `select id from public.employees where id = '${GONE_MGR}'`)).toBe(0)   // 비활성은 안 보인다
  })

  it('008a: 뷰는 활성 직원의 비민감 칼럼만 — 민감 칼럼은 아예 없고, anon 은 못 읽는다', async () => {
    await exec(sql('008a_employees_directory_view.sql'))
    expect(await countAs(ALICE, 'select id from public.employees_directory')).toBe(4)   // ALICE·BOB·BOSS·MGR (비활성 2명 제외)
    await asUser(ALICE); await exec('set role authenticated')
    expect(await codeOf(one('select hourly_wage from public.employees_directory'))).toMatch(/column "hourly_wage" does not exist/)
    expect(await codeOf(one('select second_auth_hash from public.employees_directory'))).toMatch(/does not exist/)
    await exec('reset role')
    await asUser(null); await exec('set role anon')
    expect(await codeOf(one('select id from public.employees_directory'))).toMatch(/permission denied/)
    await exec('reset role')
    // 정책을 아직 안 지웠으므로 base 표 노출은 그대로 (앱 배포 전 단계)
    expect(await countAs(ALICE, `select 1 from public.employees where id = '${BOSS}' and hourly_wage is not null`)).toBe(1)
  })

  it('008a 권한: 기본 권한(default privileges)으로 붙은 ALL 이 회수돼 authenticated 는 SELECT 뿐 — 뷰를 통한 INSERT·UPDATE·DELETE 는 permission denied, anon·PUBLIC 은 없음', async () => {
    const grants = await rows<{ grantee: string; priv: string }>("select grantee, privilege_type as priv from information_schema.role_table_grants where table_schema = 'public' and table_name = 'employees_directory' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') order by 1, 2")
    expect(grants).toEqual([{ grantee: 'authenticated', priv: 'SELECT' }, { grantee: 'service_role', priv: 'SELECT' }])
    // 단순 뷰라 자동 갱신 가능(updatable) 하지만 권한이 없어 쓰지 못한다
    expect(Number((await one<{ m: number }>("select pg_relation_is_updatable('public.employees_directory'::regclass, false) as m")).m)).toBeGreaterThan(0)
    expect(await restRun(ALICE, `update public.employees_directory set name = 'x' where id = '${BOSS}'`)).toMatch(/permission denied/)
    expect(await restRun(ALICE, `delete from public.employees_directory where id = '${BOSS}'`)).toMatch(/permission denied/)
    expect(await restRun(ALICE, "insert into public.employees_directory (id, name) values ('00000000-0000-0000-0000-00000000000b', 'x')")).toMatch(/permission denied/)
    expect(await restRun(MGR, `update public.employees_directory set name = 'x' where id = '${BOSS}'`)).toMatch(/permission denied/)
    expect(await nameOf(BOSS)).toBe('박대표')
    // 임의 필터·칼럼 선택으로 민감 칼럼에 닿을 수 없다 (PostgREST 도 같은 SQL 을 만든다)
    expect(await restRun(ALICE, 'select id from public.employees_directory where hourly_wage > 0')).toMatch(/column "hourly_wage" does not exist/)
    expect(await restRun(ALICE, 'select id from public.employees_directory order by second_auth_hash')).toMatch(/does not exist/)
    expect(await restRun(ALICE, 'select email from public.employees_directory')).toMatch(/does not exist/)
    // 비활성(퇴사) 계정 세션은 명부도 못 본다
    expect(await countAs(GONE_MGR, 'select id from public.employees_directory')).toBe(0)
    expect(await countAs(GONE_ADM, 'select id from public.employees_directory')).toBe(0)
  })

  it('우회 경로: register_employee(SECURITY DEFINER) 는 기존 id 를 넣으면 전체 행을 돌려준다 — 008b 가 EXECUTE 를 회수한다 (H0 와 멱등)', async () => {
    expect(await restRun(ALICE, `select (public.register_employee('${BOSS}'::uuid, 'x', 'y')).hourly_wage`)).toBe('OK')   // 기본 권한이면 열려 있다
  })

  it('008b: 정책 제거 후 일반 직원은 base 표에서 본인 행만, 인사담당·대표는 전원(시급 포함) 그대로, register_employee 호출 거부', async () => {
    await exec(sql('008b_drop_group_select_policy.sql'))
    expect(await restRun(ALICE, `select (public.register_employee('${BOSS}'::uuid, 'x', 'y')).hourly_wage`)).toMatch(/permission denied/)
    expect(await restRun(ALICE, `select 1 from public.employees where id = '${BOSS}' and second_auth_hash is not null`)).toBe('OK')
    expect(await countAs(ALICE, `select 1 from public.employees where id = '${BOSS}' and second_auth_hash is not null`)).toBe(0)
    expect(await countAs(ALICE, 'select id from public.employees')).toBe(1)
    expect(await countAs(ALICE, `select 1 from public.employees where id = '${BOSS}'`)).toBe(0)
    expect(await countAs(ALICE, `select 1 from public.employees where id = '${ALICE}' and hourly_wage is not null`)).toBe(1)   // 본인 시급은 본인 행
    expect(await countAs(ALICE, 'select id from public.employees_directory')).toBe(4)                                 // 이름 목록은 그대로
    expect(await countAs(MGR, 'select hourly_wage from public.employees')).toBe(6)
    expect(await countAs(BOSS, 'select hourly_wage from public.employees')).toBe(6)
  })

  it('역할별: anon 거부, employees 행 없는 auth 사용자 0행, 일반 직원·인사담당·대표는 활성 명부(비민감 칼럼)만', async () => {
    await asUser(null); await exec('set role anon')
    expect(await codeOf(one('select id from public.employees_directory'))).toMatch(/permission denied/)
    await exec('reset role')
    expect(await countAs(NEWBIE, 'select id from public.employees_directory')).toBe(0)
    for (const uid of [ALICE, MGR, BOSS]) expect(await countAs(uid, 'select id, name, department, role, employee_type from public.employees_directory')).toBe(4)
    expect(await countAs(GONE_MGR, 'select id from public.employees_directory')).toBe(0)   // 비활성 계정은 명부도 0행 (호출자 활성 조건)
    const cols = (await rows<{ c: string }>("select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'employees_directory' order by ordinal_position")).map((x) => x.c)
    expect(cols).toEqual(['id', 'name', 'department', 'role', 'employee_type', 'is_active'])
  })

  it('security_invoker = true 면 008b 뒤 일반 직원은 뷰에서도 본인 행만 본다 → 반드시 false(기본) 로 둔다; 소유자는 RLS 를 지나지 않는다', async () => {
    expect((await one<{ ok: boolean }>("select (not relforcerowsecurity) as ok from pg_class where oid = 'public.employees'::regclass")).ok).toBe(true)
    expect((await one<{ ok: boolean }>("select (select relowner from pg_class where oid = 'public.employees'::regclass) = (select relowner from pg_class where oid = 'public.employees_directory'::regclass) as ok")).ok).toBe(true)
    expect((await one<{ o: string }>("select array_to_string(reloptions, ',') as o from pg_class where oid = 'public.employees_directory'::regclass")).o).toContain('security_invoker=false')
    await exec('alter view public.employees_directory set (security_invoker = true)')
    expect(await countAs(ALICE, 'select id from public.employees_directory')).toBe(1)     // 호출자 RLS: 본인 행만 → 명부 기능이 깨진다
    expect(await countAs(MGR, 'select id from public.employees_directory')).toBe(4)
    await exec('alter view public.employees_directory set (security_invoker = false)')
    expect(await countAs(ALICE, 'select id from public.employees_directory')).toBe(4)
  })

  it('908: 정책 복원·뷰 제거 → 다시 전원 노출 (되돌리기 동작 확인), 008a·008b 재적용', async () => {
    await exec(sql('908_rollback_wage_protection.sql'))
    expect(await countAs(ALICE, `select 1 from public.employees where id = '${BOSS}' and hourly_wage is not null`)).toBe(1)
    expect((await one<{ ok: boolean }>("select to_regclass('public.employees_directory') is null as ok")).ok).toBe(true)
    await exec(sql('008a_employees_directory_view.sql'))
    await exec(sql('008b_drop_group_select_policy.sql'))
    expect(await countAs(ALICE, 'select id from public.employees')).toBe(1)
    await asUser(null)
    await exec(`update public.employees set hourly_wage = 0, second_auth_hash = null where id = '${BOSS}'`)
  })
})

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

  it('006·007 적용 스크립트: 한 배치 적용, 원본 정의 보존, 함수 속성(소유자·권한·설정·volatility) 유지, 재실행은 ALREADY_APPLIED, 907 은 보존 원본으로 정확히 복원', async () => {
    const before = { ia: await one<{ d: string }>("select pg_get_functiondef('public.is_admin()'::regprocedure) as d"), im: await one<{ d: string }>("select pg_get_functiondef('public.is_manager_or_admin()'::regprocedure) as d") }
    const attrsBefore = [await fnAttrs('public.is_admin()'), await fnAttrs('public.is_manager_or_admin()')]
    await exec(sql('보안패치-006-007-적용.sql'))
    expect(await triggerCount()).toBe(1)
    expect(await isAdminChecksActive()).toBe(true)
    expect([await fnAttrs('public.is_admin()'), await fnAttrs('public.is_manager_or_admin()')]).toEqual(attrsBefore)   // security definer·stable·acl·config·owner 그대로
    const saved = await rows<{ object: string; definition: string }>("select object, definition from public.security_patch_backup where patch = '007' order by object")
    expect(saved.map((s) => s.object)).toEqual(['is_admin()', 'is_manager_or_admin()'])
    expect(saved[0].definition).toBe(before.ia.d)
    expect(saved[1].definition).toBe(before.im.d)
    // 보존 표는 관리자 외 접근 불가
    expect(await restRun(MGR, 'select * from public.security_patch_backup')).toMatch(/permission denied/)
    // 재실행 → 사전 점검에서 중단, 아무것도 안 바뀜 (보존 행도 늘지 않음)
    expect(await codeOf(exec(sql('보안패치-006-007-적용.sql')))).toBe('ALREADY_APPLIED')
    await exec('rollback')   // 배치가 begin 뒤 raise 로 중단되면 세션은 중단된 트랜잭션 상태 — SQL Editor 는 자동으로 끝내지만 여기서는 명시
    expect(await triggerCount()).toBe(1)
    expect(Number((await one<{ n: string }>("select count(*)::text as n from public.security_patch_backup")).n)).toBe(2)
    // 907 → 보존 원본과 바이트 단위로 같은 정의, 906 → 트리거 제거
    await exec(sql('907_rollback_active_admin_functions.sql'))
    expect((await one<{ d: string }>("select pg_get_functiondef('public.is_admin()'::regprocedure) as d")).d).toBe(before.ia.d)
    expect((await one<{ d: string }>("select pg_get_functiondef('public.is_manager_or_admin()'::regprocedure) as d")).d).toBe(before.im.d)
    expect([await fnAttrs('public.is_admin()'), await fnAttrs('public.is_manager_or_admin()')]).toEqual(attrsBefore)
    await exec(sql('906_rollback_role_guard.sql'))
    expect(await triggerCount()).toBe(0)
    expect(await isAdminChecksActive()).toBe(false)
    // 전제가 달라지면(with_check 생김) 중단
    await exec('alter policy "employees_update_manager_admin" on public.employees with check (true)')
    expect(await codeOf(exec(sql('보안패치-006-007-적용.sql')))).toBe('PRECONDITION_CHANGED')
    await exec('rollback')
    expect(await triggerCount()).toBe(0)
    await exec('drop policy "employees_update_manager_admin" on public.employees; create policy "employees_update_manager_admin" on public.employees for update using (public.is_manager_or_admin())')
    await exec('drop table public.security_patch_backup')
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

describe('E. D13 — 급여명세서 표·Storage: 010 RESTRICTIVE 로 비활성 계정 차단, 활성 관리자·본인 조회 유지 (금액 없음, 행 수만)', () => {
  const rowsOf = (uid: string, q: string) => countAs(uid, q)
  const seed = async () => {
    await asUser(null)
    await exec('delete from storage.objects; delete from public.payslips')
    await exec(`insert into public.payslips (employee_id, period, file_path, file_name) values ('${ALICE}', '2026-10', '${ALICE}/2026-10_x.pdf', 'a.pdf'), ('${MGR}', '2026-10', '${MGR}/2026-10_y.pdf', 'm.pdf'), ('${GONE_MGR}', '2026-09', '${GONE_MGR}/2026-09_z.pdf', 'g.pdf')`)
    await exec(`insert into storage.objects (bucket_id, name) values ('payslips', '${ALICE}/2026-10_x.pdf'), ('payslips', '${MGR}/2026-10_y.pdf'), ('payslips', '${GONE_MGR}/2026-09_z.pdf'), ('payslips', 'notices/files/n.pdf'), ('receipts', 'r/1.jpg')`)
  }
  const total = async () => Number((await one<{ n: string }>('select count(*)::text as n from public.payslips')).n)

  it('재현(007 적용 상태): 비활성 manager 가 표 전체·파일 전체를 읽고 지울 수 있고, 비활성 직원도 본인 명세서를 읽는다', async () => {
    await exec(sql('007_active_admin_functions.sql'))
    await seed()
    expect(await rowsOf(GONE_MGR, 'select id from public.payslips')).toBe(3)
    expect(await rowsOf(GONE_MGR, "select id from storage.objects where bucket_id = 'payslips'")).toBe(4)
    expect(await restRun(GONE_MGR, `delete from public.payslips where employee_id = '${MGR}'`)).toBe('OK')
    expect(await total()).toBe(2)                                                                  // 실제로 지워졌다
    expect(await rowsOf(GONE_ADM, 'select id from public.payslips')).toBe(2)
    expect(await rowsOf(GONE_MGR, "select id from public.payslips where employee_id = '" + GONE_MGR + "'")).toBe(1)   // 비활성 직원 본인 행
    expect(await rowsOf(ALICE, 'select id from public.payslips')).toBe(1)                          // 활성 직원 본인만
    expect(await rowsOf(ALICE, "select id from storage.objects where bucket_id = 'payslips'")).toBe(1)
    await seed()
  })

  it('010 적용: 비활성 admin·manager·직원은 표·파일의 SELECT/INSERT/UPDATE/DELETE 전부 0행·거부', async () => {
    await exec(sql('010_payslips_active_only_restrictive.sql'))
    for (const uid of [GONE_MGR, GONE_ADM]) {
      expect(await rowsOf(uid, 'select id from public.payslips')).toBe(0)
      expect(await rowsOf(uid, "select id from storage.objects where bucket_id = 'payslips'")).toBe(0)
      expect(await restRun(uid, 'delete from public.payslips')).toBe('OK'); expect(await total()).toBe(3)             // 0행
      expect(await restRun(uid, "update public.payslips set file_name = 'hack'")).toBe('OK')
      expect(Number((await one<{ n: string }>("select count(*)::text as n from public.payslips where file_name = 'hack'")).n)).toBe(0)
      expect(await restRun(uid, `insert into public.payslips (employee_id, period, file_path, file_name) values ('${uid}', '2026-11', 'p', 'n')`)).toMatch(/row-level security/)
      expect(await restRun(uid, "insert into storage.objects (bucket_id, name) values ('payslips', 'x/1.pdf')")).toMatch(/row-level security/)
      expect(await restRun(uid, "delete from storage.objects where bucket_id = 'payslips'")).toBe('OK')
      expect(Number((await one<{ n: string }>("select count(*)::text as n from storage.objects where bucket_id = 'payslips'")).n)).toBe(4)
    }
    expect(await rowsOf(GONE_MGR, "select id from public.payslips where employee_id = '" + GONE_MGR + "'")).toBe(0)   // 비활성 직원 본인 명세서도 차단
    expect(await rowsOf(GONE_MGR, "select id from storage.objects where name like '" + GONE_MGR + "/%'")).toBe(0)
  })

  it('010 적용: 활성 admin·manager 는 표·파일 CRUD 그대로, 활성 직원은 본인 조회만, anon 0행, 다른 버킷(receipts·공지 경로) 무영향', async () => {
    for (const uid of [MGR, BOSS]) {
      expect(await rowsOf(uid, 'select id from public.payslips')).toBe(3)
      expect(await rowsOf(uid, "select id from storage.objects where bucket_id = 'payslips'")).toBe(4)
      expect(await restRun(uid, `insert into public.payslips (employee_id, period, file_path, file_name) values ('${BOB}', '2026-11', '${BOB}/2026-11.pdf', 'b.pdf')`)).toBe('OK')
      expect(await restRun(uid, "insert into storage.objects (bucket_id, name) values ('payslips', '" + BOB + "/2026-11.pdf')")).toBe('OK')
      expect(await restRun(uid, "update public.payslips set file_name = 'b2.pdf' where employee_id = '" + BOB + "'")).toBe('OK')
      expect(await restRun(uid, "update storage.objects set name = name where bucket_id = 'payslips' and name like '" + BOB + "/%'")).toBe('OK')
      expect(await restRun(uid, "delete from public.payslips where employee_id = '" + BOB + "'")).toBe('OK')
      expect(await restRun(uid, "delete from storage.objects where bucket_id = 'payslips' and name like '" + BOB + "/%'")).toBe('OK')
      expect(await total()).toBe(3)
    }
    expect(await rowsOf(ALICE, 'select id from public.payslips')).toBe(1)
    expect(await rowsOf(ALICE, "select id from storage.objects where bucket_id = 'payslips'")).toBe(1)                 // 본인 폴더만
    expect(await restRun(ALICE, `insert into public.payslips (employee_id, period, file_path, file_name) values ('${ALICE}', '2026-11', 'p', 'n')`)).toMatch(/row-level security/)
    expect(await rowsOf(ALICE, "select id from storage.objects where bucket_id = 'receipts'")).toBe(1)                 // 다른 버킷 그대로
    expect(await rowsOf(GONE_MGR, "select id from storage.objects where bucket_id = 'receipts'")).toBe(1)              // 비활성도 다른 버킷은 010 과 무관
    await asUser(null); await exec('set role anon')                                                              // anon: 기본 권한은 있으나(S-4·S-7) 정책이 없어 0행
    expect(Number((await one<{ n: string }>('select count(*)::text as n from public.payslips')).n)).toBe(0)
    await exec('reset role')                                                                                     // storage.objects 의 anon 권한은 운영 설정이 달라 여기서는 보지 않는다
    const pols = await rows<{ p: string; permissive: string }>("select policyname as p, permissive from pg_policies where (schemaname = 'public' and tablename = 'payslips') or (schemaname = 'storage' and tablename = 'objects' and policyname like 'payslips%') order by 1")
    expect(pols.filter((x) => x.permissive === 'RESTRICTIVE').map((x) => x.p)).toEqual(['payslips_active_only_restrictive', 'payslips_storage_active_only_restrictive'])
    expect(pols.length).toBe(10)                                                                   // 기존 8개 + 2개, 본문 불변
  })

  it('사전 점검: 재실행은 ALREADY_APPLIED, 정책 이름이 다르면 PRECONDITION_CHANGED, 007 없으면 중단; 910 은 추가분만 제거', async () => {
    expect(await codeOf(exec(sql('010_payslips_active_only_restrictive.sql')))).toBe('ALREADY_APPLIED'); await exec('rollback')
    await exec(sql('910_rollback_payslips_active_only.sql'))
    expect(await rowsOf(GONE_MGR, 'select id from public.payslips')).toBe(3)                      // 되돌리면 재노출 (문서화)
    await exec('alter policy "payslips_delete_admin" on public.payslips rename to "payslips_delete_admin_x"')
    expect(await codeOf(exec(sql('010_payslips_active_only_restrictive.sql')))).toBe('PRECONDITION_CHANGED'); await exec('rollback')
    await exec('alter policy "payslips_delete_admin_x" on public.payslips rename to "payslips_delete_admin"')
    await exec(sql('907_rollback_active_admin_functions.sql'))
    expect(await codeOf(exec(sql('010_payslips_active_only_restrictive.sql')))).toBe('PRECONDITION_CHANGED'); await exec('rollback')
    await exec(sql('007_active_admin_functions.sql'))
    await exec(sql('010_payslips_active_only_restrictive.sql'))
    expect(await rowsOf(GONE_MGR, 'select id from public.payslips')).toBe(0)
    await asUser(null)
    await exec('delete from storage.objects; delete from public.payslips')
    await exec(sql('910_rollback_payslips_active_only.sql'))
    await exec(sql('907_rollback_active_admin_functions.sql'))   // 이후 섹션(C)은 007 미적용 상태 전제
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

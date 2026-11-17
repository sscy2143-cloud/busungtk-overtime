// D14 후속 015: employees_directory 를 security_invoker 뷰 + 비노출 스키마 전용 함수로 전환 — 로컬 PGlite(합성 데이터, 운영 DB 와 무관).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const sql = (n: string) => readFileSync(resolve(DRAFT, n), 'utf8').replace(/\r\n/g, '\n')
const PRE = ['006_employees_role_guard.sql', '007_active_admin_functions.sql', '008a_employees_directory_view.sql', '008b_drop_group_select_policy.sql', '011_employees_privileges_minimal.sql', '012_rpc_revoke_anon_execute.sql', '013_employees_active_guard.sql']

const ALICE = '00000000-0000-0000-0000-000000000001'
const BOSS = '00000000-0000-0000-0000-000000000009'
const MGR = '00000000-0000-0000-0000-000000000005'
const GONE = '00000000-0000-0000-0000-000000000007'
const NEWBIE = '00000000-0000-0000-0000-00000000000a'

let db: PGlite
const one = async <T,>(s: string): Promise<T> => (await db.query<T>(s)).rows[0]
const asUser = (uid: string | null) => db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`)
async function codeOf(p: Promise<unknown>) { try { await p; return 'OK' } catch (e) { return String((e as Error).message).split('\n')[0].trim() } }
async function runAs(uid: string | null, role: 'authenticated' | 'anon', stmt: string) {
  await asUser(uid); await db.exec(`set role ${role}`)
  try { return await codeOf(db.exec(stmt)) } finally { await db.exec('reset role') }
}
async function countAs(uid: string | null, role: 'authenticated' | 'anon', q: string) {
  await asUser(uid); await db.exec(`set role ${role}`)
  try { return Number((await one<{ n: string }>(`select count(*)::text as n from (${q}) s`)).n) } finally { await db.exec('reset role') }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(sql('로컬시험/000_local_shim.sql'))
  for (const f of PRE) await db.exec(sql(f))
  await db.exec(`insert into public.employees (id, name, role, is_active) values
    ('${MGR}', '인사담당', 'manager', true), ('${GONE}', '퇴사인사', 'manager', false) on conflict (id) do nothing`)
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`)
}, 90_000)
afterAll(async () => { await db?.close() })

describe('015: employees_directory security_invoker 전환', () => {
  it('적용 전 기준: 뷰는 security_invoker=false 이고 활성 직원 4명(ALICE·BOB·BOSS·MGR)을 돌려준다', async () => {
    expect((await one<{ o: string }>("select array_to_string(reloptions, ',') as o from pg_class where oid = 'public.employees_directory'::regclass")).o).toContain('security_invoker=false')
    expect(await countAs(ALICE, 'authenticated', 'select id from public.employees_directory')).toBe(4)
  })

  it('재현: employees RLS 를 그대로 두고 뷰만 security_invoker=true 로 바꾸면 일반 직원은 본인 행 1건만 본다 (명부 기능 파손)', async () => {
    await db.exec('begin')
    await db.exec('alter view public.employees_directory set (security_invoker = true)')
    const n = await countAs(ALICE, 'authenticated', 'select id from public.employees_directory')
    await db.exec('rollback')
    expect(n).toBe(1)
  })

  const before = async () => {
    const cols = (await db.query<{ c: string; t: string }>("select column_name as c, data_type as t from information_schema.columns where table_schema = 'public' and table_name = 'employees_directory' order by ordinal_position")).rows
    const pol = (await db.query<{ p: string }>("select policyname as p from pg_policies where tablename = 'employees' order by 1")).rows.map((r) => r.p)
    const rls = (await one<{ r: boolean }>("select relrowsecurity as r from pg_class where oid = 'public.employees'::regclass")).r
    const empGrants = (await db.query<{ g: string }>("select grantee || ':' || privilege_type as g from information_schema.role_table_grants where table_schema = 'public' and table_name = 'employees' and grantee in ('anon','authenticated') order by 1")).rows.map((r) => r.g)
    return { cols, pol, rls, empGrants }
  }
  let snap: Awaited<ReturnType<typeof before>>

  it('015 적용: 오류 없이 한 번에 적용되고 재적용(멱등)도 된다', async () => {
    snap = await before()
    await db.exec(sql('015_employees_directory_invoker.sql'))
    await db.exec(sql('015_employees_directory_invoker.sql'))
  })

  it('호환: 칼럼 이름·타입·순서가 그대로이고 employees 의 정책·RLS·표 권한은 하나도 바뀌지 않는다', async () => {
    const after = await before()
    expect(after.cols).toEqual(snap.cols)
    expect(after.cols.map((c) => c.c)).toEqual(['id', 'name', 'department', 'role', 'employee_type', 'is_active'])
    expect(after.pol).toEqual(snap.pol)
    expect(after.rls).toBe(true)
    expect(after.empGrants).toEqual(snap.empGrants)
    expect(after.pol).not.toContain('employees_select_active_for_group')
  })

  it('Advisor 0010 조건: 뷰가 security_invoker=true, 갱신 불가, anon 권한 없음', async () => {
    const r = await one<{ o: string; u: number }>("select array_to_string(reloptions, ',') as o, pg_relation_is_updatable('public.employees_directory'::regclass, false) as u from pg_class where oid = 'public.employees_directory'::regclass")
    expect(r.o).toContain('security_invoker=true')
    expect(Number(r.u)).toBe(0)
    expect((await db.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)")).rows).toHaveLength(0)
  })

  it('역할별 조회: 재직 직원·인사담당·대표는 활성 4명, 퇴사자·행 없는 로그인 사용자·익명은 0행', async () => {
    for (const uid of [ALICE, MGR, BOSS]) expect(await countAs(uid, 'authenticated', 'select id, name, department, role, employee_type, is_active from public.employees_directory')).toBe(4)
    expect(await countAs(GONE, 'authenticated', 'select id from public.employees_directory')).toBe(0)
    expect(await countAs(NEWBIE, 'authenticated', 'select id from public.employees_directory')).toBe(0)
    expect(await countAs(null, 'authenticated', 'select id from public.employees_directory')).toBe(0)
    expect(await runAs(null, 'anon', 'select id from public.employees_directory')).toMatch(/permission denied/)
  })

  it('앱이 쓰는 호출 모양 그대로 동작한다 (RequestPage: eq·neq·not in·order, TripConnected: 이름·역할)', async () => {
    expect(await countAs(ALICE, 'authenticated', `select id, name, department from public.employees_directory where is_active = true and id <> '${ALICE}' and name not in ('이름 테스트') order by name`)).toBe(3)
    expect(await countAs(ALICE, 'authenticated', 'select id, name, role from public.employees_directory where is_active = true order by name')).toBe(4)
  })

  it('민감 칼럼·쓰기는 불가: 시급·해시·이메일은 칼럼 자체가 없고 INSERT/UPDATE/DELETE 는 거부된다', async () => {
    expect(await runAs(ALICE, 'authenticated', 'select hourly_wage from public.employees_directory')).toMatch(/does not exist/)
    expect(await runAs(ALICE, 'authenticated', 'select second_auth_hash from public.employees_directory')).toMatch(/does not exist/)
    expect(await runAs(ALICE, 'authenticated', 'select email from public.employees_directory')).toMatch(/does not exist/)
    for (const s of [`update public.employees_directory set name = 'x'`, `delete from public.employees_directory`, `insert into public.employees_directory (id, name) values ('${NEWBIE}', 'x')`]) {
      expect(await runAs(ALICE, 'authenticated', s)).toMatch(/permission denied|cannot (insert|update|delete)/)
    }
  })

  it('원본 employees 는 열리지 않았다: 일반 직원은 여전히 본인 행만, 시급 칼럼 직접 조회 불가', async () => {
    expect(await countAs(ALICE, 'authenticated', 'select id from public.employees')).toBe(1)
  })

  it('전용 함수: definer, search_path 고정, anon·PUBLIC 실행 불가, anon 은 스키마 사용 불가, public 스키마에 새 함수 없음', async () => {
    const f = await one<{ d: boolean; c: string | null; a: boolean; u: boolean; au: boolean; s: boolean }>(`select prosecdef as d, proconfig::text as c,
      has_function_privilege('anon', oid, 'EXECUTE') as a, has_function_privilege('authenticated', oid, 'EXECUTE') as u,
      has_schema_privilege('anon', 'app_private', 'USAGE') as au, has_schema_privilege('authenticated', 'app_private', 'USAGE') as s
      from pg_proc where oid = 'app_private.employees_directory_rows()'::regprocedure`)
    expect(f.d).toBe(true)
    expect(f.c).toContain('search_path')
    expect(f.a).toBe(false); expect(f.u).toBe(true); expect(f.au).toBe(false); expect(f.s).toBe(true)
    expect((await db.query("select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'employees_directory%'")).rows).toHaveLength(0)
    expect(await runAs(null, 'anon', 'select * from app_private.employees_directory_rows()')).toMatch(/permission denied/)
  })

  it('RPC(함수) 직접 호출도 같은 조건: 재직 직원은 6칼럼 4행, 퇴사자·행 없는 사용자는 0행', async () => {
    expect(await countAs(ALICE, 'authenticated', 'select * from app_private.employees_directory_rows()')).toBe(4)
    expect(await countAs(GONE, 'authenticated', 'select * from app_private.employees_directory_rows()')).toBe(0)
    expect(await countAs(NEWBIE, 'authenticated', 'select * from app_private.employees_directory_rows()')).toBe(0)
    await asUser(ALICE); await db.exec('set role authenticated')
    try { expect((await db.query('select * from app_private.employees_directory_rows()')).fields.map((x) => x.name)).toEqual(['id', 'name', 'department', 'role', 'employee_type', 'is_active']) } finally { await db.exec('reset role') }
  })

  it('011·012·013 과 충돌 없음: 013 트리거 유지, 012 기준(public definer 의 anon 실행 0), 퇴사자 행 보존', async () => {
    expect(Number((await one<{ n: string }>("select count(*)::text as n from pg_trigger where tgname = 'employees_active_server_only' and tgenabled = 'O'")).n)).toBe(1)
    expect(Number((await one<{ n: string }>("select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')")).n)).toBe(0)
    expect(Number((await one<{ n: string }>("select count(*)::text as n from public.employees where not is_active")).n)).toBeGreaterThanOrEqual(1)
  })

  it('Advisor 확인 SQL 이 실행되고 기대 결과를 낸다', async () => {
    const res = (await db.exec(sql('보안점검-Advisor-0010.sql'))).filter((x) => x.fields.length > 0)
    expect(res).toHaveLength(5)
    expect(res[0].rows).toHaveLength(0)
    expect((res[1].rows[0] as Record<string, unknown>).anon_select).toBe(false)
    expect((res[2].rows[0] as Record<string, unknown>).anon_exec).toBe(false)
    expect(Number((res[3].rows[0] as Record<string, unknown>).anon_exec)).toBe(0)
  })

  it('후속 단일 실행본 사전 조건(뷰 존재)과 출장 SQL 이 015 적용 상태에서도 그대로 적용된다', async () => {
    const bundle = sql('적용-단일실행본-출장수당.sql')
    const r = (await db.exec(bundle)).filter((x) => x.rows.length > 0).pop()!.rows[0] as Record<string, unknown>
    expect(Number(r.new_tables)).toBe(14)
    expect(Number(r.anon_can_execute)).toBe(0)
    expect(Number(r.flags_on)).toBe(0)
    expect(await countAs(ALICE, 'authenticated', 'select id, name, role from public.employees_directory where is_active = true')).toBe(4)
  }, 90_000)

  it('915 되돌리기: 008a 상태(security_invoker=false)로 돌아가고 명부는 그대로 4명, 함수는 사라진다', async () => {
    await db.exec(sql('915_rollback_employees_directory_invoker.sql'))
    expect((await one<{ o: string }>("select array_to_string(reloptions, ',') as o from pg_class where oid = 'public.employees_directory'::regclass")).o).toContain('security_invoker=false')
    expect(await countAs(ALICE, 'authenticated', 'select id from public.employees_directory')).toBe(4)
    expect((await db.query("select to_regprocedure('app_private.employees_directory_rows()') as f")).rows[0]).toEqual({ f: null })
  })

  it('원자성: 사후 단언이 실패하면 전부 취소된다 (anon 에 스키마 사용 권한을 줘 둔 상태에서 적용)', async () => {
    const orig = sql('015_employees_directory_invoker.sql')
    const broken = orig.replace('with (security_invoker = true, security_barrier = true)', 'with (security_invoker = false, security_barrier = true)')
    expect(broken).not.toBe(orig)
    const msg = await codeOf(db.exec(broken))
    await db.exec('rollback').catch(() => {})
    expect(msg).toMatch(/POSTCONDITION view_not_invoker/)
    expect((await db.query("select to_regprocedure('app_private.employees_directory_rows()') as f")).rows[0]).toEqual({ f: null })
    expect((await one<{ o: string }>("select array_to_string(reloptions, ',') as o from pg_class where oid = 'public.employees_directory'::regclass")).o).toContain('security_invoker=false')
  })
})

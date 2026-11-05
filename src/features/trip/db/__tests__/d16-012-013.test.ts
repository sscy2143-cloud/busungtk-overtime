// 012 v2(권한 보존형 anon 회수) 와 013(is_active 서버 전용 가드) 로컬 검증. 합성 데이터, 운영 무관.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const sql = (name: string) => readFileSync(resolve(DRAFT, name), 'utf8')
const ALICE = '00000000-0000-0000-0000-000000000001'
const BOSS = '00000000-0000-0000-0000-000000000009'
const MGR = '00000000-0000-0000-0000-000000000005'

let db: PGlite
const exec = (s: string) => db.exec(s)
const asUser = (uid: string | null) => exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claims', '${JSON.stringify({ role: 'authenticated', sub: uid ?? '' })}', false);`)
async function run(uid: string | null, stmt: string, role = 'authenticated'): Promise<string> {
  await asUser(uid)
  await exec(`set role ${role}`)
  try { await exec(stmt); return 'ok' } catch (e) { return String((e as Error).message) } finally { await exec('reset role') }
}
const can = async (role: string, fn: string) =>
  (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}'::regprocedure, 'EXECUTE') as ok`)).rows[0].ok
const activeOf = async (id: string) =>
  (await db.query<{ a: boolean }>(`select is_active as a from public.employees where id = '${id}'`)).rows[0].a

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
  await exec(`insert into public.employees (id, name, role) values ('${MGR}', '최인사', 'manager') on conflict do nothing`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('012 v2 — 권한 보존형', () => {
  it('원래 authenticated 가 막혀 있던 함수는 012 뒤에도 막혀 있다 (새로 열지 않는다)', async () => {
    await exec('create function public.zz_locked() returns int language sql security definer as $$ select 1 $$')
    await exec('revoke execute on function public.zz_locked() from public, authenticated')
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
    expect(await can('anon', 'public.zz_locked()')).toBe(false)
    expect(await can('authenticated', 'public.zz_locked()')).toBe(false)
    expect(await can('service_role', 'public.zz_locked()')).toBe(true)
  })

  it('anon 은 어떤 definer 함수도 실행 못 하고, authenticated 는 기존 함수를 그대로 실행한다', async () => {
    const r = (await db.query<{ n: string }>(
      "select count(*)::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')")).rows[0]
    expect(r.n).toBe('0')
    expect(await can('authenticated', 'public.is_admin()')).toBe(true)
    expect(await run(null, 'select public.is_admin()', 'anon')).toMatch(/permission denied/)
    expect(await run(BOSS, 'select public.is_admin()')).toBe('ok')
    expect(await run(BOSS, 'select * from public.list_all_employees()')).toBe('ok')
    expect(await run(BOSS, 'select id from public.employees')).toBe('ok')   // 정책 안의 함수 호출도 정상
  })

  it('멱등이며 912 가 anon 실행을 되돌린다', async () => {
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
    expect(await can('anon', 'public.is_admin()')).toBe(false)
    await exec(sql('912_rollback_rpc_anon_execute.sql'))
    expect(await can('anon', 'public.is_admin()')).toBe(true)
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
  })
})

describe('013 — is_active 는 서버 API 만 바꾼다', () => {
  it('적용 전 재현: 인사담당·대표가 REST 로 is_active 를 직접 바꿀 수 있다', async () => {
    expect(await run(MGR, `update public.employees set is_active = false where id = '${ALICE}'`)).toBe('ok')
    expect(await activeOf(ALICE)).toBe(false)
    await exec(`update public.employees set is_active = true where id = '${ALICE}'`)
  })

  it('적용 후: 인사담당·대표의 직접 UPDATE 와 RPC p_is_active 가 거부된다', async () => {
    await exec(sql('013_employees_active_guard.sql'))
    expect(await run(MGR, `update public.employees set is_active = false where id = '${ALICE}'`)).toMatch(/ACTIVE_VIA_SERVER_ONLY/)
    expect(await run(BOSS, `update public.employees set is_active = false where id = '${ALICE}'`)).toMatch(/ACTIVE_VIA_SERVER_ONLY/)
    expect(await run(BOSS, `select public.update_employee_admin(null, '${ALICE}', null, null, null, false)`)).toMatch(/ACTIVE_VIA_SERVER_ONLY/)
    expect(await activeOf(ALICE)).toBe(true)
  })

  it('기존 업무는 그대로: 값이 같은 is_active, 다른 칼럼 수정, RPC 의 이름·부서 수정', async () => {
    expect(await run(BOSS, `update public.employees set is_active = true, hourly_wage = 11000 where id = '${ALICE}'`)).toBe('ok')
    expect(await run(MGR, `update public.employees set department = '생산' where id = '${ALICE}'`)).toBe('ok')
    expect(await run(BOSS, `select public.update_employee_admin(null, '${ALICE}', '김직원', null, null, null)`)).toBe('ok')
  })

  it('서버(service_role)와 SQL Editor 경로는 통과한다', async () => {
    expect(await run(null, `update public.employees set is_active = false where id = '${ALICE}'`, 'service_role')).toBe('ok')
    expect(await activeOf(ALICE)).toBe(false)
    await exec(`update public.employees set is_active = true where id = '${ALICE}'`)
    expect(await activeOf(ALICE)).toBe(true)
  })

  it('멱등이며 913 으로 단독 되돌려진다', async () => {
    await exec(sql('013_employees_active_guard.sql'))
    await exec(sql('913_rollback_employees_active_guard.sql'))
    expect(await run(BOSS, `update public.employees set is_active = true where id = '${ALICE}'`)).toBe('ok')
    const t = (await db.query<{ n: string }>("select count(*)::text as n from pg_trigger where tgname = 'employees_active_server_only'")).rows[0]
    expect(t.n).toBe('0')
  })
})

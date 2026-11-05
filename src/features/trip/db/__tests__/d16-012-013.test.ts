// 012 v3(기록 후 선택 회수·자가 검증) 와 013 v2(is_active 서버 전용 가드) 로컬 검증. 합성 데이터, 운영 무관.
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
const asUser = (uid: string | null, claimRole = 'authenticated') => exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claims', '${JSON.stringify({ role: claimRole, sub: uid ?? '' })}', false);`)
async function run(uid: string | null, stmt: string, role = 'authenticated', claimRole = role): Promise<string> {
  await asUser(uid, claimRole)
  await exec(`set role ${role}`)
  try { await exec(stmt); return 'ok' } catch (e) { return String((e as Error).message) } finally { await exec('reset role') }
}
const can = async (role: string, fn: string) =>
  (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}'::regprocedure, 'EXECUTE') as ok`)).rows[0].ok
const activeOf = async (id: string) =>
  (await db.query<{ a: boolean }>(`select is_active as a from public.employees where id = '${id}'`)).rows[0].a
const anonCount = async () => (await db.query<{ n: string }>(
  "select count(*)::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')")).rows[0].n

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
  await exec(`insert into public.employees (id, name, role) values ('${MGR}', '최인사', 'manager') on conflict do nothing`)
  // 운영 모사: Auth 훅·스토리지 역할, anon 에 속한 로그인 역할
  await exec(`create role supabase_auth_admin nologin; create role authenticator nologin; grant anon to authenticator;
    create function public.zz_hook() returns int language sql security definer as $$ select 1 $$;
    revoke execute on function public.zz_hook() from authenticated;
    create function public.zz_locked() returns int language sql security definer as $$ select 1 $$;
    revoke execute on function public.zz_locked() from public, authenticated, anon;`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('012 v3 — 기록 후 선택 회수', () => {
  it('재현: 적용 전에는 anon 이 definer 함수를 실행할 수 있다', async () => {
    expect(Number(await anonCount())).toBeGreaterThan(5)
  })

  it('자가 검증: 재부여 단계를 빼면 ACL_VERIFY_FAILED 로 중단되고 전부 취소된다', async () => {
    const broken = sql('012_rpc_revoke_anon_execute.sql').replace("'grant execute on function %s to %I'", "'select 1 /* %s %I */'")
    expect(broken).not.toBe(sql('012_rpc_revoke_anon_execute.sql'))
    const before = await anonCount()
    let msg = 'ok'
    try { await exec(broken) } catch (e) { msg = String((e as Error).message) }
    await exec('rollback')
    expect(msg).toMatch(/ACL_VERIFY_FAILED/)
    expect(await anonCount()).toBe(before)          // 중간 회수가 남지 않았다
    expect(await can('authenticated', 'public.is_admin()')).toBe(true)
  })

  it('적용: anon 0개, 다른 역할 권한은 기록과 동일, 원래 막힌 함수는 새로 열리지 않는다', async () => {
    const authBefore = (await db.query<{ n: string }>("select count(*)::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE')")).rows[0].n
    const r = await db.exec(sql('012_rpc_revoke_anon_execute.sql'))
    const summary = r.filter(x => x.rows.length > 0).pop()!.rows[0] as Record<string, unknown>
    expect(Number(summary.anon_now_must_0)).toBe(0)
    expect(String(summary.authenticated_now)).toBe(authBefore)
    expect(await anonCount()).toBe('0')
    expect(await can('authenticated', 'public.zz_locked()')).toBe(false)
    expect(await can('service_role', 'public.zz_locked()')).toBe(true)    // 원래 있던 권한 유지
    expect(await can('authenticated', 'public.zz_hook()')).toBe(true)    // PUBLIC 로 열려 있던 그대로 유지(기록과 동일)
    expect(await can('supabase_auth_admin', 'public.zz_hook()')).toBe(true) // PUBLIC 로만 열려 있던 훅 역할 보존
  })

  it('기존 업무는 그대로: 로그인 사용자 RPC, RLS 보조 함수, 익명 호출 거부', async () => {
    expect(await run(null, 'select public.is_admin()', 'anon')).toMatch(/permission denied/)
    expect(await run(BOSS, 'select public.is_admin()')).toBe('ok')
    expect(await run(BOSS, 'select * from public.list_all_employees()')).toBe('ok')
    expect(await run(BOSS, 'select id from public.employees')).toBe('ok')
    expect(await run(ALICE, `select id from public.employees where id = '${ALICE}'`)).toBe('ok')
  })

  it('멱등이며 912 가 anon 실행을 되돌린다', async () => {
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
    expect(await anonCount()).toBe('0')
    await exec(sql('912_rollback_rpc_anon_execute.sql'))
    expect(Number(await anonCount())).toBeGreaterThan(5)
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
    expect(await anonCount()).toBe('0')
  })
})

describe('013 v2 — is_active 는 서버 API 만 바꾼다', () => {
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

  it('일반 직원도 막힌다: UPDATE 권한을 일부러 열어 둬도 사용자 id 없는 anon 토큰도 거부', async () => {
    await exec('grant update on public.employees to anon')                 // 011 이 빠진 최악 상황 가정
    expect(await run(null, `update public.employees set is_active = false where id = '${ALICE}'`, 'anon')).toMatch(/ACTIVE_VIA_SERVER_ONLY|permission denied|0/)
    expect(await activeOf(ALICE)).toBe(true)
    await exec('revoke update on public.employees from anon')
    expect(await run(ALICE, `update public.employees set is_active = false where id = '${ALICE}'`)).not.toBe('')
    expect(await activeOf(ALICE)).toBe(true)
  })

  it('기존 업무는 그대로: 값이 같은 is_active, 다른 칼럼 수정, RPC 의 이름·부서 수정, 기존 트리거(006 role 보호)', async () => {
    await exec(sql('006_employees_role_guard.sql'))
    expect(await run(BOSS, `update public.employees set is_active = true, hourly_wage = 11000 where id = '${ALICE}'`)).toBe('ok')
    expect(await run(MGR, `update public.employees set department = '생산' where id = '${ALICE}'`)).toBe('ok')
    expect(await run(BOSS, `select public.update_employee_admin(null, '${ALICE}', '김직원', null, null, null)`)).toBe('ok')
    expect(await run(MGR, `update public.employees set role = 'admin' where id = '${ALICE}'`)).toMatch(/ROLE_ADMIN_ONLY/)
  })

  it('서버(service_role 토큰)와 SQL Editor 경로는 통과한다', async () => {
    expect(await run(null, `update public.employees set is_active = false where id = '${ALICE}'`, 'service_role')).toBe('ok')
    expect(await activeOf(ALICE)).toBe(false)
    await exec(`select set_config('request.jwt.claims', '', false); select set_config('request.jwt.claim.sub', '', false)`)
    await exec(`update public.employees set is_active = true where id = '${ALICE}'`)   // SQL Editor: 클레임 없음
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

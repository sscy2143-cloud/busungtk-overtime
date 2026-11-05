// 012 v4(원본 ACL 보관·선택 회수·자가 검증)·912 v2(정확 복원) 와 013 v2(is_active 서버 전용 가드) 로컬 검증.
// 합성 데이터, 운영 무관.
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
// 함수별 ACL(소유자 제외) 전체 스냅샷 — 정확 비교용
const aclSnapshot = async () => (await db.query<{ s: string }>(
  `select p.oid::regprocedure::text || '|' || case when x.grantee = 0 then 'PUBLIC' else (select rolname from pg_roles where oid = x.grantee) end || '|' || x.is_grantable::text as s
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   where n.nspname = 'public' and p.prosecdef and x.grantee <> p.proowner order by 1`)).rows.map(r => r.s)
const effective = async (roles: string[]) => (await db.query<{ s: string }>(
  `select p.oid::regprocedure::text || '|' || r.rolname || '|' || has_function_privilege(r.oid, p.oid, 'EXECUTE')::text as s
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join pg_roles r
   where n.nspname = 'public' and p.prosecdef and r.rolname = any($1) order by 1`, [roles])).rows.map(r => r.s)

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
  await exec(`insert into public.employees (id, name, role) values ('${MGR}', '최인사', 'manager') on conflict do nothing`)
  // 운영 모사: Auth 훅·스토리지 역할, anon 에 속한 로그인 역할, 부여 옵션, 원래 닫힌 함수
  await exec(`create role supabase_auth_admin nologin; create role authenticator nologin; grant anon to authenticator;
    create function public.zz_hook() returns int language sql security definer as $$ select 1 $$;
    revoke execute on function public.zz_hook() from authenticated;
    create function public.zz_locked() returns int language sql security definer as $$ select 1 $$;
    revoke execute on function public.zz_locked() from public, authenticated, anon;
    create function public.zz_opt() returns int language sql security definer as $$ select 1 $$;
    grant execute on function public.zz_opt() to authenticated with grant option;`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('012 v4 — 원본 ACL 보관·선택 회수', () => {
  let original: string[]
  it('재현: 적용 전에는 anon 이 definer 함수를 실행할 수 있다', async () => {
    expect(Number(await anonCount())).toBeGreaterThan(5)
    original = await aclSnapshot()
  })

  it('자가 검증: 재부여 단계를 빼면 ACL_VERIFY_FAILED 로 중단되고 보관본까지 전부 취소된다', async () => {
    const broken = sql('012_rpc_revoke_anon_execute.sql').replace("'grant execute on function %s to %I'", "'select 1 /* %s %I */'")
    expect(broken).not.toBe(sql('012_rpc_revoke_anon_execute.sql'))
    let msg = 'ok'
    try { await exec(broken) } catch (e) { msg = String((e as Error).message) }
    await exec('rollback')
    expect(msg).toMatch(/ACL_VERIFY_FAILED/)
    expect(await aclSnapshot()).toEqual(original)                                   // 중간 회수가 남지 않았다
    const t = await db.query<{ n: string | null }>("select to_regclass('ops_backup.rpc_acl_012')::text as n")
    expect(t.rows[0].n).toBeNull()                                                  // 보관 테이블도 취소
  })

  it('적용: anon 0개, anon 외 모든 역할의 실효 권한은 적용 전과 동일, 원래 닫힌 것은 새로 열리지 않는다', async () => {
    const roles = ['authenticated', 'service_role', 'supabase_auth_admin', 'postgres']
    const effBefore = await effective(roles)
    const r = await db.exec(sql('012_rpc_revoke_anon_execute.sql'))
    const summary = r.filter(x => x.rows.length > 0).pop()!.rows[0] as Record<string, unknown>
    expect(Number(summary.anon_now_must_0)).toBe(0)
    expect(String(summary.authenticated_now)).toBe(String(summary.authenticated_before))
    expect(Number(summary.backed_up_functions)).toBe(Number(summary.definer_functions))
    expect(await effective(roles)).toEqual(effBefore)                               // 권한 확대·손실 모두 없음
    expect(await anonCount()).toBe('0')
    expect(await can('authenticated', 'public.zz_locked()')).toBe(false)
    expect(await can('supabase_auth_admin', 'public.zz_hook()')).toBe(true)         // PUBLIC 로만 열려 있던 훅 역할 보존
    const opt = await db.query<{ g: boolean }>("select x.is_grantable as g from pg_proc p cross join lateral aclexplode(p.proacl) x where p.oid = 'public.zz_opt()'::regprocedure and x.grantee = (select oid from pg_roles where rolname = 'authenticated')")
    expect(opt.rows[0].g).toBe(true)                                                // 부여 옵션 보존
  })

  it('보관본: 함수·역할 이름과 부여 옵션만 담고 개인정보·인증정보 칼럼이 없으며 외부 역할은 접근할 수 없다', async () => {
    const cols = (await db.query<{ c: string }>("select column_name as c from information_schema.columns where table_schema = 'ops_backup' and table_name = 'rpc_acl_012' order by 1")).rows.map(r => r.c)
    expect(cols).toEqual(['fn_oid', 'grantable', 'grantee', 'sig', 'taken_at'])
    const dump = JSON.stringify((await db.query('select * from ops_backup.rpc_acl_012')).rows)
    expect(dump).not.toContain('김직원')
    expect(dump).not.toContain('최인사')
    for (const role of ['anon', 'authenticated']) {
      expect(await run(BOSS, 'select * from ops_backup.rpc_acl_012', role)).toMatch(/permission denied/)
    }
  })

  it('기존 업무는 그대로: 로그인 사용자 RPC, RLS 보조 함수, 익명 호출 거부', async () => {
    expect(await run(null, 'select public.is_admin()', 'anon')).toMatch(/permission denied/)
    expect(await run(BOSS, 'select public.is_admin()')).toBe('ok')
    expect(await run(BOSS, 'select * from public.list_all_employees()')).toBe('ok')
    expect(await run(BOSS, 'select id from public.employees')).toBe('ok')
    expect(await run(ALICE, `select id from public.employees where id = '${ALICE}'`)).toBe('ok')
  })

  it('재실행(멱등): 보관본은 최초 원본을 유지하고 ACL 도 그대로다', async () => {
    const aclNow = await aclSnapshot()
    const n1 = (await db.query<{ n: string }>('select count(*)::text as n from ops_backup.rpc_acl_012')).rows[0].n
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
    const n2 = (await db.query<{ n: string }>('select count(*)::text as n from ops_backup.rpc_acl_012')).rows[0].n
    expect(n2).toBe(n1)
    expect(await aclSnapshot()).toEqual(aclNow)
    const pub = (await db.query<{ n: string }>("select count(*)::text as n from ops_backup.rpc_acl_012 where grantee in ('PUBLIC', 'anon')")).rows[0].n
    expect(Number(pub)).toBeGreaterThan(5)                                           // 원본의 anon/PUBLIC 기록이 지워지지 않았다
  })

  it('912 v2: 적용 전 ACL 로 정확히 복원하고, 원래 없던 권한은 새로 주지 않으며, 이후 만든 함수는 건드리지 않는다', async () => {
    await exec('create function public.zz_new() returns int language sql security definer as $$ select 1 $$')
    await exec('revoke execute on function public.zz_new() from anon')
    const newAcl = (await db.query<{ a: string }>("select coalesce(proacl::text, 'null') as a from pg_proc where oid = 'public.zz_new()'::regprocedure")).rows[0].a
    await exec(sql('912_rollback_rpc_anon_execute.sql'))
    const after = (await aclSnapshot()).filter(s => !s.startsWith('zz_new'))
    expect(after).toEqual(original.filter(s => !s.startsWith('zz_new')))     // 정확히 동일
    expect(await can('authenticated', 'public.zz_locked()')).toBe(false)             // 원래 없던 권한 신규 부여 없음
    const afterNew = (await db.query<{ a: string }>("select coalesce(proacl::text, 'null') as a from pg_proc where oid = 'public.zz_new()'::regprocedure")).rows[0].a
    expect(afterNew).toBe(newAcl)
    expect(Number(await anonCount())).toBeGreaterThan(5)
    await exec(sql('012_rpc_revoke_anon_execute.sql'))                               // 복원 후 다시 적용 가능
    expect(await anonCount()).toBe('0')
  })

  it('912 v2: 보관본이 없으면 NO_BACKUP 으로 중단한다 (아무것도 바꾸지 않음)', async () => {
    await exec('begin; drop table ops_backup.rpc_acl_012; commit;').catch(() => {})
    const before = await aclSnapshot()
    let msg = 'ok'
    try { await exec(sql('912_rollback_rpc_anon_execute.sql')) } catch (e) { msg = String((e as Error).message) }
    await exec('rollback').catch(() => {})
    expect(msg).toMatch(/NO_BACKUP/)
    expect(await aclSnapshot()).toEqual(before)
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

  it('일반 직원도 막힌다: UPDATE 권한을 일부러 열어 둬도 사용자 id 없는 anon 토큰도 거부', async () => {
    await exec('grant update on public.employees to anon')                 // 011 이 빠진 최악 상황 가정
    await exec('grant execute on all functions in schema public to anon')   // 012 도 없는 상황
    await exec('grant select on public.employees to anon; create policy zz_anon_sel on public.employees for select to anon using (true)')
    await exec('create policy zz_anon_upd on public.employees for update to anon using (true)')   // RLS 까지 열린 상황
    expect(await run(null, `update public.employees set is_active = false where id = '${ALICE}'`, 'anon')).toMatch(/ACTIVE_VIA_SERVER_ONLY/)
    expect(await activeOf(ALICE)).toBe(true)
    await exec('drop policy zz_anon_upd on public.employees; drop policy zz_anon_sel on public.employees; revoke select on public.employees from anon')
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

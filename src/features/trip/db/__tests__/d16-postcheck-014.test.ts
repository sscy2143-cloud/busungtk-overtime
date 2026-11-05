// 012 사후 점검 SQL(읽기전용)과 014 기본 권한 제안 로컬 검증. 합성 데이터, 운영 무관.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const sql = (name: string) => readFileSync(resolve(DRAFT, name), 'utf8')
let db: PGlite
const exec = (s: string) => db.exec(s)

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
  await exec(`create role supabase_auth_admin nologin;
    create function public.zz_hook() returns int language sql security definer as $$ select 1 $$;`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('012 사후 점검 SQL', () => {
  it('적용 전에는 [1] 에 anon 실행 가능 함수가 나오고, 적용 후에는 [1]·[2] 가 0 행이다', async () => {
    await exec(sql('012_rpc_revoke_anon_execute.sql'))
    const r = (await db.exec(sql('보안점검-012-사후.sql'))).filter(x => x.fields.length > 0)
    expect(r).toHaveLength(3)
    expect(r[0].rows).toHaveLength(0)                      // anon 실행 가능 0
    expect(r[1].rows).toHaveLength(0)                      // 원본 대비 실효 권한 변화 0
    const s = r[2].rows[0] as Record<string, unknown>
    expect(Number(s.backed_up)).toBe(Number(s.definer_functions))
    expect(Number(s.authenticated_exec)).toBeGreaterThan(5)
  })

  it('권한이 손실되면 [2] 가 그 함수를 잡아낸다 (사후 점검의 감지력)', async () => {
    await exec('revoke execute on function public.zz_hook() from supabase_auth_admin, authenticated')
    const r = (await db.exec(sql('보안점검-012-사후.sql'))).filter(x => x.fields.length > 0)
    expect(r[1].rows.length).toBeGreaterThan(0)
    await exec('grant execute on function public.zz_hook() to supabase_auth_admin, authenticated')
  })
})

describe('014 (제안) 새 함수의 기본 EXECUTE', () => {
  it('적용 전: 새 함수는 anon·PUBLIC 에도 열린다 → 적용 후: 닫히고, 기존 함수는 그대로', async () => {
    await exec('create function public.zz_before014() returns int language sql security definer as $$ select 1 $$')
    expect((await db.query<{ ok: boolean }>("select has_function_privilege('anon', 'public.zz_before014()'::regprocedure, 'EXECUTE') as ok")).rows[0].ok).toBe(true)
    const authBefore = (await db.query<{ ok: boolean }>("select has_function_privilege('authenticated', 'public.zz_before014()'::regprocedure, 'EXECUTE') as ok")).rows[0].ok
    await exec(sql('014_default_function_privileges.sql'))
    await exec('create function public.zz_after014() returns int language sql security definer as $$ select 1 $$')
    const can = async (role: string, fn: string) => (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}'::regprocedure, 'EXECUTE') as ok`)).rows[0].ok
    expect(await can('anon', 'public.zz_after014()')).toBe(false)
    expect(await can('service_role', 'public.zz_after014()')).toBe(true)
    expect(await can('anon', 'public.zz_before014()')).toBe(true)                 // 기존 함수는 바뀌지 않는다
    expect(await can('authenticated', 'public.zz_before014()')).toBe(authBefore)
  })

  it('914 가 기본 권한을 원래대로 되돌린다', async () => {
    await exec(sql('914_rollback_default_function_privileges.sql'))
    await exec('create function public.zz_after914() returns int language sql security definer as $$ select 1 $$')
    expect((await db.query<{ ok: boolean }>("select has_function_privilege('anon', 'public.zz_after914()'::regprocedure, 'EXECUTE') as ok")).rows[0].ok).toBe(true)
  })
})

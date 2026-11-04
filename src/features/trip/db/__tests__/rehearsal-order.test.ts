// 운영 도입 SQL 순서 리허설 (로컬 PGlite, 합성 데이터). 운영 DB 와 무관.
// 순서: (운영 완료분은 shim 에 이미 반영) 011 → 012 → 005 → 010 → 020 → 030 → 040. 기능 스위치는 모두 OFF 로 끝나야 한다.
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
const one = async <T,>(q: string) => (await db.query<T>(q)).rows[0]

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
}, 60_000)
afterAll(async () => { await db?.close() })

describe('도입 SQL 순서 리허설', () => {
  it('011 → 012 → 005 → 010 → 020 → 030 → 040 이 순서대로 오류 없이 적용된다', async () => {
    for (const f of ['011_employees_privileges_minimal.sql', '012_rpc_revoke_anon_execute.sql', '005_employees_position.sql', '010_trip_tables.sql', '020_trip_feature_flags.sql', '030_trip_rls.sql', '040_trip_rpc.sql']) {
      await exec(sql(f))
    }
  })

  it('기능 스위치는 모두 꺼진 상태다 (켜진 항목 0)', async () => {
    const r = await one<{ n: string }>("select count(*)::text as n from public.trip_feature_flags where enabled")
    expect(r.n).toBe('0')
  })

  it('출장 SECURITY DEFINER 함수 어느 것도 anon 이 실행할 수 없다', async () => {
    const r = await one<{ n: string }>(
      `select count(*)::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')`)
    expect(r.n).toBe('0')
  })

  it('011 의 권한 정리가 유지된다 (anon 은 employees 불가, authenticated 는 삭제·초기화 불가)', async () => {
    expect(await run(null, 'select id from public.employees', 'anon')).toMatch(/permission denied/)
    expect(await run(ALICE, 'truncate public.employees')).toMatch(/permission denied/)
    expect(await run(BOSS, 'select id from public.employees')).toBe('ok')
  })

  it('기능 OFF 에서는 직원이 출장 RPC 를 불러도 거부된다 (데이터가 생기지 않는다)', async () => {
    const before = await one<{ n: string }>('select count(*)::text as n from public.trip_claims')
    const msg = await run(ALICE, "select public.trip_create_claim('{}'::jsonb, '[]'::jsonb, gen_random_uuid())")
    expect(msg).not.toBe('ok')
    const after = await one<{ n: string }>('select count(*)::text as n from public.trip_claims')
    expect(after.n).toBe(before.n)
  })

  it('기존 업무: 직원 본인 조회·대표 직원 조회가 그대로 된다', async () => {
    expect(await run(ALICE, `select id from public.employees where id = '${ALICE}'`)).toBe('ok')
    expect(await run(BOSS, 'select * from public.list_all_employees()')).toBe('ok')
  })

  it('900 롤백이 출장 객체만 제거하고 기존 employees 는 건드리지 않는다', async () => {
    const before = await one<{ n: string }>('select count(*)::text as n from public.employees')
    await exec(sql('900_rollback.sql'))
    const after = await one<{ n: string }>('select count(*)::text as n from public.employees')
    expect(after.n).toBe(before.n)
    const t = await one<{ n: string }>("select count(*)::text as n from pg_tables where schemaname = 'public' and tablename like 'trip\\_%'")
    expect(t.n).toBe('0')
  })
})

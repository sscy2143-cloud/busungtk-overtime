// 운영에 실행할 단일 실행본(적용-단일실행본-출장수당.sql) 검증 — 운영 상태 전제(006·007·011·012·013 적용) 위에서.
// 합성 데이터만 사용, 운영 DB 와 무관.
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const read = (name: string) => readFileSync(resolve(DRAFT, name), 'utf8').replace(/\r\n/g, '\n')
const BUNDLE = '적용-단일실행본-출장수당.sql'
const PARTS = ['005_employees_position.sql', '010_trip_tables.sql', '020_trip_feature_flags.sql', '030_trip_rls.sql', '040_trip_rpc.sql']
const PRE = ['006_employees_role_guard.sql', '007_active_admin_functions.sql', '008a_employees_directory_view.sql', '008b_drop_group_select_policy.sql', '011_employees_privileges_minimal.sql', '012_rpc_revoke_anon_execute.sql', '013_employees_active_guard.sql']

async function prodDb(skip: string[] = []) {
  const db = new PGlite()
  await db.exec(read('로컬시험/000_local_shim.sql'))
  for (const f of PRE) if (!skip.includes(f)) await db.exec(read(f))
  await db.exec(`insert into public.employees (id, name, role, is_active) values
    ('00000000-0000-0000-0000-0000000000a1', '퇴사자1', 'employee', false),
    ('00000000-0000-0000-0000-0000000000a2', '퇴사자2', 'employee', false),
    ('00000000-0000-0000-0000-0000000000a3', '퇴사자3', 'employee', false) on conflict (id) do nothing`)
  return db
}
const tripObjects = async (db: PGlite) => (await db.query<{ n: string }>(
  "select count(*)::text as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and (c.relname like 'trip\\_%' or c.relname = 'holidays')")).rows[0].n
async function tryExec(db: PGlite, sql: string): Promise<string> {
  try { await db.exec(sql); return 'ok' } catch (e) { await db.exec('rollback').catch(() => {}); return String((e as Error).message) }
}

describe('단일 실행본', () => {
  const bundle = read(BUNDLE)

  it('원본과 어긋나지 않는다: 머리 + 005·010·020·030·040 원본 전문 + 꼬리를 그대로 이어 붙인 것이다', () => {
    expect(bundle.startsWith(read('적용-머리.sql'))).toBe(true)
    expect(bundle.endsWith(read('적용-꼬리.sql'))).toBe(true)
    let at = read('적용-머리.sql').length
    for (const f of PARTS) {
      const src = read(f).replace(/\s*$/, '\n')
      const i = bundle.indexOf(src, at)
      expect(i, `${f} 전문이 순서대로 들어 있다`).toBeGreaterThanOrEqual(at)
      at = i + src.length
    }
  })

  it('011·012·013 은 포함하지 않는다 (재실행 금지)', () => {
    const code = bundle.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(code).not.toContain('ops_backup.rpc_acl_012_added')
    expect(code).not.toMatch(/create trigger employees_active_server_only/i)
    expect(code).not.toMatch(/revoke all on table public\.employees from anon/i)
    expect(code).not.toMatch(/create (or replace )?function public\.employees_active_guard/i)
    expect(code).not.toMatch(/\bcreate schema (if not exists )?ops_backup\b/i)
  })

  it('운영 상태 DB 에 한 번에 적용된다: 출장 객체 생성, 기존 데이터 건수 그대로, 기능 스위치 전부 OFF', async () => {
    const db = await prodDb()
    expect(await tripObjects(db)).toBe('0')
    const before = (await db.query<{ n: string }>('select count(*)::text as n from public.employees')).rows[0].n
    const r = (await db.exec(bundle)).filter((x) => x.rows.length > 0).pop()!.rows[0] as Record<string, unknown>
    expect(Number(r.new_tables)).toBe(14)   // 표 14개 (+ 뷰 1개는 표 집계에서 제외)
    expect(Number(r.new_functions)).toBeGreaterThanOrEqual(40)
    expect(Number(r.anon_can_execute)).toBe(0)
    expect(Number(r.flags_on)).toBe(0)
    expect(Number(r.definer_functions_now)).toBeGreaterThan(Number(r.definer_functions_before))
    expect((await db.query<{ n: string }>('select count(*)::text as n from public.employees')).rows[0].n).toBe(before)
    // 사용자가 적용 직후 실행하는 읽기전용 사후 점검: [1]·[2] 는 0행, 스위치는 전부 false, 트리거는 전부 활성(O)
    const post = (await db.exec(read('보안점검-출장-사후.sql'))).filter((x) => x.fields.length > 0)
    expect(post).toHaveLength(6)
    expect(post[0].rows).toHaveLength(0)
    expect(post[1].rows).toHaveLength(0)
    expect((post[2].rows as Array<{ enabled: boolean }>).length).toBeGreaterThan(0)
    expect((post[2].rows as Array<{ enabled: boolean }>).every((x) => x.enabled === false)).toBe(true)
    const trig = post[3].rows as Array<{ tgname: string; tgenabled: string }>
    expect(trig.every((t) => t.tgenabled === 'O')).toBe(true)
    expect(trig.map((t) => t.tgname)).toEqual(expect.arrayContaining(['employees_role_admin_only', 'employees_active_server_only']))
    expect(Number((post[5].rows[0] as Record<string, unknown>).anon_can_execute)).toBe(0)
    expect((await db.query<{ n: string }>("select count(*)::text as n from public.employees where not is_active and name like '퇴사자%'")).rows[0].n).toBe('3')
    await db.close()
  }, 90_000)

  it('두 번 실행하면 사전 조건에서 중단되고 아무것도 바뀌지 않는다', async () => {
    const db = await prodDb()
    await db.exec(bundle)
    const objs = await tripObjects(db)
    expect(await tryExec(db, bundle)).toMatch(/PRECONDITION (holidays_already_exists|trip_objects_already_exist)/)
    expect(await tripObjects(db)).toBe(objs)
    await db.close()
  }, 90_000)

  it.each([
    ['013_employees_active_guard.sql', /PRECONDITION missing_013_active_guard/],
    ['012_rpc_revoke_anon_execute.sql', /PRECONDITION missing_012_backup/],
    ['011_employees_privileges_minimal.sql', /PRECONDITION missing_011_employees_privileges/],
  ])('%s 가 빠진 DB 에는 적용되지 않고(사전 조건 중단) 출장 객체가 하나도 생기지 않는다', async (skip, msg) => {
    const db = await prodDb([skip])
    expect(await tryExec(db, bundle)).toMatch(msg)
    expect(await tripObjects(db)).toBe('0')
    await db.close()
  }, 90_000)

  it('중간에 오류가 나면(여기서는 040 을 일부러 깨뜨림) 005~030 까지 만든 것도 전부 취소된다', async () => {
    const db = await prodDb()
    const broken = bundle.replace('create or replace function public.trip_create_claim', 'create or replace function public.trip_create_claim_BROKEN(')
    expect(broken).not.toBe(bundle)
    expect(await tryExec(db, broken)).not.toBe('ok')
    expect(await tripObjects(db)).toBe('0')
    expect((await db.query<{ n: string }>("select count(*)::text as n from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name = 'position'")).rows[0].n).toBe('0')
    await db.close()
  }, 90_000)

  it('사후 단언이 동작한다: 신규 함수가 anon 에 열려 있으면 COMMIT 전에 중단된다 (010 의 트리거 함수 권한 회수를 빼 본다)', async () => {
    const db = await prodDb()
    const broken = bundle.replace(/revoke all on function public\.trip_append_only\(\)\s+from public, anon, authenticated;/, '-- removed')
    expect(broken).not.toBe(bundle)
    expect(await tryExec(db, broken)).toMatch(/POSTCONDITION/)
    expect(await tripObjects(db)).toBe('0')
    await db.close()
  }, 90_000)
})

// D15 퇴사자 Ban SQL 로컬 검증 — 합성 데이터만. auth.users 는 최소 스텁.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SQL = readFileSync(resolve(process.cwd(), 'docs/출장수당/T5-DB-초안/보안패치-D15-퇴사자Ban.sql'), 'utf8')
let db: PGlite

async function world(inactive: number) {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, banned_until timestamptz);
    create table public.employees (id uuid primary key, is_active boolean not null default true);
    create table public.overtime_requests (id serial primary key, employee_id uuid references public.employees(id));`)
  for (let i = 1; i <= 6; i++) {
    const id = `00000000-0000-0000-0000-00000000000${i}`
    await db.exec(`insert into auth.users (id) values ('${id}'); insert into public.employees (id, is_active) values ('${id}', ${i > inactive});
      insert into public.overtime_requests (employee_id) values ('${id}');`)
  }
}
beforeEach(() => { db = new PGlite() })
afterEach(async () => { await db.close() })

const count = async (q: string) => Number((await db.query<{ n: string }>(`select count(*)::text as n from (${q}) s`)).rows[0].n)

describe('D15 퇴사자 Ban SQL', () => {
  it('비활성 3명 → 3명만 Ban, 기록·행 수 불변, 활성 직원 Ban 0', async () => {
    await world(3)
    const res = await db.exec(SQL)
    const summary = res.find(r => r.fields.some(f => f.name === 'inactive_banned'))!.rows[0] as Record<string, unknown>
    expect(Number(summary.inactive_total)).toBe(3)
    expect(Number(summary.inactive_banned)).toBe(3)
    expect(Number(summary.active_banned_must_be_0)).toBe(0)
    expect(Number(summary.employees_total)).toBe(6)
    expect(Number(summary.auth_users_total)).toBe(6)
    expect(await count('select 1 from public.overtime_requests')).toBe(6)
    expect(await count('select 1 from auth.users where banned_until > now()')).toBe(3)
  })
  it('재실행: 이미 Ban 된 계정은 건드리지 않고(멱등) 결과 동일', async () => {
    await world(3)
    await db.exec(SQL)
    const before = (await db.query<{ b: string }>("select max(banned_until)::text as b from auth.users")).rows[0].b
    await db.exec(SQL)
    expect((await db.query<{ b: string }>("select max(banned_until)::text as b from auth.users")).rows[0].b).toBe(before)
  })
  it('비활성이 3명이 아니면 전체 중단 — 아무도 Ban 되지 않는다', async () => {
    await world(2)
    await expect(db.exec(SQL)).rejects.toThrow(/PRECONDITION_CHANGED/)
    await db.exec('rollback')
    expect(await count('select 1 from auth.users where banned_until is not null')).toBe(0)
  })
  it('Auth 계정이 없는 비활성 직원이 있으면 중단', async () => {
    await world(3)
    await db.exec("delete from auth.users where id = '00000000-0000-0000-0000-000000000001'")
    await expect(db.exec(SQL)).rejects.toThrow(/PRECONDITION_CHANGED/)
    await db.exec('rollback')
    expect(await count('select 1 from auth.users where banned_until is not null')).toBe(0)
  })
  it('삭제 문장이 없다', () => {
    expect(SQL).not.toMatch(/\bdelete\s+from\b|\btruncate\b|\bdrop\b|deleteUser/i)
  })
})

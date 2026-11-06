// 출장수당 SQL(005·010·020·030·040) 운영 반영 전 보안·데이터 보존 감사 — 운영 상태 전제(006·007·011·012·013 적용) 위에서 실행.
// Supabase 처럼 새 함수·표에 anon·authenticated 권한이 자동 부여되는 환경(shim 의 default privileges)이므로,
// 명시적으로 회수하지 않은 신규 객체는 여기서 드러난다. 합성 데이터만 사용, 운영 DB 와 무관.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const sql = (name: string) => readFileSync(resolve(DRAFT, name), 'utf8')
const ORDER = ['005_employees_position.sql', '010_trip_tables.sql', '020_trip_feature_flags.sql', '030_trip_rls.sql', '040_trip_rpc.sql']
const PRE = ['006_employees_role_guard.sql', '007_active_admin_functions.sql', '011_employees_privileges_minimal.sql', '012_rpc_revoke_anon_execute.sql', '013_employees_active_guard.sql']

let db: PGlite
const exec = (s: string) => db.exec(s)
const q = async <T,>(s: string) => (await db.query<T>(s)).rows

interface Snap { table: string; n: number; hash: string; constraints: number }
const snapshot = async (tables: string[]): Promise<Snap[]> => {
  const out: Snap[] = []
  for (const t of tables) {
    const r = (await q<{ n: string; h: string }>(`select count(*)::text as n, coalesce(md5(string_agg((to_jsonb(x) - 'position')::text, '|' order by (to_jsonb(x) - 'position')::text)), '') as h from public.${t} x`))[0]
    const c = (await q<{ n: string }>(`select count(*)::text as n from pg_constraint where conrelid = 'public.${t}'::regclass`))[0].n
    out.push({ table: t, n: Number(r.n), hash: r.h, constraints: Number(c) })
  }
  return out
}

// 운영에서 authenticated 가 실행해야 하는 신규 함수 전체 (이 목록 밖의 신규 함수가 열리면 실패)
const AUTHENTICATED_ALLOWLIST = [
  'trip_active_rule_version()', 'trip_admin_adjust_day(uuid,uuid,integer,jsonb,text)', 'trip_can_view_all()', 'trip_cancel(uuid,integer)',
  'trip_clock_to_min(text,boolean)', 'trip_create_claim(jsonb,jsonb,uuid)', 'trip_feature_enabled(text)', 'trip_has_view_grant()',
  'trip_invite_companions(uuid,uuid[])', 'trip_is_admin()', 'trip_review(uuid,text,uuid[],jsonb,text)', 'trip_set_feature(text,boolean,text)',
  'trip_set_view_grant(uuid,boolean,text)', 'trip_submit(uuid,integer)', 'trip_update_draft(uuid,integer,jsonb,jsonb)',
  'trip_view_grant_candidates()', 'trip_view_grant_eligible(uuid)',
].sort()

let before: Snap[] = []
let oldTables: string[] = []
let oldFns = new Set<string>()
const LEAVERS = ['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3']

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
  for (const f of PRE) await exec(sql(f))
  // 퇴사자 3명(비활성)과 이들의 과거 기록 — 합성
  for (const [i, id] of LEAVERS.entries()) {
    await exec(`insert into public.employees (id, name, role, is_active, hourly_wage) values ('${id}', '퇴사자${i + 1}', 'employee', false, 9000) on conflict (id) do nothing`)
  }
  oldTables = (await q<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public' order by 1")).map((r) => r.t)
  oldFns = new Set((await q<{ s: string }>("select p.oid::regprocedure::text as s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")).map((r) => r.s))
  before = await snapshot(oldTables)
  for (const f of ORDER) await exec(sql(f))
}, 90_000)
afterAll(async () => { await db?.close() })

describe('데이터 보존 — 기존 표는 행·내용·제약이 그대로', () => {
  it('기존 모든 표의 행 수·행 내용(해시)·제약 수가 같다 (employees 는 신규 position 칼럼만 제외)', async () => {
    expect(before.length).toBeGreaterThanOrEqual(3)
    const after = await snapshot(oldTables)
    // 005 가 position 칼럼의 검사 제약 1개를 더한다 — 이것만 허용하고 나머지(행 수·내용·다른 표의 제약)는 동일해야 한다
    expect(after.map((s) => (s.table === 'employees' ? { ...s, constraints: s.constraints - 1 } : s))).toEqual(before)
    const added = (await q<{ c: string }>(`select conname as c from pg_constraint where conrelid = 'public.employees'::regclass and pg_get_constraintdef(oid) ilike '%position%'`)).map((r) => r.c)
    expect(added).toHaveLength(1)
  })

  it('퇴사자 3명(비활성)의 행·UUID·비활성 상태가 그대로다', async () => {
    const r = await q<{ id: string; is_active: boolean }>(`select id, is_active from public.employees where id in ('${LEAVERS.join("','")}') order by id`)
    expect(r).toEqual(LEAVERS.map((id) => ({ id, is_active: false })))
  })

  it('005 는 칼럼 하나만 더한다: 기존 행의 position 은 전부 NULL, 기존 칼럼은 그대로', async () => {
    expect((await q<{ n: string }>('select count(*)::text as n from public.employees where position is not null'))[0].n).toBe('0')
    const cols = (await q<{ c: string }>("select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name = 'position'")).map((r) => r.c)
    expect(cols).toEqual(['position'])
  })

  it('SQL 5개 어디에도 기존 표의 삭제·초기화·대량 변경 문장이 없다', () => {
    for (const f of ORDER) {
      const code = sql(f).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      expect(code, f).not.toMatch(/\btruncate\s+(table\s+)?(only\s+)?(public\.)?(employees|overtime_requests|payslips)\b/i)
      expect(code, f).not.toMatch(/\bdrop\s+table\s+(if exists\s+)?public\.(employees|overtime_requests|payslips)\b/i)
      expect(code, f).not.toMatch(/\bdelete\s+from\s+public\.(employees|overtime_requests|payslips)\b/i)
      expect(code, f).not.toMatch(/\bupdate\s+public\.(employees|overtime_requests|payslips)\b/i)
    }
  })
})

describe('신규 함수 권한 — 012 의 목표(anon·PUBLIC 차단)가 신규 함수로 다시 열리지 않는다', () => {
  const newFns = async () => (await q<{ sig: string; def: boolean; cfg: string; anon: boolean; auth: boolean; svc: boolean; pub: boolean }>(
    `select p.oid::regprocedure::text as sig, p.prosecdef as def, coalesce(array_to_string(p.proconfig, ';'), '') as cfg,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
            exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as pub
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).filter((r) => !oldFns.has(r.sig))

  it('신규 함수가 실제로 만들어졌다 (검사 대상이 비어 있지 않다)', async () => {
    expect((await newFns()).length).toBeGreaterThanOrEqual(40)
  })

  it('anon 이 실행할 수 있는 신규 함수 0개, PUBLIC 에 열린 신규 함수 0개 (트리거 함수 포함)', async () => {
    const f = await newFns()
    expect(f.filter((r) => r.anon).map((r) => r.sig)).toEqual([])
    expect(f.filter((r) => r.pub).map((r) => r.sig)).toEqual([])
  })

  it('SECURITY DEFINER 신규 함수는 모두 search_path 가 고정돼 있다', async () => {
    expect((await newFns()).filter((r) => r.def && !/search_path/.test(r.cfg)).map((r) => r.sig)).toEqual([])
  })

  it('authenticated 가 실행할 수 있는 신규 함수는 허용 목록과 정확히 같다 (내부 보조·트리거·서버 전용은 닫힘)', async () => {
    const got = (await newFns()).filter((r) => r.auth).map((r) => r.sig.replace('public.', '')).sort()
    expect(got).toEqual(AUTHENTICATED_ALLOWLIST)
  })

  it('서버 저장 RPC(trip_store_server_calcs)는 service_role 만 실행한다', async () => {
    const f = (await newFns()).find((r) => r.sig.startsWith('trip_store_server_calcs'))!
    expect(f).toMatchObject({ anon: false, auth: false, svc: true })
  })

  it('기존 함수 포함 public 의 모든 SECURITY DEFINER 함수에서 anon 이 실행 가능한 것은 0개다 (012 상태 유지)', async () => {
    expect((await q<{ n: string }>("select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')"))[0].n).toBe('0')
  })
})

describe('신규 표 권한·RLS — 기능 스위치와 별개로 막혀 있다', () => {
  const newTables = async () => (await q<{ t: string; k: string; rls: boolean; inv: boolean }>(
    `select c.relname as t, c.relkind as k, c.relrowsecurity as rls, coalesce(c.reloptions::text, '') like '%security_invoker=true%' as inv
     from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v') order by 1`)).filter((r) => !oldTables.includes(r.t))

  it('신규 표는 전부 RLS 켜짐, 신규 뷰는 security_invoker', async () => {
    const t = await newTables()
    expect(t.length).toBeGreaterThanOrEqual(15)
    expect(t.filter((r) => r.k === 'r' && !r.rls).map((r) => r.t)).toEqual([])
    expect(t.filter((r) => r.k === 'v' && !r.inv).map((r) => r.t)).toEqual([])
  })

  it('anon 은 신규 표·뷰 어느 것도 어떤 권한도 없고, authenticated 는 읽기만(쓰기·삭제·초기화 없음)', async () => {
    const privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    for (const { t } of await newTables()) {
      for (const p of privs) {
        const r = (await q<{ a: boolean; u: boolean }>(`select has_table_privilege('anon', 'public.${t}', '${p}') as a, has_table_privilege('authenticated', 'public.${t}', '${p}') as u`))[0]
        expect(r.a, `${t} anon ${p}`).toBe(false)
        if (p !== 'SELECT') expect(r.u, `${t} authenticated ${p}`).toBe(false)
      }
    }
  })
})

describe('적용 직후 상태 — 기능은 전부 꺼져 있다', () => {
  it('기능 스위치 켜진 항목 0개, 급여 반영은 CHECK 제약으로도 잠겨 있다', async () => {
    expect((await q<{ n: string }>('select count(*)::text as n from public.trip_feature_flags where enabled'))[0].n).toBe('0')
    let msg = 'ok'
    try { await exec("update public.trip_feature_flags set enabled = true where key = 'payroll_apply'") } catch (e) { msg = String((e as Error).message) }
    expect(msg).toMatch(/payroll_locked|check constraint/)
  })

  it('신규 표는 비어 있고(규칙 버전·지역·스위치 기본 행만), 신청 자료는 0건', async () => {
    for (const t of ['trip_claims', 'trip_claim_days', 'trip_day_calcs', 'trip_reviews', 'trip_adjustments', 'trip_view_grants']) {
      expect((await q<{ n: string }>(`select count(*)::text as n from public.${t}`))[0].n, t).toBe('0')
    }
  })
})

/**
 * T5 SQL v2 로컬 검증 — PGlite(PostgreSQL WASM, 메모리) 에 000 shim → 010 → 020 → 030 → 040 을 적용하고
 * RPC 규칙을 실제로 실행해 본다. 마지막에 900 롤백 → 재적용.
 *
 * 운영 DB 와 전혀 연결되지 않는다 (연결 문자열이 없다). 운영 적용 전 확인 항목은 docs/출장수당/T5-DB-초안/로컬시험/README.md 4절.
 *
 * 여기서 흉내 내는 것: auth.uid() = 세션 설정값, 역할 anon/authenticated/service_role, is_manager_or_admin(), update_updated_at_column().
 * 흉내 내지 못하는 것(미검증): PostgREST 경유 RLS·오류 매핑, JWT 검증, Supabase 가 넣는 request.jwt.claims 의 실제 내용, 기본 권한(default privileges).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RULE_VERSION } from '../../engine'
import { NO_CALENDAR, computeClaimDays, type ClaimHeader, type DayEntry, type IsoDate, type TripDayRecord } from '../../data'
import type { StoredDayComputation } from '../../server'

const DRAFT = resolve(process.cwd(), 'docs/출장수당/T5-DB-초안')
const sql = (name: string) => readFileSync(resolve(DRAFT, name), 'utf8')
const FILES = ['010_trip_tables.sql', '020_trip_feature_flags.sql', '030_trip_rls.sql', '040_trip_rpc.sql']

const ALICE = '00000000-0000-0000-0000-000000000001'
const BOB = '00000000-0000-0000-0000-000000000002'
const MGR = '00000000-0000-0000-0000-000000000005'
const BOSS = '00000000-0000-0000-0000-000000000009'
const MON: IsoDate = '2026-11-09'
const TUE: IsoDate = '2026-11-10'

const header = (regions: string[], date: IsoDate): ClaimHeader => ({ regions, schedule: { kind: 'day', date } })
const entry = (date: IsoDate, start: string, end: string): DayEntry => ({ date, site: { start, end } })

let db: PGlite

const exec = (s: string) => db.exec(s)
const one = async <T,>(s: string, params: unknown[] = []): Promise<T> => (await db.query<T>(s, params)).rows[0]
const rows = async <T,>(s: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(s, params)).rows

/** 세션 사용자·역할 흉내. role 은 request.jwt.claims.role (service_role 판정용) */
const asUser = (uid: string | null, role: 'authenticated' | 'service_role' | 'anon' = 'authenticated') =>
  exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claims', '${JSON.stringify({ role, sub: uid ?? '' })}', false);`)
const asService = () => asUser(BOSS, 'service_role')

/** 예외 코드 — raise exception '<코드>' 의 message 첫 줄 */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK' } catch (e) { return String((e as Error).message).split('\n')[0].trim() }
}

const createClaim = (h: ClaimHeader, es: DayEntry[]) =>
  one<{ r: { id: string; version: number } }>('select public.trip_create_claim($1::jsonb, $2::jsonb) as r', [JSON.stringify(h), JSON.stringify(es)]).then((x) => x.r)
const updateDraft = (id: string, v: number, h: ClaimHeader | null, es: DayEntry[] | null) =>
  one<{ r: { id: string; version: number } }>('select public.trip_update_draft($1::uuid, $2::int, $3::jsonb, $4::jsonb) as r', [id, v, h && JSON.stringify(h), es && JSON.stringify(es)]).then((x) => x.r)
const submit = (id: string, v: number) => one<{ status: string; version: number; submitted_at: string | null }>('select status, version, submitted_at from public.trip_submit($1::uuid, $2::int)', [id, v])
const cancel = (id: string, v: number) => one<{ status: string; version: number }>('select status, version from public.trip_cancel($1::uuid, $2::int)', [id, v])
const invite = (id: string, ids: string[]) => one<{ r: { created: string[]; skipped: unknown[] } }>('select public.trip_invite_companions($1::uuid, $2::uuid[]) as r', [id, `{${ids.join(',')}}`]).then((x) => x.r)
const adjust = (claimId: string, dayId: string, rev: number, e: DayEntry, reason: string) =>
  one<{ r: { claimId: string; dayId: string; revision: number; version: number } }>('select public.trip_admin_adjust_day($1::uuid, $2::uuid, $3::int, $4::jsonb, $5::text) as r', [claimId, dayId, rev, JSON.stringify(e), reason]).then((x) => x.r)
const review = (claimId: string, action: string, calcIds: string[], decisions: unknown[] = [], reason: string | null = null) =>
  one<{ status: string; version: number }>('select status, version from public.trip_review($1::uuid, $2::text, $3::uuid[], $4::jsonb, $5::text)', [claimId, action, `{${calcIds.join(',')}}`, JSON.stringify(decisions), reason])
const storeCalcs = (claimId: string, claimVersion: number, ruleVersion: string, calcs: Record<string, StoredDayComputation>, by = BOSS) =>
  one<{ r: Record<string, string> }>('select public.trip_store_server_calcs($1::uuid, $2::int, $3::text, $4::jsonb, $5::uuid) as r', [claimId, claimVersion, ruleVersion, JSON.stringify(calcs), by]).then((x) => x.r)
const setFeature = (key: string, on: boolean, note = '로컬 시험') => exec(`select public.trip_set_feature('${key}', ${on}, '${note}')`)

interface DayRow { id: string; claim_id: string; employee_id: string; work_date: string; entry: DayEntry; revision: number; claim_status: string; site_start_min: number | null }
const loadDays = (claimId: string) => rows<DayRow>("select id, claim_id, employee_id, to_char(work_date, 'YYYY-MM-DD') as work_date, entry, revision, claim_status, site_start_min from public.trip_claim_days where claim_id = $1 and not is_removed order by work_date", [claimId])
const loadClaim = (claimId: string) => one<{ status: string; version: number; header: ClaimHeader; employee_id: string }>('select status, version, header, employee_id from public.trip_claims where id = $1', [claimId])

/** 서버 함수(api/trip-compute)가 하는 계산을 그대로: DB 입력 → computeClaimDays → {dayId: 계산+dayRevision} */
async function serverCalcs(claimId: string): Promise<{ calcs: Record<string, StoredDayComputation>; version: number; days: DayRow[] }> {
  const claim = await loadClaim(claimId)
  const days = await loadDays(claimId)
  const records: TripDayRecord[] = days.map((d) => ({ id: d.id, claimId: d.claim_id, employeeId: d.employee_id, date: d.work_date, entry: d.entry, revision: d.revision }))
  const computed = computeClaimDays({ header: claim.header, employeeId: claim.employee_id, days: records, calendar: NO_CALENDAR })
  const calcs: Record<string, StoredDayComputation> = {}
  for (const c of computed) {
    const { day, ...rest } = c
    calcs[day.id] = { ...rest, dayRevision: day.revision }
  }
  return { calcs, version: claim.version, days }
}

const latestCalcIds = (claimId: string) => rows<{ id: string }>('select c.id from public.trip_day_calcs c join public.trip_claim_days d on d.id = c.day_id where c.claim_id = $1 and not d.is_removed and c.seq = (select max(seq) from public.trip_day_calcs x where x.day_id = c.day_id) order by d.work_date', [claimId]).then((r) => r.map((x) => x.id))
const openFlags = (claimId: string) => rows<{ calc_id: string; code: string }>("select calc_id, code from public.trip_review_flags where claim_id = $1 and state = 'open'", [claimId])
/** 화면이 하는 것과 같게: 현재(최신) 계산의 확인 표시만 처리한다. 대체된 옛 계산의 표시는 보내지 않는다 */
const ackAll = async (claimId: string) => {
  const current = await latestCalcIds(claimId)
  return (await openFlags(claimId)).filter((f) => current.includes(f.calc_id)).map((f) => ({ calcId: f.calc_id, code: f.code, decision: 'acknowledged' }))
}

beforeAll(async () => {
  db = new PGlite()
  await exec(sql('로컬시험/000_local_shim.sql'))
  await exec(`insert into public.employees (id, name, role) values ('${MGR}', '인사담당', 'manager') on conflict (id) do nothing`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('1. 적용 — 010 → 020 → 030 → 040', () => {
  it.each(FILES)('%s 가 오류 없이 적용된다', async (f) => {
    await exec(sql(f))
  }, 60_000)

  it('표 12개 + holidays, 전부 RLS 켜짐', async () => {
    const t = await rows<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and (relname like 'trip\\_%' or relname = 'holidays') order by relname")
    expect(t.map((x) => x.relname).sort()).toEqual([
      'holidays', 'trip_actual_times', 'trip_adjustments', 'trip_claim_days', 'trip_claims', 'trip_day_calcs',
      'trip_feature_flag_history', 'trip_feature_flags', 'trip_regions', 'trip_review_flags', 'trip_reviews', 'trip_rule_versions',
    ].sort())
    expect(t.every((x) => x.relrowsecurity)).toBe(true)
  })

  it('공개 RPC 8개 + 서버 저장 RPC, 정책·트리거가 있다', async () => {
    const fns = (await rows<{ proname: string }>("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'trip\\_%' order by proname")).map((x) => x.proname)
    for (const f of ['trip_create_claim', 'trip_update_draft', 'trip_submit', 'trip_cancel', 'trip_invite_companions', 'trip_admin_adjust_day', 'trip_review', 'trip_store_server_calcs', 'trip_active_rule_version', 'trip_feature_enabled', 'trip_set_feature']) expect(fns).toContain(f)
    const policies = (await rows<{ policyname: string }>("select policyname from pg_policies where schemaname = 'public' and (tablename like 'trip\\_%' or tablename = 'holidays')")).map((x) => x.policyname)
    expect(policies.length).toBe(19)   // 030 의 정책 수. 바뀌면 030 과 같이 고친다
    expect(policies).toEqual(expect.arrayContaining(['trip_claims_select_self', 'trip_claims_select_admin', 'trip_day_calcs_select_self', 'trip_day_calcs_select_admin', 'holidays_select_authenticated']))
    // 쓰기 정책은 하나도 없다 — 쓰기는 전부 SECURITY DEFINER RPC 로만
    const writes = await one<{ n: string }>("select count(*)::text as n from pg_policies where schemaname = 'public' and tablename like 'trip\\_%' and cmd <> 'SELECT'")
    expect(writes.n).toBe('0')
    const triggers = (await rows<{ tgname: string }>("select tgname from pg_trigger where not tgisinternal and tgname like 'trip%' order by tgname")).map((x) => x.tgname)
    expect(triggers).toEqual(expect.arrayContaining(['trip_day_calcs_no_update', 'trip_day_calcs_no_delete', 'trip_reviews_calc_guard', 'trip_claims_updated_at']))
    // 기존 운영 함수에 기대지 않는다 (11-03): 출장 표의 트리거 함수는 전부 trip_*, 관리자 판정은 is_manager_or_admin 을 쓰지 않는다
    const deps = await rows<{ proname: string }>("select distinct p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and (c.relname like 'trip\\_%' or c.relname = 'holidays')")
    expect(deps.length).toBeGreaterThan(0)
    expect(deps.every((d) => d.proname.startsWith('trip_'))).toBe(true)
    const viewAll = await one<{ src: string }>("select pg_get_functiondef('public.trip_can_view_all()'::regprocedure) as src")
    expect(viewAll.src).not.toContain('is_manager_or_admin')
  })

  it('활성 규칙 버전 = 서버 번들 RULE_VERSION, 지역 코드가 엔진과 맞는다', async () => {
    expect((await one<{ v: string }>('select public.trip_active_rule_version() as v')).v).toBe(RULE_VERSION)
    expect((await one<{ ok: boolean }>("select public._trip_region_valid('대전', '2026-11-10') as ok")).ok).toBe(true)
    expect((await one<{ ok: boolean }>("select public._trip_region_valid('없는지역', '2026-11-10') as ok")).ok).toBe(false)
    const flags = await rows<{ key: string; enabled: boolean }>('select key, enabled from public.trip_feature_flags order by key')
    expect(flags).toEqual([{ key: 'admin_review', enabled: false }, { key: 'employee_form', enabled: false }, { key: 'payroll_apply', enabled: false }])
  })
})

describe('2. 기능 스위치 OFF — 쓰기·읽기 차단', () => {
  it('직원 쓰기 → FEATURE_DISABLED, 미로그인 → UNAUTHENTICATED', async () => {
    await asUser(ALICE)
    expect(await codeOf(createClaim(header(['대전'], MON), [entry(MON, '08:00', '17:00')]))).toBe('FEATURE_DISABLED')
    await asUser(null)
    expect(await codeOf(exec("select public.trip_set_feature('employee_form', true, 'x')"))).toBe('UNAUTHENTICATED')
  })

  it('스위치는 admin 만 켠다. payroll_apply 는 아무도 못 켠다. 이력이 남는다', async () => {
    await asUser(ALICE)
    expect(await codeOf(setFeature('employee_form', true))).toBe('FORBIDDEN')
    await asUser(MGR)
    expect(await codeOf(setFeature('employee_form', true))).toBe('FORBIDDEN')
    await asUser(BOSS)
    expect(await codeOf(setFeature('payroll_apply', true))).toBe('PAYROLL_LOCKED')
    expect(await codeOf(exec("update public.trip_feature_flags set enabled = true where key = 'payroll_apply'"))).toMatch(/trip_feature_flags_payroll_locked|check constraint/)
    await setFeature('employee_form', true)
    await setFeature('admin_review', true)
    const hist = await rows<{ key: string; new_enabled: boolean }>('select key, new_enabled from public.trip_feature_flag_history order by changed_at')
    expect(hist).toEqual([{ key: 'employee_form', new_enabled: true }, { key: 'admin_review', new_enabled: true }])
  })
})

describe('3. 직원 흐름 — 작성·수정·제출·취소·동행', () => {
  let claimId = ''
  let dayId = ''

  it('작성: 입력 원본만 받고 조회용 사본 칼럼을 채운다', async () => {
    await asUser(ALICE)
    const r = await createClaim(header(['대전'], MON), [entry(MON, '08:00', '17:00')])
    claimId = r.id
    expect(r.version).toBe(1)
    const days = await loadDays(claimId)
    expect(days).toHaveLength(1)
    dayId = days[0].id
    expect(days[0]).toMatchObject({ employee_id: ALICE, work_date: MON, revision: 1, claim_status: 'draft', site_start_min: 480 })
  })

  it('같은 날짜 또 작성 → DUPLICATE_DAY, 일정 밖 날짜 → DATE_OUT_OF_SCHEDULE, 지역 없음 → REGION_REQUIRED', async () => {
    expect(await codeOf(createClaim(header(['대전'], MON), [entry(MON, '09:00', '18:00')]))).toBe('DUPLICATE_DAY')
    expect(await codeOf(createClaim(header(['대전'], TUE), [entry(MON, '09:00', '18:00')]))).toBe('DATE_OUT_OF_SCHEDULE')
    expect(await codeOf(createClaim(header([], TUE), [entry(TUE, '09:00', '18:00')]))).toBe('REGION_REQUIRED')
  })

  it('다른 직원은 수정·취소·제출 못 함 (FORBIDDEN)', async () => {
    await asUser(BOB)
    expect(await codeOf(updateDraft(claimId, 1, null, [entry(MON, '07:00', '17:00')]))).toBe('FORBIDDEN')
    expect(await codeOf(cancel(claimId, 1))).toBe('FORBIDDEN')
    expect(await codeOf(submit(claimId, 1))).toBe('FORBIDDEN')
  })

  it('수정: 옛 version → VERSION_CONFLICT, 맞으면 version·revision 증가', async () => {
    await asUser(ALICE)
    expect(await codeOf(updateDraft(claimId, 99, null, [entry(MON, '07:00', '17:00')]))).toBe('VERSION_CONFLICT')
    const r = await updateDraft(claimId, 1, null, [entry(MON, '07:00', '17:00')])
    expect(r.version).toBe(2)
    const days = await loadDays(claimId)
    expect(days[0]).toMatchObject({ id: dayId, revision: 2, site_start_min: 420 })
  })

  it('서버 계산 없이 제출 → CALC_STALE_OR_UNTRUSTED', async () => {
    expect(await codeOf(submit(claimId, 2))).toBe('CALC_STALE_OR_UNTRUSTED')
  })

  it('동행 초안: 본인은 건너뛰고 동행자 건이 companion_draft 로 생긴다', async () => {
    const r = await invite(claimId, [BOB, ALICE])
    expect(r.created).toHaveLength(1)
    const c = await one<{ origin: string; employee_id: string; status: string }>('select origin, employee_id, status from public.trip_claims where id = $1', [r.created[0]])
    expect(c).toEqual({ origin: 'companion_draft', employee_id: BOB, status: 'draft' })
    // 동행자 날짜가 이미 있으면 skipped
    const again = await invite(claimId, [BOB])
    expect(again.created).toHaveLength(0)
    expect(again.skipped).toHaveLength(1)
  })

  it('취소: 옛 version → VERSION_CONFLICT, 취소 뒤 같은 날짜로 다시 작성 가능', async () => {
    await asUser(BOB)
    const bobClaim = await one<{ id: string; version: number }>('select id, version from public.trip_claims where employee_id = $1', [BOB])
    expect(await codeOf(cancel(bobClaim.id, bobClaim.version + 1))).toBe('VERSION_CONFLICT')
    expect((await cancel(bobClaim.id, bobClaim.version)).status).toBe('cancelled')
    const r = await createClaim(header(['부산'], MON), [entry(MON, '08:00', '17:00')])
    expect(r.version).toBe(1)
    await cancel(r.id, 1)
  })
})

describe('4. 서버 계산 저장 — service_role 만, 경쟁·조작 방어', () => {
  let claimId = ''
  let dayId = ''

  beforeAll(async () => {
    await asUser(ALICE)
    const c = await one<{ id: string }>('select id from public.trip_claims where employee_id = $1 and status = $2', [ALICE, 'draft'])
    claimId = c.id
    dayId = (await loadDays(claimId))[0].id
  })

  it('authenticated 역할은 EXECUTE 권한이 없다 (42501), 내부 검사도 FORBIDDEN', async () => {
    const { calcs, version } = await serverCalcs(claimId)
    await exec('set role authenticated')
    const asRole = await codeOf(storeCalcs(claimId, version, RULE_VERSION, calcs))
    await exec('reset role')
    expect(asRole).toMatch(/permission denied/)
    await asUser(ALICE, 'authenticated')
    expect(await codeOf(storeCalcs(claimId, version, RULE_VERSION, calcs))).toBe('FORBIDDEN')
  })

  it('규칙 버전·version·revision·근무일 집합·지역 검사', async () => {
    await asService()
    const { calcs, version } = await serverCalcs(claimId)
    expect(await codeOf(storeCalcs(claimId, version, 'other-version', calcs))).toBe('RULE_VERSION_MISMATCH')
    expect(await codeOf(storeCalcs(claimId, version + 1, RULE_VERSION, calcs))).toBe('VERSION_CONFLICT')
    const staleRev = { [dayId]: { ...calcs[dayId], dayRevision: 1 } }
    expect(await codeOf(storeCalcs(claimId, version, RULE_VERSION, staleRev))).toBe('VERSION_CONFLICT')
    expect(await codeOf(storeCalcs(claimId, version, RULE_VERSION, {}))).toBe('CALC_INCOMPLETE_SET')
    const foreign = { ...calcs, '11111111-1111-1111-1111-111111111111': calcs[dayId] }
    expect(await codeOf(storeCalcs(claimId, version, RULE_VERSION, foreign))).toBe('CALC_INCOMPLETE_SET')
    const badRegion = { [dayId]: { ...calcs[dayId], engineInput: { ...calcs[dayId].engineInput!, regions: ['없는지역'] } } }
    expect(await codeOf(storeCalcs(claimId, version, RULE_VERSION, badRegion))).toBe('UNKNOWN_REGION')
    expect(await codeOf(storeCalcs(claimId, version, RULE_VERSION, calcs, '22222222-2222-2222-2222-222222222222'))).toBe('UNKNOWN_USER')   // p_computed_by 가 직원이 아님
  })

  it('조작된 수치(출장 9시간)는 저장되지 않는다', async () => {
    await asService()
    const { calcs, version } = await serverCalcs(claimId)
    const c = calcs[dayId]
    if (!c.result || !c.result.ok) throw new Error('계산 실패 — 시험 전제 깨짐')
    const tampered = { [dayId]: { ...c, result: { ...c.result, trip: { ...c.result.trip, hours: 9 } } } }
    expect(await codeOf(storeCalcs(claimId, version, RULE_VERSION, tampered))).toMatch(/CALC_INVARIANT|check constraint|trip_hours/)
  })

  it('정상 저장: engine_source=server, 입력 스냅샷·revision 고정, 확인 표시(open) 생성, 같은 계산은 새 행 없음', async () => {
    await asService()
    const { calcs, version } = await serverCalcs(claimId)
    const r = await storeCalcs(claimId, version, RULE_VERSION, calcs)
    expect(Object.keys(r)).toEqual([dayId])
    const row = await one<{ engine_source: string; result_ok: boolean; day_revision: number; rule_version: string; review_codes: string[]; trip_hours: string; computed_by: string }>(
      'select engine_source, result_ok, day_revision, rule_version, review_codes, trip_hours::text, computed_by from public.trip_day_calcs where id = $1', [r[dayId]])
    expect(row).toMatchObject({ engine_source: 'server', result_ok: true, day_revision: 2, rule_version: RULE_VERSION, computed_by: BOSS })
    expect(Number(row.trip_hours)).toBe(4)
    expect(row.review_codes).toContain('HOLIDAY_SOURCE_UNVERIFIED')   // 검증된 달력이 없다
    const flags = await openFlags(claimId)
    expect(flags.map((f) => f.code)).toContain('HOLIDAY_SOURCE_UNVERIFIED')
    const again = await storeCalcs(claimId, version, RULE_VERSION, calcs)
    expect(again).toEqual(r)
    expect((await one<{ n: string }>('select count(*)::text as n from public.trip_day_calcs where claim_id = $1', [claimId])).n).toBe('1')
  })

  it('제출: 계산이 현재 입력과 맞으면 통과, 그 뒤 직원 수정은 NOT_EDITABLE', async () => {
    await asUser(ALICE)
    const r = await submit(claimId, 2)
    expect(r.status).toBe('submitted')
    expect(r.version).toBe(3)
    expect(r.submitted_at).not.toBeNull()
    expect((await loadDays(claimId))[0].claim_status).toBe('submitted')
    expect(await codeOf(updateDraft(claimId, 3, null, [entry(MON, '06:00', '17:00')]))).toBe('NOT_EDITABLE')
  })
})

describe('5. 관리자 흐름 — 수정·재계산·승인 고정', () => {
  let claimId = ''
  let dayId = ''
  let firstCalcIds: string[] = []

  beforeAll(async () => {
    const c = await one<{ id: string }>('select id from public.trip_claims where employee_id = $1 and status = $2', [ALICE, 'submitted'])
    claimId = c.id
    dayId = (await loadDays(claimId))[0].id
    firstCalcIds = await latestCalcIds(claimId)
  })

  it('직원·manager 는 관리자 수정 불가, admin 은 사유 필수·revision 일치 필수', async () => {
    await asUser(ALICE)
    expect(await codeOf(adjust(claimId, dayId, 2, entry(MON, '07:00', '18:00'), '사유'))).toBe('FORBIDDEN')
    await asUser(MGR)
    expect(await codeOf(adjust(claimId, dayId, 2, entry(MON, '07:00', '18:00'), '사유'))).toBe('FORBIDDEN')
    await asUser(BOSS)
    expect(await codeOf(adjust(claimId, dayId, 2, entry(MON, '07:00', '18:00'), '  '))).toBe('REASON_REQUIRED')
    expect(await codeOf(adjust(claimId, dayId, 1, entry(MON, '07:00', '18:00'), '사유'))).toBe('VERSION_CONFLICT')
    expect(await codeOf(adjust(claimId, dayId, 2, entry(TUE, '07:00', '18:00'), '사유'))).toBe('DATE_CHANGE_NOT_ALLOWED')
  })

  it('수정하면 revision·version 이 오르고 이력이 남는다. 옛 계산으로는 승인 불가', async () => {
    await asUser(BOSS)
    const r = await adjust(claimId, dayId, 2, entry(MON, '07:00', '18:00'), '완료보고 기준 18시')
    expect(r).toMatchObject({ claimId, dayId, revision: 3, version: 4 })
    const adj = await rows<{ from_revision: number; to_revision: number; reason: string }>('select from_revision, to_revision, reason from public.trip_adjustments where claim_id = $1', [claimId])
    expect(adj).toEqual([{ from_revision: 2, to_revision: 3, reason: '완료보고 기준 18시' }])
    // 계산 id 집합은 그대로(새 계산 전)이므로 STALE_CALC 가 아니라 CALC_STALE_OR_UNTRUSTED
    expect(await codeOf(review(claimId, 'approve', firstCalcIds, await ackAll(claimId)))).toBe('CALC_STALE_OR_UNTRUSTED')
  })

  it('재계산 저장 → 새 계산 행, 옛 id 집합으로 승인하면 STALE_CALC, 확인 표시 없이 승인하면 UNRESOLVED_FLAGS', async () => {
    await asService()
    const { calcs, version } = await serverCalcs(claimId)
    const r = await storeCalcs(claimId, version, RULE_VERSION, calcs)
    expect(r[dayId]).not.toBe(firstCalcIds[0])
    const current = await latestCalcIds(claimId)
    expect(current).toEqual([r[dayId]])
    await asUser(BOSS)
    expect(await codeOf(review(claimId, 'approve', firstCalcIds, await ackAll(claimId)))).toBe('STALE_CALC')
    expect(await codeOf(review(claimId, 'approve', current, []))).toBe('UNRESOLVED_FLAGS')
    expect(await codeOf(review(claimId, 'reject', current, [], null))).toBe('REASON_REQUIRED')
    expect(await codeOf(review(claimId, 'bogus', current, [], 'x'))).toBe('INVALID_ARGUMENT')
  })

  it('승인: 검토 기록이 계산 id 묶음·확인 표시와 함께 남고, 확인 표시는 acknowledged 로 바뀐다', async () => {
    await asUser(BOSS)
    const current = await latestCalcIds(claimId)
    const decisions = await ackAll(claimId)
    const r = await review(claimId, 'approve', current, decisions)
    expect(r).toEqual({ status: 'approved', version: 5 })
    const rv = await one<{ action: string; calc_ids: string[]; claim_version: number; admin_id: string }>('select action, calc_ids, claim_version, admin_id from public.trip_reviews where claim_id = $1', [claimId])
    expect(rv).toEqual({ action: 'approve', calc_ids: current, claim_version: 4, admin_id: BOSS })
    // 현재 계산의 확인 표시는 전부 처리됨. 대체된 옛 계산(firstCalcIds)의 표시는 open 으로 남는다 —
    // 승인 판정은 현재 계산만 보므로 기능상 문제는 없지만 집계에 쓰려면 주의 (로컬시험/README.md 운영 검토 사항)
    const stillOpen = await openFlags(claimId)
    expect(stillOpen.every((f) => firstCalcIds.includes(f.calc_id))).toBe(true)
    expect(stillOpen.some((f) => current.includes(f.calc_id))).toBe(false)
    const ack = await one<{ n: string }>("select count(*)::text as n from public.trip_review_flags where claim_id = $1 and state = 'acknowledged' and decided_by = $2", [claimId, BOSS])
    expect(Number(ack.n)).toBe(decisions.length)
    expect((await loadDays(claimId))[0].claim_status).toBe('approved')
  })

  it('승인 뒤 잠금: 근무일 수정 LOCKED, 계산 수정·삭제 IMMUTABLE, 재계산 저장 NOT_EDITABLE, 직원 취소 NOT_CANCELLABLE, 재검토 NOT_SUBMITTED', async () => {
    await asService()
    expect(await codeOf(exec(`update public.trip_claim_days set revision = revision + 1 where id = '${dayId}'`))).toBe('LOCKED')
    expect(await codeOf(exec(`update public.trip_claim_days set is_removed = true, removed_at = now() where id = '${dayId}'`))).toBe('LOCKED')
    expect(await codeOf(exec(`update public.trip_day_calcs set trip_hours = 8 where claim_id = '${claimId}'`))).toBe('IMMUTABLE')
    expect(await codeOf(exec(`delete from public.trip_day_calcs where claim_id = '${claimId}'`))).toBe('IMMUTABLE')
    const { calcs, version } = await serverCalcs(claimId)
    expect(await codeOf(storeCalcs(claimId, version, RULE_VERSION, calcs))).toBe('NOT_EDITABLE')
    await asUser(ALICE)
    expect(await codeOf(cancel(claimId, 5))).toBe('NOT_CANCELLABLE')
    await asUser(BOSS)
    expect(await codeOf(review(claimId, 'approve', await latestCalcIds(claimId), []))).toBe('NOT_SUBMITTED')
  })

  it('검토 기록에 다른 신청의 계산 id 를 끼워 넣으면 트리거가 막는다 (REVIEW_CALC_MISMATCH)', async () => {
    await asUser(BOB)
    const other = await createClaim(header(['대전'], TUE), [entry(TUE, '08:00', '17:00')])
    const aliceCalc = (await latestCalcIds(claimId))[0]
    expect(await codeOf(exec(`insert into public.trip_reviews (claim_id, admin_id, action, calc_ids, claim_version) values ('${other.id}', '${BOSS}', 'approve', '{${aliceCalc}}', 1)`))).toBe('REVIEW_CALC_MISMATCH')
    await cancel(other.id, other.version)
  })

  it('본인 건 검토 → SELF_REVIEW', async () => {
    await asUser(BOSS)
    const own = await createClaim(header(['대전'], TUE), [entry(TUE, '08:00', '17:00')])
    await asService()
    const { calcs, version } = await serverCalcs(own.id)
    await storeCalcs(own.id, version, RULE_VERSION, calcs)
    await asUser(BOSS)
    await submit(own.id, own.version)
    expect(await codeOf(review(own.id, 'approve', await latestCalcIds(own.id), await ackAll(own.id)))).toBe('SELF_REVIEW')
  })
})

describe('6. RLS — 직원·manager 는 본인 건, admin 만 전부, 스위치 OFF 면 0행', () => {
  const countAs = async (uid: string, table: string) => {
    await asUser(uid)
    await exec('set role authenticated')
    try { return Number((await one<{ n: string }>(`select count(*)::text as n from public.${table}`)).n) } finally { await exec('reset role') }
  }

  it('직원·manager 는 본인 건만 / admin 은 전부 (REST 직접 조회로 남의 기록이 보이지 않는다)', async () => {
    const all = Number((await one<{ n: string }>('select count(*)::text as n from public.trip_claims')).n)
    const alice = Number((await one<{ n: string }>('select count(*)::text as n from public.trip_claims where employee_id = $1', [ALICE])).n)
    expect(all).toBeGreaterThan(alice)
    expect(await countAs(ALICE, 'trip_claims')).toBe(alice)
    expect(await countAs(BOB, 'trip_claims')).toBeLessThan(all)
    expect(await countAs(MGR, 'trip_claims')).toBe(0)          // manager 는 본인 건만 — 신청이 없으니 0
    expect(await countAs(BOSS, 'trip_claims')).toBe(all)
    expect(await countAs(ALICE, 'trip_day_calcs')).toBeGreaterThan(0)
    expect(await countAs(BOB, 'trip_adjustments')).toBe(0)
    expect(await countAs(MGR, 'trip_adjustments')).toBe(0)
    expect(await countAs(MGR, 'trip_day_calcs')).toBe(0)
    expect(await countAs(MGR, 'trip_reviews')).toBe(0)
    expect(await countAs(MGR, 'trip_feature_flag_history')).toBe(0)
    expect(await countAs(BOSS, 'trip_adjustments')).toBe(1)
    expect(await countAs(BOSS, 'trip_feature_flag_history')).toBeGreaterThan(0)
  })

  it('anon 은 아무것도 못 본다', async () => {
    await asUser(null, 'anon')
    await exec('set role anon')
    const r = await codeOf(one('select count(*) from public.trip_claims'))
    await exec('reset role')
    expect(r).toMatch(/permission denied/)
  })

  it('스위치 OFF 면 직원·관리자 모두 0행, 쓰기도 막힌다', async () => {
    await asUser(BOSS)
    await setFeature('employee_form', false)
    await setFeature('admin_review', false)
    expect(await countAs(ALICE, 'trip_claims')).toBe(0)
    expect(await countAs(BOSS, 'trip_claims')).toBe(0)
    await asUser(BOSS)
    expect(await codeOf(review('00000000-0000-0000-0000-000000000000', 'approve', [], []))).toBe('FEATURE_DISABLED')
    await asService()
    expect(await codeOf(storeCalcs('00000000-0000-0000-0000-000000000000', 1, RULE_VERSION, {}))).toBe('FEATURE_DISABLED')
    await asUser(BOSS)
    await setFeature('employee_form', true)
    await setFeature('admin_review', true)
  })
})

describe('7. 900 롤백 → 재적용', () => {
  it('자료가 있으면 명시 확인 없이는 롤백이 멈춘다 (ROLLBACK_BLOCKED_DATA_EXISTS)', async () => {
    expect(Number((await one<{ n: string }>('select count(*)::text as n from public.trip_claims')).n)).toBeGreaterThan(0)
    expect(await codeOf(exec(sql('900_rollback.sql')))).toBe('ROLLBACK_BLOCKED_DATA_EXISTS')
    expect((await one<{ v: string }>('select public.trip_active_rule_version() as v')).v).toBe(RULE_VERSION)   // 아무것도 지워지지 않았다
  })

  it('롤백하면 trip_* 객체와 holidays 가 전부 사라지고 shim(기존 운영 객체)은 남는다', async () => {
    await exec("select set_config('trip.confirm_drop', 'yes', false)")
    await exec(sql('900_rollback.sql'))
    await exec("select set_config('trip.confirm_drop', '', false)")
    const left = await rows<{ kind: string; name: string }>(`
      select 'table' as kind, relname as name from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','v','S') and (relname like 'trip%' or relname = 'holidays')
      union all select 'function', proname from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'trip%' or proname like '\\_trip%')
      union all select 'policy', policyname from pg_policies where schemaname = 'public' and (tablename like 'trip%' or tablename = 'holidays')
      union all select 'type', typname from pg_type where typnamespace = 'public'::regnamespace and typname like 'trip%' and typtype = 'e'`)
    expect(left).toEqual([])
    expect((await one<{ n: string }>('select count(*)::text as n from public.employees')).n).toBe('4')
    expect((await one<{ ok: boolean }>("select to_regprocedure('public.update_updated_at_column()') is not null as ok")).ok).toBe(true)
  }, 60_000)

  it('초기 상태로 다시 010 → 040 적용된다', async () => {
    for (const f of FILES) await exec(sql(f))
    expect((await one<{ v: string }>('select public.trip_active_rule_version() as v')).v).toBe(RULE_VERSION)
    expect((await one<{ n: string }>('select count(*)::text as n from public.trip_claims')).n).toBe('0')
  }, 60_000)
})

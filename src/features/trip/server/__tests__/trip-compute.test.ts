import { describe, expect, it } from 'vitest'
import { RULE_VERSION } from '../../engine'
import { computeClaimDays, type DayComputation, type DayEntry } from '../../data'
import { MON, TEST_CALENDAR, TUE, alice, bob, boss, dayHeader, siteEntry, stayHeader } from '../../data/__tests__/fixtures'
import { runTripCompute } from '../trip-compute'
import type { ClaimRow, ComputeIO, DayRow } from '../types'

/** 가짜 DB — 조작 시도를 흉내 내기 위해 각 부분을 바꿔 끼울 수 있다 */
function fakeIO(over: Partial<ComputeIO> & { claim?: Partial<ClaimRow>; days?: DayRow[] } = {}) {
  const claim: ClaimRow = {
    id: 'claim-1', employee_id: alice.id, group_id: 'claim-1', origin: 'self',
    header: dayHeader(['대전']), status: 'draft', version: 1, ...over.claim,
  }
  const days: DayRow[] = over.days ?? [
    { id: 'day-1', claim_id: 'claim-1', employee_id: alice.id, work_date: MON, entry: siteEntry(MON, '08:00', '17:00'), revision: 1 },
  ]
  const stored: { claimId: string; claimVersion: number; ruleVersion: string; calcs: Record<string, DayComputation & { dayRevision: number }>; computedBy: string }[] = []
  const io: ComputeIO = {
    userIdFromJwt: async (jwt) => ({ 'jwt-alice': alice.id, 'jwt-bob': bob.id, 'jwt-boss': boss.id })[jwt] ?? null,
    findEmployee: async (id) => ({ [alice.id]: alice, [bob.id]: bob, [boss.id]: boss })[id] ?? null,
    featureEnabled: async () => true,
    activeRuleVersion: async () => RULE_VERSION,
    loadClaim: async (id) => (id === claim.id ? claim : null),
    loadDays: async () => days,
    findOtherActiveDay: async () => null,
    loadVerifiedHolidays: async () => ({ dates: [...TEST_CALENDAR.holidays], source: 'holidays 테이블 (검증 1건)' }),
    loadOtherRequests: async () => [],
    storeCalcs: async (claimId, claimVersion, ruleVersion, calcs, computedBy) => {
      stored.push({ claimId, claimVersion, ruleVersion, calcs, computedBy })
      return Object.fromEntries(Object.keys(calcs).map((k, i) => [k, `calc-${i + 1}`]))
    },
    ...over,
  }
  return { io, stored, claim, days }
}

describe('서버 재계산 — 계산은 DB 입력으로만', () => {
  it('정상: 저장된 입력(08~17)으로 4시간 확정을 계산해 service_role RPC 에 넘긴다', async () => {
    const { io, stored } = fakeIO()
    const r = await runTripCompute('jwt-alice', { claimId: 'claim-1' }, io)
    expect(r).toMatchObject({ ok: true, claimId: 'claim-1', ruleVersion: RULE_VERSION, calcIds: { 'day-1': 'calc-1' }, reviewCodes: { 'day-1': [] } })
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ claimId: 'claim-1', claimVersion: 1, ruleVersion: RULE_VERSION, computedBy: alice.id })
    expect(stored[0].calcs['day-1']).toMatchObject({ dayRevision: 1, result: { ok: true, trip: { hours: 4 }, status: 'confirmed' } })
  })

  it('계산-저장 경쟁 방어: 함수가 읽은 신청 버전·근무일 판 번호를 저장 RPC 에 같이 보낸다 (RPC 가 다르면 VERSION_CONFLICT)', async () => {
    const { io, stored } = fakeIO({
      claim: { version: 7 },
      days: [{ id: 'day-1', claim_id: 'claim-1', employee_id: alice.id, work_date: MON, entry: siteEntry(MON, '08:00', '17:00'), revision: 3 }],
    })
    await runTripCompute('jwt-alice', { claimId: 'claim-1' }, io)
    expect(stored[0].claimVersion).toBe(7)
    expect(stored[0].calcs['day-1'].dayRevision).toBe(3)
    // 그 사이 입력이 바뀌어 RPC 가 거부하면 그대로 전달한다
    const raced = fakeIO({ storeCalcs: async () => { throw new Error('VERSION_CONFLICT: 계산 뒤 입력이 바뀌었습니다. 다시 계산하세요') } })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, raced.io)).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
  })

  it('조작 1·2·3: 본문에 계산 결과·규칙 버전·지역 표준시간을 넣어 보내도 전부 무시된다', async () => {
    const { io, stored } = fakeIO()
    const tampered = {
      claimId: 'claim-1',
      calcs: { 'day-1': { result: { ok: true, trip: { hours: 40 } } } },
      ruleVersion: 'hacked-v9',
      regions: { 대전: { kind: 'standard', oneWayHours: 4 } },
      entries: [siteEntry(MON, '01:00', '23:00')],
      role: 'admin',
    }
    const r = await runTripCompute('jwt-alice', tampered, io)
    expect(r.ok).toBe(true)
    expect(stored[0].ruleVersion).toBe(RULE_VERSION)
    expect(stored[0].calcs['day-1'].result).toMatchObject({ ok: true, trip: { hours: 4 } }) // DB 입력 08~17 기준
    // 저장 요청은 서버가 DB 입력으로 다시 계산한 값과 정확히 같다
    const expected = computeClaimDays({ header: dayHeader(['대전']), employeeId: alice.id, days: [{ id: 'day-1', claimId: 'claim-1', employeeId: alice.id, date: MON, entry: siteEntry(MON, '08:00', '17:00'), revision: 1 }], calendar: TEST_CALENDAR })
    const { day, ...rest } = expected[0]
    expect(stored[0].calcs['day-1']).toEqual({ ...rest, dayRevision: day.revision })
  })

  it('규칙 버전: DB 활성 버전이 서버 번들과 다르면 계산하지 않는다 (배포 불일치)', async () => {
    const { io, stored } = fakeIO({ activeRuleVersion: async () => '2099-01-01-other' })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, io)).toMatchObject({ ok: false, code: 'RULE_VERSION_MISMATCH' })
    expect(stored).toHaveLength(0)
  })

  it('입력 ↔ 결과 불일치가 생길 수 없다: 입력이 바뀌면 결과도 그 입력에서 나온다', async () => {
    const { io, stored } = fakeIO({ days: [{ id: 'day-1', claim_id: 'claim-1', employee_id: alice.id, work_date: MON, entry: siteEntry(MON, '07:00', '17:00', { lunchTaken: false }), revision: 2 }] })
    await runTripCompute('jwt-alice', { claimId: 'claim-1' }, io)
    expect(stored[0].calcs['day-1'].result).toMatchObject({ ok: true, trip: { hours: 4 }, overtime: { hours: 2 } })
    expect(stored[0].calcs['day-1'].engineInput).toMatchObject({ site: { start: 7, end: 17 }, lunchTaken: false })
  })
})

describe('권한·기능 스위치', () => {
  it('JWT 없음·무효·직원 아님 → UNKNOWN_USER, 저장 없음', async () => {
    const { io, stored } = fakeIO()
    expect(await runTripCompute(undefined, { claimId: 'claim-1' }, io)).toMatchObject({ code: 'UNKNOWN_USER' })
    expect(await runTripCompute('jwt-ghost', { claimId: 'claim-1' }, io)).toMatchObject({ code: 'UNKNOWN_USER' })
    const noEmp = fakeIO({ findEmployee: async () => null })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, noEmp.io)).toMatchObject({ code: 'UNKNOWN_USER' })
    expect(stored).toHaveLength(0)
  })

  it('기능 OFF: 직원은 FEATURE_DISABLED. 관리자는 admin_review 가 켜져 있으면 통과', async () => {
    const off = fakeIO({ featureEnabled: async () => false })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, off.io)).toMatchObject({ code: 'FEATURE_DISABLED' })
    expect(await runTripCompute('jwt-boss', { claimId: 'claim-1' }, off.io)).toMatchObject({ code: 'FEATURE_DISABLED' })
    const adminOnly = fakeIO({ featureEnabled: async (k) => k === 'admin_review' })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, adminOnly.io)).toMatchObject({ code: 'FEATURE_DISABLED' })
    expect((await runTripCompute('jwt-boss', { claimId: 'claim-1' }, adminOnly.io)).ok).toBe(true)
  })

  it('남의 신청: 직원은 FORBIDDEN, 관리자는 가능. 없는 신청은 NOT_FOUND', async () => {
    const { io } = fakeIO()
    expect(await runTripCompute('jwt-bob', { claimId: 'claim-1' }, io)).toMatchObject({ code: 'FORBIDDEN' })
    expect((await runTripCompute('jwt-boss', { claimId: 'claim-1' }, io)).ok).toBe(true)
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-x' }, io)).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('승인 후: 아무도 다시 계산하지 못한다 (승인된 계산 결과 보존). 제출됨은 관리자만', async () => {
    const approved = fakeIO({ claim: { status: 'approved' } })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, approved.io)).toMatchObject({ code: 'NOT_EDITABLE' })
    expect(await runTripCompute('jwt-boss', { claimId: 'claim-1' }, approved.io)).toMatchObject({ code: 'NOT_EDITABLE' })
    const submitted = fakeIO({ claim: { status: 'submitted' } })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, submitted.io)).toMatchObject({ code: 'NOT_EDITABLE' })
    expect((await runTripCompute('jwt-boss', { claimId: 'claim-1' }, submitted.io)).ok).toBe(true)
  })

  it('본문 형식: claimId 가 없거나 이상하면 BAD_REQUEST', async () => {
    const { io } = fakeIO()
    expect(await runTripCompute('jwt-alice', {}, io)).toMatchObject({ code: 'BAD_REQUEST' })
    expect(await runTripCompute('jwt-alice', { claimId: "x' or 1=1" }, io)).toMatchObject({ code: 'BAD_REQUEST' })
    expect(await runTripCompute('jwt-alice', null, io)).toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('달력·다음 날·중복 신청은 서버 조회로 확인 항목이 된다', () => {
  it('검증 공휴일 0건 → 달력 미검증 확인 항목', async () => {
    const { io, stored } = fakeIO({ loadVerifiedHolidays: async () => ({ dates: [], source: '' }) })
    const r = await runTripCompute('jwt-alice', { claimId: 'claim-1' }, io)
    expect(r.ok && r.reviewCodes['day-1']).toEqual(['HOLIDAY_SOURCE_UNVERIFIED'])
    expect(stored[0].calcs['day-1'].classification.notices.map((n) => n.code)).toContain('HOLIDAY_SOURCE_UNVERIFIED')
  })

  it('같은 날 기존 야근이 있으면 OTHER_REQUEST_SAME_DAY', async () => {
    const { io } = fakeIO({ loadOtherRequests: async () => [{ date: MON, planned_start: '18:00:00', planned_end: '21:00:00', status: 'approved' }] })
    const r = await runTripCompute('jwt-alice', { claimId: 'claim-1' }, io)
    expect(r.ok && r.reviewCodes['day-1']).toContain('OTHER_REQUEST_SAME_DAY')
  })

  it('밤샘 작업이 다음 날로 넘어가면 다른 신청의 다음 날 기록에 연결하고, 없으면 NEXT_DAY_ENTRY_MISSING', async () => {
    const overnight: DayEntry = siteEntry(MON, '21:00', '11:00', { site: { start: '21:00', end: '11:00', endNextDay: true }, breaks: [{ start: '02:00', end: '03:00', startNextDay: true, endNextDay: true }] })
    const base = { claim: { header: dayHeader(['대전']) }, days: [{ id: 'day-1', claim_id: 'claim-1', employee_id: alice.id, work_date: MON, entry: overnight, revision: 1 }] }
    const missing = fakeIO(base)
    const r1 = await runTripCompute('jwt-alice', { claimId: 'claim-1' }, missing.io)
    expect(r1.ok && r1.reviewCodes['day-1']).toContain('NEXT_DAY_ENTRY_MISSING')
    const linked = fakeIO({ ...base, findOtherActiveDay: async (_e, d) => (d === TUE ? { id: 'day-other', claim_id: 'claim-2', employee_id: alice.id, work_date: TUE, entry: siteEntry(TUE, '09:00', '11:00'), revision: 1 } : null) })
    const r2 = await runTripCompute('jwt-alice', { claimId: 'claim-1' }, linked.io)
    expect(r2.ok && r2.reviewCodes['day-1']).not.toContain('NEXT_DAY_ENTRY_MISSING')
    expect(linked.stored[0].calcs['day-1'].carryOut?.linkedDayId).toBe('day-other')
  })

  it('숙박 중간일(E5)은 제안값 확인 항목으로 돌아온다', async () => {
    const { io } = fakeIO({
      claim: { header: stayHeader(['대전'], MON, '2026-11-04') },
      days: [
        { id: 'day-1', claim_id: 'claim-1', employee_id: alice.id, work_date: MON, entry: siteEntry(MON, '08:00', '17:00'), revision: 1 },
        { id: 'day-2', claim_id: 'claim-1', employee_id: alice.id, work_date: TUE, entry: siteEntry(TUE, '08:00', '19:00'), revision: 1 },
      ],
    })
    const r = await runTripCompute('jwt-alice', { claimId: 'claim-1' }, io)
    expect(r.ok && r.reviewCodes).toEqual({ 'day-1': [], 'day-2': ['E5_STAY_MIDDLE'] })
  })

  it('저장 RPC 가 예외 코드를 던지면 그대로 전달한다 (예: RPC 쪽 UNKNOWN_REGION)', async () => {
    const { io } = fakeIO({ storeCalcs: async () => { throw new Error('UNKNOWN_REGION: 지역 코드가 없습니다') } })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, io)).toMatchObject({ ok: false, code: 'UNKNOWN_REGION' })
    const generic = fakeIO({ storeCalcs: async () => { throw new Error('network down') } })
    expect(await runTripCompute('jwt-alice', { claimId: 'claim-1' }, generic.io)).toMatchObject({ ok: false, code: 'STORE_FAILED' })
  })
})

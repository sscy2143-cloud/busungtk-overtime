import { describe, expect, it } from 'vitest'
import { NO_CALENDAR } from '../calendar'
import { FEATURES_ALL_OFF, createGuardedTripService, createStaticGate } from '../gate'
import { createMemoryRepository } from '../repository'
import { reviewItems, type ServiceDeps } from '../service'
import type { Actor, TripCalcRecord } from '../types'
import { MON, TEST_CALENDAR, alice, bob, boss, dayHeader, siteEntry, unwrap } from './fixtures'

const DIRECTORY = { [alice.id]: 'employee', [bob.id]: 'employee', [boss.id]: 'admin' } as const

function guarded(flags: Parameters<typeof createStaticGate>[0], overrides: Partial<ServiceDeps> = {}) {
  let seq = 0
  let tick = 0
  const deps: ServiceDeps = {
    repo: createMemoryRepository(),
    calendar: TEST_CALENDAR,
    now: () => `2026-11-10T09:00:${String(tick++).padStart(2, '0')}Z`,
    newId: (p) => `${p}-${++seq}`,
    ...overrides,
  }
  return createGuardedTripService(deps, createStaticGate(flags, DIRECTORY))
}
const ack = (calcs: TripCalcRecord[]) => calcs.flatMap((c) => reviewItems(c).map((code) => ({ calcId: c.id, code, decision: 'acknowledged' as const })))
const claimArgs = { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }

describe('기능 스위치 — 기본값은 전부 꺼짐, 서버가 모든 호출을 거부한다', () => {
  it('기본값', () => {
    expect(FEATURES_ALL_OFF).toEqual({ employeeForm: false, adminReview: false, payrollApply: false })
  })

  it('꺼져 있으면 직원·관리자 어떤 호출도 FEATURE_DISABLED (조회 포함)', () => {
    const svc = guarded({})
    const calls = [
      () => svc.createClaim(alice, claimArgs),
      () => svc.myClaims(alice),
      () => svc.latestCalcs(alice, 'claim-1'),
      () => svc.weeklyCheck(alice, MON),
      () => svc.reviewQueue(boss),
      () => svc.review(boss, 'claim-1', { action: 'approve', expectedCalcIds: [] }),
      () => svc.settlementPreview(boss, 'claim-1'),
      () => svc.groupMismatches(boss, 'g'),
    ]
    for (const call of calls) expect(call()).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
    expect(svc.featureState('employeeForm')).toEqual({ enabled: false, source: 'static' })
  })

  it('직원 화면만 켜면 직원은 쓰고, 관리자 검토는 여전히 막힌다', () => {
    const svc = guarded({ employeeForm: true })
    const c = unwrap(svc.createClaim(alice, claimArgs))
    expect(unwrap(svc.myClaims(alice))).toHaveLength(1)
    expect(svc.reviewQueue(boss)).toMatchObject({ code: 'FEATURE_DISABLED' })
    expect(svc.review(boss, c.id, { action: 'approve', expectedCalcIds: [] })).toMatchObject({ code: 'FEATURE_DISABLED' })
  })

  it('급여 반영 스위치는 인자로 켜려 해도 켜지지 않는다', () => {
    const svc = guarded({ payrollApply: true })
    expect(svc.featureState('payrollApply').enabled).toBe(false)
  })
})

describe('역할은 서버 값으로 강제한다 — 클라이언트가 보낸 역할을 믿지 않는다', () => {
  const svc = () => guarded({ employeeForm: true, adminReview: true })

  it('직원이 admin 이라고 보내도 서버 역할이 employee 면 거부', () => {
    const s = svc()
    const c = unwrap(s.createClaim(alice, claimArgs))
    unwrap(s.submit(alice, c.id, c.version))
    const fake: Actor = { id: alice.id, role: 'admin' }
    expect(s.review(fake, c.id, { action: 'approve', expectedCalcIds: [] })).toMatchObject({ code: 'ROLE_MISMATCH' })
    expect(s.reviewQueue(fake)).toMatchObject({ code: 'ROLE_MISMATCH' })
  })

  it('모르는 사용자는 거부', () => {
    expect(svc().createClaim({ id: 'ghost', role: 'employee' }, claimArgs)).toMatchObject({ code: 'UNKNOWN_USER' })
  })

  it('employee 역할로 관리자 기능 호출은 FORBIDDEN', () => {
    expect(svc().reviewQueue(bob)).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('직원은 남의 계산 결과를 볼 수 없고, 관리자는 볼 수 있다', () => {
    const s = svc()
    const c = unwrap(s.createClaim(alice, claimArgs))
    expect(s.latestCalcs(bob, c.id)).toMatchObject({ code: 'FORBIDDEN' })
    expect(unwrap(s.latestCalcs(alice, c.id))).toHaveLength(1)
    expect(unwrap(s.latestCalcs(boss, c.id))).toHaveLength(1)
  })

  it('관리자 검토 끝까지: 제출 → 큐 조회 → 확인 → 승인 → 정산 미리보기(급여 미반영)', () => {
    const s = svc()
    const c = unwrap(s.createClaim(alice, claimArgs))
    const sent = unwrap(s.submit(alice, c.id, c.version))
    expect(unwrap(s.reviewQueue(boss, 'submitted')).map((x) => x.id)).toEqual([sent.id])
    const calcs = unwrap(s.latestCalcs(boss, sent.id))
    unwrap(s.review(boss, sent.id, { action: 'approve', expectedCalcIds: calcs.map((x) => x.id), flagDecisions: ack(calcs) }))
    expect(unwrap(s.settlementPreview(boss, sent.id)).payrollApplicable).toBe(false)
  })
})

describe('공휴일 달력 출처', () => {
  it('출처가 없으면 모든 날에 관리자 확인 표시가 붙고, 확인 전에는 승인할 수 없다', () => {
    const s = guarded({ employeeForm: true, adminReview: true }, { calendar: NO_CALENDAR })
    const c = unwrap(s.createClaim(alice, claimArgs))
    const sent = unwrap(s.submit(alice, c.id, c.version))
    const [calc] = unwrap(s.latestCalcs(boss, sent.id))
    expect(calc.classification.notices.map((n) => n.code)).toContain('HOLIDAY_SOURCE_UNVERIFIED')
    expect(reviewItems(calc)).toContain('HOLIDAY_SOURCE_UNVERIFIED')
    expect(calc.result?.ok && calc.result.trip.hours).toBe(4) // 계산값 자체는 그대로
    expect(s.review(boss, sent.id, { action: 'approve', expectedCalcIds: [calc.id] })).toMatchObject({ code: 'UNRESOLVED_FLAGS' })
    expect(s.review(boss, sent.id, { action: 'approve', expectedCalcIds: [calc.id], flagDecisions: ack([calc]) }).ok).toBe(true)
  })

  it('검증된 달력이면 표시가 없다', () => {
    const s = guarded({ employeeForm: true })
    const c = unwrap(s.createClaim(alice, claimArgs))
    expect(unwrap(s.latestCalcs(alice, c.id))[0].classification.notices).toEqual([])
  })
})

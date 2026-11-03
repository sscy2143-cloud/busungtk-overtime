import { describe, expect, it } from 'vitest'
import { createGuardedTripService, createMemoryRepository, createStaticGate, type ServiceDeps } from '../../data'
import { MON, TEST_CALENDAR, TUE, alice, bob, boss, dayHeader, siteEntry, stayHeader, unwrap } from '../../data/__tests__/fixtures'
import { buildClaimDetail } from '../review-detail'

function admin() {
  let seq = 0
  let tick = 0
  const deps: ServiceDeps = {
    repo: createMemoryRepository(),
    calendar: TEST_CALENDAR,
    now: () => `2026-11-10T09:00:${String(tick++).padStart(2, '0')}Z`,
    newId: (p) => `${p}-${++seq}`,
  }
  const gate = createStaticGate({ employeeForm: true, adminReview: true }, { [alice.id]: 'employee', [bob.id]: 'employee', [boss.id]: 'admin' })
  return createGuardedTripService(deps, gate)
}

describe('관리자 상세 모델', () => {
  it('제안값 날은 확인 항목으로 나오고, 전부 확인하면 승인 차단이 풀린다', () => {
    const s = admin()
    const c = unwrap(s.createClaim(alice, { header: stayHeader(['대전'], MON, '2026-11-04'), entries: [siteEntry(MON, '08:00', '17:00'), siteEntry(TUE, '08:00', '19:00')] }))
    const sent = unwrap(s.submit(alice, c.id, c.version))
    const data = unwrap(s.claimDetail(boss, sent.id))
    const v0 = buildClaimDetail(data, [])
    expect(v0.days.map((d) => d.items.map((i) => i.code))).toEqual([[], ['E5_STAY_MIDDLE']])
    expect(v0.days[1].items[0]).toMatchObject({ undecidedRule: true, acknowledged: false, title: '숙박 중간일 (E5)' })
    expect(v0.blockers).toEqual(['확인하지 않은 표시 1건'])
    expect(v0.proposedNote).toBeDefined()
    const decisions = v0.days.flatMap((d) => d.items.map((i) => ({ calcId: i.calcId, code: i.code, decision: 'acknowledged' as const })))
    const v1 = buildClaimDetail(data, decisions)
    expect(v1.blockers).toEqual([])
    expect(v1.days[1].items[0].acknowledged).toBe(true)
    expect(unwrap(s.review(boss, sent.id, { action: 'approve', expectedCalcIds: v1.expectedCalcIds, flagDecisions: decisions })).status).toBe('approved')
  })

  it('동행 불일치·다음 날 기록 누락은 경고로 나온다', () => {
    const s = admin()
    const overnight = siteEntry(MON, '21:00', '11:00', { site: { start: '21:00', end: '11:00', endNextDay: true }, breaks: [{ start: '02:00', end: '03:00', startNextDay: true, endNextDay: true }] })
    const mine = unwrap(s.createClaim(alice, { header: dayHeader(['대전']), entries: [overnight] }))
    const [bobId] = unwrap(s.inviteCompanions(alice, mine.id, [bob.id])).created
    const bobClaim = unwrap(s.myClaims(bob))[0]
    unwrap(s.updateDraft(bob, bobId, bobClaim.version, { entries: [siteEntry(MON, '21:00', '23:00')] }))
    const sent = unwrap(s.submit(alice, mine.id, mine.version))
    const v = buildClaimDetail(unwrap(s.claimDetail(boss, sent.id)), [])
    expect(v.warnings.some((w) => w.includes('동행자 간 현장 시각'))).toBe(true)
    expect(v.warnings.some((w) => w.includes('다음 날 기록이 없습니다'))).toBe(true)
    expect(v.days[0].carryOut).toMatchObject({ toDate: TUE, linked: false })
    expect(v.days[0].items.map((i) => i.code)).toContain('NEXT_DAY_ENTRY_MISSING')
  })

  it('승인 당시 계산 결과를 보존하고, 그 뒤 바뀌면 알린다', () => {
    const s = admin()
    const c = unwrap(s.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const sent = unwrap(s.submit(alice, c.id, c.version))
    const d0 = unwrap(s.claimDetail(boss, sent.id))
    unwrap(s.review(boss, sent.id, { action: 'approve', expectedCalcIds: d0.calcs.map((x) => x.id) }))
    const d1 = unwrap(s.claimDetail(boss, sent.id))
    const v1 = buildClaimDetail(d1, [])
    expect(v1.approvedSnapshot).toMatchObject({ calcIds: d0.calcs.map((x) => x.id), changedSinceApproval: false })
    expect(d1.approvedCalcs.map((x) => x.id)).toEqual(d0.calcs.map((x) => x.id))
    expect(v1.blockers).toEqual(['제출된 신청이 아닙니다'])
  })

  it('직원은 상세를 볼 수 없다', () => {
    const s = admin()
    const c = unwrap(s.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(s.claimDetail(alice, c.id)).toMatchObject({ code: 'FORBIDDEN' })
  })
})

/**
 * T9 시범 비교 화면 모델과 T8 마감 전 점검 — 화면이 부르는 함수를 같은 순서로 호출한다 (DOM 이벤트 없음).
 */
import { describe, expect, it } from 'vitest'
import { createGuardedTripService, createMemoryRepository, createStaticGate, type ServiceDeps, type TripCalcRecord } from '../../data'
import { reviewItems } from '../../data/service'
import { MON, TEST_CALENDAR, alice, bob, boss, dayHeader, siteEntry, unwrap } from '../../data/__tests__/fixtures'
import { comparePilot, parseManualCsv, toPilotCsv } from '../../pilot'
import { collectPilotSystemRows, preCloseCheck, type PreCloseClaim } from '../../ui'

function app(flags: Parameters<typeof createStaticGate>[0] = { employeeForm: true, adminReview: true }) {
  let seq = 0
  let tick = 0
  const deps: ServiceDeps = {
    repo: createMemoryRepository(), calendar: TEST_CALENDAR,
    now: () => `2026-11-10T09:00:${String(tick++).padStart(2, '0')}Z`, newId: (p) => `${p}-${++seq}`,
  }
  return createGuardedTripService(deps, createStaticGate(flags, { [alice.id]: 'employee', [bob.id]: 'employee', [boss.id]: 'admin' }))
}
const names = (id: string) => (id === alice.id ? '김직원' : id === bob.id ? '이동행' : id)

function approve(svc: ReturnType<typeof app>, actor: typeof alice, date = MON) {
  const c = unwrap(svc.createClaim(actor, { header: dayHeader(['대전']), entries: [siteEntry(date, '08:00', '17:00')] }))
  const sent = unwrap(svc.submit(actor, c.id, c.version))
  const calcs = unwrap(svc.latestCalcs(boss, sent.id)) as TripCalcRecord[]
  const flagDecisions = calcs.flatMap((x) => reviewItems(x).map((code) => ({ calcId: x.id, code, decision: 'acknowledged' as const })))
  unwrap(svc.review(boss, sent.id, { action: 'approve', expectedCalcIds: calcs.map((x) => x.id), flagDecisions }))
  return sent.id
}

describe('T9 시범 비교 — 승인된 신청 수집', () => {
  it('관리자: 승인된 신청의 정산 미리보기를 직원 표시와 함께 행으로 모은다 (승인 전·취소 건은 제외)', () => {
    const svc = app()
    approve(svc, alice)
    const draft = unwrap(svc.createClaim(bob, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(draft.status).toBe('draft')
    const r = collectPilotSystemRows(svc, boss, names)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.claims).toBe(1)
    expect(r.value.errors).toEqual([])
    expect(r.value.rows).toEqual([{ ref: '김직원', date: MON, confirmed: { trip: 4 }, held: {} }])
  })

  it('직원은 거부(FORBIDDEN), 스위치가 꺼져 있으면 모두 거부(FEATURE_DISABLED) — 화면이 따로 우회하지 않는다', () => {
    const svc = app()
    approve(svc, alice)
    expect(collectPilotSystemRows(svc, alice, names)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    const off = app({})
    expect(collectPilotSystemRows(off, boss, names)).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
  })

  it('끝까지: 시스템 결과 CSV → 수기 계산표 CSV(일치 1건·차이 1건) → 대조', () => {
    const svc = app()
    approve(svc, alice)
    approve(svc, bob)
    const collected = collectPilotSystemRows(svc, boss, names)
    if (!collected.ok) throw new Error('수집 실패')
    const csv = toPilotCsv(collected.value.rows)
    expect(csv).toContain('김직원,' + MON + ',4')
    const manual = parseManualCsv(`ref,date,trip\r\n김직원,${MON},4\r\n이동행,${MON},3\r\n`)
    expect(manual.issues).toEqual([])
    const report = comparePilot(collected.value.rows, manual.rows)
    expect(report.summary).toMatchObject({ total: 2, match: 1, diff: 1, matchRate: 50 })
    expect(report.rows.find((x) => x.ref === '이동행')!.diffs).toEqual([{ key: 'trip', system: 4, manual: 3, diff: 1, fromHeld: false }])
  })
})

const claim = (over: Partial<PreCloseClaim> = {}): PreCloseClaim => ({
  id: 'c1', ref: '김직원', status: 'approved', openFlags: 0, heldKeys: [], legalReview: [], calendarUnverified: false, ...over,
})

describe('T8 마감 전 점검 — 규정과 무관한 사실만 본다', () => {
  it('모두 승인되고 확인 항목이 없으면 마감 가능, 점검 대상 수를 센다', () => {
    expect(preCloseCheck({ claims: [claim(), claim({ id: 'c2' })] })).toEqual({ canClose: true, blockers: [], warnings: [], checked: 2 })
  })

  it('제출·되돌림·작성 중인 건과 처리 안 된 확인 항목, 동행 불일치는 마감을 막는다', () => {
    const r = preCloseCheck({
      claims: [claim({ id: 's', status: 'submitted' }), claim({ id: 'r', status: 'returned' }), claim({ id: 'd', status: 'draft' }), claim({ id: 'f', openFlags: 2 })],
      groupMismatchCount: 1,
    })
    expect(r.canClose).toBe(false)
    expect(r.blockers.map((b) => [b.code, b.claimIds])).toEqual([
      ['PENDING_REVIEW', ['s']], ['RETURNED_OPEN', ['r']], ['DRAFT_IN_PERIOD', ['d']], ['UNRESOLVED_FLAGS', ['f']], ['GROUP_MISMATCH', []],
    ])
  })

  it('취소·반려된 건은 점검에서 뺀다', () => {
    const r = preCloseCheck({ claims: [claim({ id: 'x', status: 'cancelled', openFlags: 3 }), claim({ id: 'y', status: 'rejected', openFlags: 1 })] })
    expect(r).toMatchObject({ canClose: true, checked: 0 })
  })

  it('회사 결정 전 값·노무 확인·달력 미검증은 마감을 막지 않고 경고로 남긴다 (급여 반영 전 결정 필요)', () => {
    const r = preCloseCheck({ claims: [claim({ heldKeys: ['nightOvertime'], legalReview: ['C-0'], calendarUnverified: true })] })
    expect(r.canClose).toBe(true)
    expect(r.warnings.map((w) => w.code)).toEqual(['CALENDAR_UNVERIFIED', 'HELD_VALUES', 'LEGAL_REVIEW'])
  })

  it('급여 반영 여부를 판단하지 않는다 (결과에 급여 관련 필드가 없다)', () => {
    const keys = Object.keys(preCloseCheck({ claims: [] }))
    expect(keys.some((k) => /payroll|apply|pay/i.test(k))).toBe(false)
  })
})

/**
 * 화면이 하는 조작을 그대로 따라가는 흐름 테스트.
 * 컴포넌트가 부르는 함수(formReducer·previewDays·submitBlockers·buildClaimDetail·guarded service)를 같은 순서로 호출한다.
 * DOM 이벤트는 쓰지 않는다 — 브라우저 상호작용은 sandbox/ 에서 수동으로 확인한다.
 */
import { describe, expect, it } from 'vitest'
import { createGuardedTripService, createMemoryRepository, createStaticGate, type ServiceDeps } from '../../data'
import { MON, TEST_CALENDAR, TUE, WED, alice, bob, boss, unwrap } from '../../data/__tests__/fixtures'
import { buildClaimDetail, formReducer, initialFormState, previewDays, submitBlockers, type TripFormState } from '../../ui'

function app() {
  let seq = 0
  let tick = 0
  const deps: ServiceDeps = {
    repo: createMemoryRepository(),
    calendar: TEST_CALENDAR,
    now: () => `2026-11-10T09:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}Z`,
    newId: (p) => `${p}-${++seq}`,
  }
  const gate = createStaticGate({ employeeForm: true, adminReview: true }, { [alice.id]: 'employee', [bob.id]: 'employee', [boss.id]: 'admin' })
  return createGuardedTripService(deps, gate)
}

/** TripClaimForm 의 저장 버튼 */
function save(svc: ReturnType<typeof app>, actor: typeof alice, s: TripFormState): TripFormState {
  const r = s.saved
    ? svc.updateDraft(actor, s.saved.id, s.saved.version, { header: s.header, entries: s.entries })
    : svc.createClaim(actor, { header: s.header, entries: s.entries })
  return r.ok ? formReducer(s, { type: 'saved', claim: r.value }) : formReducer(s, { type: 'failed', code: r.code, message: r.message })
}
/** TripClaimForm 의 제출 버튼 (차단 사유가 있으면 눌리지 않는다) */
function submit(svc: ReturnType<typeof app>, actor: typeof alice, s: TripFormState): TripFormState {
  const blockers = submitBlockers(s, previewDays(s, TEST_CALENDAR))
  if (blockers.length > 0) return formReducer(s, { type: 'failed', code: 'UI_BLOCKED', message: blockers.join(' · ') })
  const r = svc.submit(actor, s.saved!.id, s.saved!.version)
  return r.ok ? formReducer(s, { type: 'saved', claim: r.value }) : formReducer(s, { type: 'failed', code: r.code, message: r.message })
}
/** 기존 신청을 다시 여는 것 (useReducer init) */
function open(svc: ReturnType<typeof app>, actor: typeof alice, claimId: string): TripFormState {
  const r = unwrap(svc.myClaim(actor, claimId))
  return formReducer(initialFormState(MON), { type: 'loaded', claim: r.claim, entries: r.days.map((d) => d.entry) })
}

describe('직원: 입력 → 미리보기 → 저장 → 제출', () => {
  it('지역 없이 제출 시도는 화면에서 막히고, 기본 입력만으로 4시간 확정 → 저장 → 제출', () => {
    const svc = app()
    let s = initialFormState(MON)
    s = formReducer(s, { type: 'patchEntry', date: MON, patch: { site: { start: '08:00', end: '17:00' } } })
    expect(submitBlockers(s, previewDays(s, TEST_CALENDAR))).toEqual(['먼저 저장하세요', '지역을 고르세요', `입력이 더 필요한 날: ${MON}`])
    s = formReducer(s, { type: 'setRegions', regions: ['대전'] })
    expect(previewDays(s, TEST_CALENDAR)[0].result).toMatchObject({ ok: true, trip: { hours: 4 }, status: 'confirmed' })
    s = save(svc, alice, s)
    expect(s.saved).toMatchObject({ status: 'draft', version: 1 })
    s = submit(svc, alice, s)
    expect(s.saved?.status).toBe('submitted')
    expect(s.error).toBeUndefined()
  })

  it('숙박으로 바꾸고 둘째 날을 비우면 제출이 막히고, 채우면 제출된다', () => {
    const svc = app()
    let s = formReducer(initialFormState(MON), { type: 'setRegions', regions: ['대전'] })
    s = formReducer(s, { type: 'setSchedule', schedule: { kind: 'stay', startDate: MON, endDate: TUE } })
    s = formReducer(s, { type: 'patchEntry', date: MON, patch: { site: { start: '08:00', end: '17:00' } } })
    s = save(svc, alice, s)
    s = submit(svc, alice, s)
    expect(s.error).toMatchObject({ code: 'UI_BLOCKED' })
    expect(s.error?.message).toContain(TUE)
    s = formReducer(s, { type: 'patchEntry', date: TUE, patch: { site: { start: '08:00', end: '17:00' } } })
    expect(submitBlockers(s, previewDays(s, TEST_CALENDAR))).toEqual(['고친 내용을 저장한 뒤 제출하세요'])
    s = save(svc, alice, s)
    s = submit(svc, alice, s)
    expect(s.saved?.status).toBe('submitted')
  })

  it('두 탭에서 같은 초안을 고치면 늦은 탭은 버전 충돌 → 새로 불러오기 → 다시 입력', () => {
    const svc = app()
    let base = formReducer(initialFormState(MON), { type: 'setRegions', regions: ['대전'] })
    base = formReducer(base, { type: 'patchEntry', date: MON, patch: { site: { start: '08:00', end: '17:00' } } })
    base = save(svc, alice, base)
    const tabA = open(svc, alice, base.saved!.id)
    let tabB = open(svc, alice, base.saved!.id)
    expect(save(svc, alice, formReducer(tabA, { type: 'patchEntry', date: MON, patch: { site: { start: '07:00', end: '17:00' } } })).error).toBeUndefined()
    tabB = save(svc, alice, formReducer(tabB, { type: 'patchEntry', date: MON, patch: { lunchTaken: false } }))
    expect(tabB.error?.code).toBe('VERSION_CONFLICT')
    // "새로 불러오기"
    tabB = open(svc, alice, base.saved!.id)
    expect(tabB.entries[0].site?.start).toBe('07:00') // A 의 저장이 살아 있다
    expect(tabB.entries[0].lunchTaken).toBeUndefined() // B 의 입력은 저장되지 않았다
    tabB = save(svc, alice, formReducer(tabB, { type: 'patchEntry', date: MON, patch: { lunchTaken: false } }))
    expect(tabB.error).toBeUndefined()
    // 07시 시작, 점심 못 씀: 조정 = (9−7) + (17−18) + 1 = 2 → 연장 2, 출장 4 (4절)
    expect(previewDays(tabB, TEST_CALENDAR)[0].result).toMatchObject({ ok: true, trip: { hours: 4 }, overtime: { hours: 2 } })
  })
})

describe('동행: 초안 → 동행자 각자 확인·제출', () => {
  it('동행자는 자기 초안을 열어 점심을 고치고 직접 제출한다. 신청자 화면에는 동행자 초안이 없다', () => {
    const svc = app()
    let s = formReducer(initialFormState(MON), { type: 'setRegions', regions: ['대전'] })
    s = save(svc, alice, formReducer(s, { type: 'patchEntry', date: MON, patch: { site: { start: '08:00', end: '17:00' } } }))
    const { created } = unwrap(svc.inviteCompanions(alice, s.saved!.id, [bob.id]))
    expect(unwrap(svc.myClaims(alice)).map((c) => c.id)).toEqual([s.saved!.id])
    let b = open(svc, bob, created[0])
    expect(b.saved?.origin).toBe('companion_draft')
    b = save(svc, bob, formReducer(b, { type: 'patchEntry', date: MON, patch: { lunchTaken: false } }))
    b = submit(svc, bob, b)
    expect(b.saved?.status).toBe('submitted')
    expect(previewDays(b, TEST_CALENDAR)[0].result).toMatchObject({ ok: true, trip: { hours: 4 }, overtime: { hours: 1 } })
  })
})

describe('관리자: 검토 → 되돌림 → 재제출 → 확인 → 승인 → 정산(급여 미반영)', () => {
  it('끝까지', () => {
    const svc = app()
    let s = formReducer(initialFormState(MON), { type: 'setRegions', regions: ['대전'] })
    s = formReducer(s, { type: 'setSchedule', schedule: { kind: 'stay', startDate: MON, endDate: WED } })
    for (const d of [MON, TUE, WED]) s = formReducer(s, { type: 'patchEntry', date: d, patch: { site: { start: '08:00', end: d === TUE ? '19:00' : '17:00' } } })
    s = submit(svc, alice, save(svc, alice, s))
    const id = s.saved!.id

    // 관리자 목록 → 상세
    expect(unwrap(svc.reviewQueue(boss, 'submitted')).map((c) => c.id)).toEqual([id])
    let view = buildClaimDetail(unwrap(svc.claimDetail(boss, id)), [])
    expect(view.blockers).toEqual(['확인하지 않은 표시 1건'])

    // 되돌림 (사유 필수) → 직원이 고쳐 재제출
    expect(svc.review(boss, id, { action: 'return', expectedCalcIds: view.expectedCalcIds })).toMatchObject({ code: 'REASON_REQUIRED' })
    unwrap(svc.review(boss, id, { action: 'return', expectedCalcIds: view.expectedCalcIds, reason: '화요일 종료 시각 확인' }))
    let e = open(svc, alice, id)
    expect(e.saved?.status).toBe('returned')
    e = submit(svc, alice, save(svc, alice, formReducer(e, { type: 'patchEntry', date: TUE, patch: { site: { start: '08:00', end: '18:30' } } })))
    expect(e.saved?.status).toBe('submitted')

    // 옛 화면으로 승인하면 STALE_CALC, 새로 불러와서 확인 표시 후 승인
    expect(svc.review(boss, id, { action: 'approve', expectedCalcIds: view.expectedCalcIds })).toMatchObject({ code: 'STALE_CALC' })
    const data = unwrap(svc.claimDetail(boss, id))
    view = buildClaimDetail(data, [])
    const decisions = view.days.flatMap((d) => d.items.map((i) => ({ calcId: i.calcId, code: i.code, decision: 'acknowledged' as const })))
    expect(buildClaimDetail(data, decisions).blockers).toEqual([])
    unwrap(svc.review(boss, id, { action: 'approve', expectedCalcIds: view.expectedCalcIds, flagDecisions: decisions }))

    // 승인 뒤: 직원은 취소 불가, 관리자 수정 불가, 정산 미리보기는 제안값 보류·급여 미반영
    expect(svc.cancel(alice, id, unwrap(svc.myClaim(alice, id)).claim.version)).toMatchObject({ code: 'NOT_CANCELLABLE' })
    const after = buildClaimDetail(unwrap(svc.claimDetail(boss, id)), [])
    expect(after.approvedSnapshot).toMatchObject({ changedSinceApproval: false })
    const settle = unwrap(svc.settlementPreview(boss, id))
    expect(settle.payrollApplicable).toBe(false)
    expect(settle.days[1].held).toEqual({ overtime: 1.5 }) // 화요일(중간일 E5) 제안값은 보류
    expect(settle.days[0].confirmed).toEqual({ trip: 2 })
  })

  it('반려는 끝 — 직원이 수정·취소할 수 없다', () => {
    const svc = app()
    let s = formReducer(initialFormState(MON), { type: 'setRegions', regions: ['대전'] })
    s = submit(svc, alice, save(svc, alice, formReducer(s, { type: 'patchEntry', date: MON, patch: { site: { start: '08:00', end: '17:00' } } })))
    const id = s.saved!.id
    const view = buildClaimDetail(unwrap(svc.claimDetail(boss, id)), [])
    unwrap(svc.review(boss, id, { action: 'reject', expectedCalcIds: view.expectedCalcIds, reason: '출장 아님' }))
    const e = open(svc, alice, id)
    expect(e.saved?.status).toBe('rejected')
    expect(save(svc, alice, formReducer(e, { type: 'patchEntry', date: MON, patch: { lunchTaken: false } })).error?.code).toBe('NOT_EDITABLE')
  })
})

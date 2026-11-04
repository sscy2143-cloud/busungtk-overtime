import { describe, expect, it } from 'vitest'
import { createGuardedTripService, createStaticGate } from '../gate'
import { createMemoryRepository } from '../repository'
import { createTripService, type ServiceDeps } from '../service'
import { MON, TEST_CALENDAR, TUE, alice, bob, boss, dayHeader, setup, siteEntry, unwrap } from './fixtures'

const boss2 = { id: 'admin-two', role: 'admin' as const }

describe('동시 요청·중복 제출 — 버전과 상태로 막는다', () => {
  it('같은 초안을 두 화면에서 저장: 뒤에 저장하는 쪽이 VERSION_CONFLICT, 먼저 저장한 내용은 유지', () => {
    const { service, repo } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const tabA = { ...draft }
    const tabB = { ...draft }
    unwrap(service.updateDraft(alice, tabA.id, tabA.version, { entries: [siteEntry(MON, '07:00', '17:00')] }))
    const late = service.updateDraft(alice, tabB.id, tabB.version, { entries: [siteEntry(MON, '09:00', '17:00')] })
    expect(late).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
    expect(repo.listDays(draft.id)[0].entry.site?.start).toBe('07:00')
  })

  it('같은 버전으로 제출을 두 번 보내면 두 번째는 막힌다 (상태가 바뀌었으므로)', () => {
    const { service } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const first = service.submit(alice, draft.id, draft.version)
    const second = service.submit(alice, draft.id, draft.version)
    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: false, code: 'NOT_EDITABLE' })
  })

  it('관리자 두 명이 같은 건을 승인하면 두 번째는 NOT_SUBMITTED, 검토 기록은 한 건', () => {
    const { service, repo } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const sent = unwrap(service.submit(alice, draft.id, draft.version))
    const ids = service.latestCalcs(sent.id).map((c) => c.id)
    expect(service.review(boss, sent.id, { action: 'approve', expectedCalcIds: ids }).ok).toBe(true)
    expect(service.review(boss2, sent.id, { action: 'approve', expectedCalcIds: ids })).toMatchObject({ code: 'NOT_SUBMITTED' })
    expect(repo.listReviews(sent.id)).toHaveLength(1)
  })

  it('관리자가 수정하는 사이 다른 관리자가 옛 화면으로 승인하면 STALE_CALC', () => {
    const { service, repo } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const sent = unwrap(service.submit(alice, draft.id, draft.version))
    const screenOfBoss2 = service.latestCalcs(sent.id).map((c) => c.id)
    const [day] = repo.listDays(sent.id)
    unwrap(service.adminAdjustDay(boss, sent.id, day.id, day.revision, siteEntry(MON, '07:00', '17:00'), '완료보고 기준'))
    expect(service.review(boss2, sent.id, { action: 'approve', expectedCalcIds: screenOfBoss2 })).toMatchObject({ code: 'STALE_CALC' })
  })

  it('직원이 제출한 직후 수정을 보내면(화면이 늦게 갱신) NOT_EDITABLE — 제출본이 바뀌지 않는다', () => {
    const { service, repo } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const sent = unwrap(service.submit(alice, draft.id, draft.version))
    expect(service.updateDraft(alice, sent.id, sent.version, { entries: [siteEntry(MON, '06:00', '17:00')] })).toMatchObject({ code: 'NOT_EDITABLE' })
    expect(repo.listDays(sent.id)[0].entry.site?.start).toBe('08:00')
  })

  it('같은 날짜로 두 초안을 연달아 만들면 두 번째는 DUPLICATE_DAY (부분 생성 없음)', () => {
    const { service, repo } = setup()
    unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(service.createClaim(alice, { header: dayHeader(['부산']), entries: [siteEntry(MON, '09:00', '18:00')] })).toMatchObject({ code: 'DUPLICATE_DAY' })
    expect(repo.listClaims({ employeeId: alice.id })).toHaveLength(1)
  })
})

describe('직원 간 데이터 접근 차단 (게이트)', () => {
  function svc() {
    let seq = 0
    const deps: ServiceDeps = { repo: createMemoryRepository(), calendar: TEST_CALENDAR, now: () => '2026-11-10T09:00:00Z', newId: (p) => `${p}-${++seq}` }
    const gate = createStaticGate({ employeeForm: true, adminReview: true }, { [alice.id]: 'employee', [bob.id]: 'employee', [boss.id]: 'admin' })
    return { g: createGuardedTripService(deps, gate), raw: createTripService(deps) }
  }

  it('다른 직원의 신청은 열기·수정·제출·취소·동행 초대 전부 거부', () => {
    const { g } = svc()
    const a = unwrap(g.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(g.myClaim(bob, a.id)).toMatchObject({ code: 'FORBIDDEN' })
    expect(g.updateDraft(bob, a.id, a.version, {})).toMatchObject({ code: 'FORBIDDEN' })
    expect(g.submit(bob, a.id, a.version)).toMatchObject({ code: 'FORBIDDEN' })
    expect(g.cancel(bob, a.id, a.version)).toMatchObject({ code: 'FORBIDDEN' })
    expect(g.inviteCompanions(bob, a.id, [bob.id])).toMatchObject({ code: 'FORBIDDEN' })
    expect(g.latestCalcs(bob, a.id)).toMatchObject({ code: 'FORBIDDEN' })
    expect(unwrap(g.myClaims(bob))).toEqual([])
  })

  it('관리자 대리 작성은 작성자(initiator)를 남기고, 직원이 다른 직원 이름으로 쓰는 것은 거부', () => {
    const { g } = svc()
    expect(g.createClaim(bob, { employeeId: alice.id, header: dayHeader(['대전'], TUE), entries: [siteEntry(TUE, '08:00', '17:00')] })).toMatchObject({ code: 'FORBIDDEN' })
    // 관리자 대리 작성은 직원 화면 스위치(employeeForm)로 게이트되며, 서버 역할이 admin 이어야 한다
    const c = unwrap(g.createClaim(boss, { employeeId: alice.id, header: dayHeader(['대전'], TUE), entries: [siteEntry(TUE, '08:00', '17:00')] }))
    expect(c).toMatchObject({ employeeId: alice.id, initiatorId: boss.id })
  })
})

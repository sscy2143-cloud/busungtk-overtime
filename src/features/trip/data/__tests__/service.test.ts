import { describe, expect, it } from 'vitest'
import { reviewItems } from '../service'
import type { FlagDecision, TripCalcRecord } from '../types'
import { HOLIDAY, MON, TUE, WED, alice, bob, boss, carol, dayHeader, setup, siteEntry, stayHeader, unwrap } from './fixtures'

const ack = (calcs: TripCalcRecord[]): FlagDecision[] =>
  calcs.flatMap((c) => reviewItems(c).map((code) => ({ calcId: c.id, code, decision: 'acknowledged' as const })))

function submitted(svc: ReturnType<typeof setup>['service'], header = dayHeader(['대전']), entries = [siteEntry(MON, '08:00', '17:00')]) {
  const draft = unwrap(svc.createClaim(alice, { header, entries }))
  return unwrap(svc.submit(alice, draft.id, draft.version))
}

describe('작성·제출 — 최소 입력', () => {
  it('지역 + 현장 시각만으로 작성 → 계산 → 제출', () => {
    const { service } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(draft.status).toBe('draft')
    const [calc] = service.latestCalcs(draft.id)
    expect(calc.classification.workType).toBe('day_trip')
    expect(calc.result?.ok && calc.result.trip.hours).toBe(4)
    expect(calc.engineInput?.lunchTaken).toBe(true)
    const sent = unwrap(service.submit(alice, draft.id, draft.version))
    expect(sent.status).toBe('submitted')
    expect(sent.submittedAt).toBeDefined()
  })

  it('원본 입력과 계산 결과를 따로 저장한다 (계산 결과는 고칠 수 없다)', () => {
    const { service, repo } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const [day] = repo.listDays(draft.id)
    expect(day.entry).toEqual(siteEntry(MON, '08:00', '17:00'))
    const [calc] = service.latestCalcs(draft.id)
    expect(calc.dayRevision).toBe(day.revision)
    expect(Object.isFrozen(calc)).toBe(true)
    expect(Object.isFrozen(calc.result)).toBe(true)
    expect(() => repo.insertCalc(calc)).toThrow('계산 결과는 수정할 수 없습니다')
  })

  it('입력이 모자란 날이 있으면 제출할 수 없다', () => {
    const { service } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['부산']), entries: [{ date: MON, noSiteWork: { reason: '고객 사정 취소' } }] }))
    const [calc] = service.latestCalcs(draft.id)
    expect(calc.classification.missing).toEqual(['travelStarts.out', 'travelStarts.back'])
    const r = service.submit(alice, draft.id, draft.version)
    expect(r.ok || r.code).toBe('INCOMPLETE')
  })

  it('E4 충돌(사무실 근무와 겹침)만 출발 시각을 추가로 묻는다', () => {
    const { service } = setup()
    const draft = unwrap(service.createClaim(alice, {
      header: dayHeader(['대전']), entries: [siteEntry(MON, '19:00', '23:00', { office: { start: '09:00', end: '18:00' } })],
    }))
    expect(service.latestCalcs(draft.id)[0].classification.missing).toEqual(['travelStarts.out'])
    const fixed = unwrap(service.updateDraft(alice, draft.id, draft.version, {
      entries: [siteEntry(MON, '19:00', '23:00', { office: { start: '09:00', end: '17:00' } })],
    }))
    expect(service.latestCalcs(fixed.id)[0].classification.missing).toEqual([])
  })

  it('일정 밖 날짜·같은 날 두 번·빈 지역은 거부', () => {
    const { service } = setup()
    const h = dayHeader(['대전'])
    expect(service.createClaim(alice, { header: h, entries: [siteEntry(TUE, '08:00', '17:00')] })).toMatchObject({ ok: false, code: 'DATE_OUT_OF_SCHEDULE' })
    expect(service.createClaim(alice, { header: h, entries: [siteEntry(MON, '08:00', '17:00'), siteEntry(MON, '09:00', '18:00')] })).toMatchObject({ ok: false, code: 'DUPLICATE_DATE' })
    expect(service.createClaim(alice, { header: dayHeader([]), entries: [siteEntry(MON, '08:00', '17:00')] })).toMatchObject({ ok: false, code: 'REGION_REQUIRED' })
    expect(service.createClaim(alice, { header: stayHeader(['대전'], MON, MON), entries: [siteEntry(MON, '08:00', '17:00')] })).toMatchObject({ ok: false, code: 'INVALID_DATE' })
  })
})

describe('같은 직원·같은 날 중복 금지 (UNIQUE(직원, 근무일))', () => {
  it('진행 중인 신청과 날짜가 겹치면 아무것도 만들지 않는다 (일부만 생기지 않음)', () => {
    const { service, repo } = setup()
    unwrap(service.createClaim(alice, { header: dayHeader(['대전'], TUE), entries: [siteEntry(TUE, '08:00', '17:00')] }))
    const before = repo.listClaims().length
    const r = service.createClaim(alice, { header: stayHeader(['대전'], MON, WED), entries: [siteEntry(MON, '08:00', '17:00'), siteEntry(TUE, '08:00', '17:00')] })
    expect(r).toMatchObject({ ok: false, code: 'DUPLICATE_DAY' })
    expect(repo.listClaims().length).toBe(before)
  })

  it('취소한 신청의 날짜는 다시 쓸 수 있다', () => {
    const { service } = setup()
    const first = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    unwrap(service.cancel(alice, first.id, first.version))
    expect(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }).ok).toBe(true)
  })

  it('다른 직원은 같은 날 신청해도 된다', () => {
    const { service } = setup()
    unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(service.createClaim(bob, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }).ok).toBe(true)
  })
})

describe('수정·취소·권한', () => {
  it('입력이 바뀐 날만 다시 계산한다 (바뀌지 않은 날의 계산 결과는 그대로)', () => {
    const { service } = setup()
    const h = stayHeader(['대전'], MON, TUE)
    const draft = unwrap(service.createClaim(alice, { header: h, entries: [siteEntry(MON, '08:00', '17:00'), siteEntry(TUE, '08:00', '17:00')] }))
    const [mon1, tue1] = service.latestCalcs(draft.id)
    const next = unwrap(service.updateDraft(alice, draft.id, draft.version, { entries: [siteEntry(MON, '08:00', '17:00'), siteEntry(TUE, '07:00', '17:00')] }))
    const [mon2, tue2] = service.latestCalcs(next.id)
    expect(mon2.id).toBe(mon1.id)
    expect(tue2.id).not.toBe(tue1.id)
    expect(next.version).toBe(draft.version + 1)
  })

  it('먼저 저장된 내용이 있으면 덮어쓰지 않는다 (동시 수정)', () => {
    const { service } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    unwrap(service.updateDraft(alice, draft.id, draft.version, { entries: [siteEntry(MON, '07:00', '17:00')] }))
    expect(service.updateDraft(alice, draft.id, draft.version, { entries: [siteEntry(MON, '09:00', '17:00')] }))
      .toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
  })

  it('다른 직원 신청은 수정·제출·취소할 수 없다', () => {
    const { service } = setup()
    const draft = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(service.updateDraft(bob, draft.id, draft.version, {})).toMatchObject({ code: 'FORBIDDEN' })
    expect(service.submit(bob, draft.id, draft.version)).toMatchObject({ code: 'FORBIDDEN' })
    expect(service.cancel(bob, draft.id, draft.version)).toMatchObject({ code: 'FORBIDDEN' })
    expect(service.createClaim(bob, { employeeId: alice.id, header: dayHeader(['대전'], TUE), entries: [siteEntry(TUE, '08:00', '17:00')] }))
      .toMatchObject({ code: 'FORBIDDEN' })
  })

  it('관리자는 직원 대신 작성할 수 있다 (대리 입력, 작성자 기록)', () => {
    const { service } = setup()
    const c = unwrap(service.createClaim(boss, { employeeId: alice.id, header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(c.employeeId).toBe(alice.id)
    expect(c.initiatorId).toBe(boss.id)
  })

  it('제출 후에는 직원이 고칠 수 없고, 제출 상태에서는 취소할 수 있다', () => {
    const { service } = setup()
    const s = submitted(service)
    expect(service.updateDraft(alice, s.id, s.version, {})).toMatchObject({ code: 'NOT_EDITABLE' })
    expect(unwrap(service.cancel(alice, s.id, s.version)).status).toBe('cancelled')
  })
})

describe('관리자 검토', () => {
  it('승인: 화면에 보인 계산 결과에 묶인다', () => {
    const { service, repo } = setup()
    const s = submitted(service)
    const calcs = service.latestCalcs(s.id)
    const done = unwrap(service.review(boss, s.id, { action: 'approve', expectedCalcIds: calcs.map((c) => c.id) }))
    expect(done.status).toBe('approved')
    expect(repo.listReviews(s.id)[0].calcIds).toEqual(calcs.map((c) => c.id))
  })

  it('직원·본인은 검토할 수 없다', () => {
    const { service } = setup()
    const s = submitted(service)
    const ids = service.latestCalcs(s.id).map((c) => c.id)
    expect(service.review(bob, s.id, { action: 'approve', expectedCalcIds: ids })).toMatchObject({ code: 'FORBIDDEN' })
    const own = unwrap(service.createClaim(boss, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const ownSent = unwrap(service.submit(boss, own.id, own.version))
    expect(service.review(boss, ownSent.id, { action: 'approve', expectedCalcIds: service.latestCalcs(own.id).map((c) => c.id) }))
      .toMatchObject({ code: 'SELF_REVIEW' })
  })

  it('관리자 수정: 원래 입력과 사유를 남기고 새 계산을 만든다. 수정 전 화면으로는 승인할 수 없다', () => {
    const { service, repo } = setup()
    const s = submitted(service)
    const [before] = service.latestCalcs(s.id)
    const [day] = repo.listDays(s.id)
    expect(service.adminAdjustDay(boss, s.id, day.id, day.revision, siteEntry(MON, '07:00', '17:00'), '')).toMatchObject({ code: 'REASON_REQUIRED' })
    const after = unwrap(service.adminAdjustDay(boss, s.id, day.id, day.revision, siteEntry(MON, '07:00', '17:00'), '채널톡 완료보고 기준 07시 시작'))
    expect(after.id).not.toBe(before.id)
    expect(after.result?.ok && after.result.overtime.hours).toBe(1)
    expect(repo.listAdjustments(s.id)).toMatchObject([{ before: siteEntry(MON, '08:00', '17:00'), after: siteEntry(MON, '07:00', '17:00'), adminId: boss.id }])
    expect(service.review(boss, s.id, { action: 'approve', expectedCalcIds: [before.id] })).toMatchObject({ code: 'STALE_CALC' })
    expect(service.review(boss, s.id, { action: 'approve', expectedCalcIds: [after.id], flagDecisions: ack([after]) }).ok).toBe(true)
  })

  it('확인 표시가 남아 있으면 승인할 수 없다. 확인해도 제안값은 정산에서 보류된다', () => {
    const { service } = setup()
    const s = submitted(service, stayHeader(['대전'], MON, WED), [
      siteEntry(MON, '08:00', '17:00'), siteEntry(TUE, '08:00', '19:00'), siteEntry(WED, '08:00', '17:00'),
    ])
    const calcs = service.latestCalcs(s.id)
    const ids = calcs.map((c) => c.id)
    expect(service.review(boss, s.id, { action: 'approve', expectedCalcIds: ids })).toMatchObject({ code: 'UNRESOLVED_FLAGS' })
    unwrap(service.review(boss, s.id, { action: 'approve', expectedCalcIds: ids, flagDecisions: ack(calcs) }))
    const settle = unwrap(service.settlementPreview(s.id))
    expect(settle.payrollApplicable).toBe(false)
    expect(settle.days.map((d) => [d.date, d.confirmed, d.held])).toEqual([
      [MON, { trip: 2 }, {}],
      [TUE, {}, { overtime: 2 }], // 숙박 중간일(E5)은 승인 후에도 제안값 → 보류
      [WED, { trip: 2 }, {}],
    ])
  })

  it('되돌림 → 직원 수정 → 다시 제출 → 승인 / 반려는 끝', () => {
    const { service } = setup()
    const s = submitted(service)
    expect(service.review(boss, s.id, { action: 'return', expectedCalcIds: service.latestCalcs(s.id).map((c) => c.id) })).toMatchObject({ code: 'REASON_REQUIRED' })
    const back = unwrap(service.review(boss, s.id, { action: 'return', expectedCalcIds: service.latestCalcs(s.id).map((c) => c.id), reason: '현장 시각 확인 필요' }))
    expect(back.status).toBe('returned')
    const edited = unwrap(service.updateDraft(alice, s.id, back.version, { entries: [siteEntry(MON, '08:30', '17:00')] }))
    const again = unwrap(service.submit(alice, s.id, edited.version))
    const calcs = service.latestCalcs(s.id)
    unwrap(service.review(boss, s.id, { action: 'approve', expectedCalcIds: calcs.map((c) => c.id), flagDecisions: ack(calcs) }))
    expect(again.status).toBe('submitted')

    const s2 = submitted(service, dayHeader(['대전'], TUE), [siteEntry(TUE, '08:00', '17:00')])
    const rejected = unwrap(service.review(boss, s2.id, { action: 'reject', expectedCalcIds: service.latestCalcs(s2.id).map((c) => c.id), reason: '출장 아님' }))
    expect(service.updateDraft(alice, s2.id, rejected.version, {})).toMatchObject({ code: 'NOT_EDITABLE' })
    expect(service.cancel(alice, s2.id, rejected.version)).toMatchObject({ code: 'NOT_CANCELLABLE' })
  })

  it('승인된 신청은 직원이 취소할 수 없고 관리자도 고칠 수 없다 (승인 후 정정은 다음 달 조정)', () => {
    const { service, repo } = setup()
    const s = submitted(service)
    const done = unwrap(service.review(boss, s.id, { action: 'approve', expectedCalcIds: service.latestCalcs(s.id).map((c) => c.id) }))
    expect(service.cancel(alice, s.id, done.version)).toMatchObject({ code: 'NOT_CANCELLABLE' })
    const [day] = repo.listDays(s.id)
    expect(service.adminAdjustDay(boss, s.id, day.id, day.revision, siteEntry(MON, '07:00', '17:00'), '정정')).toMatchObject({ code: 'NOT_EDITABLE' })
  })

  it('승인 전 신청은 정산 대상이 아니다', () => {
    const { service } = setup()
    const s = submitted(service)
    expect(service.settlementPreview(s.id)).toMatchObject({ ok: false, code: 'NOT_APPROVED' })
  })

  it('휴일 근무는 휴일근로로 정산 미리보기에 나온다 (출장·연장 아님)', () => {
    const { service } = setup()
    const s = submitted(service, dayHeader(['대전'], HOLIDAY), [siteEntry(HOLIDAY, '08:00', '17:00')])
    const calcs = service.latestCalcs(s.id)
    unwrap(service.review(boss, s.id, { action: 'approve', expectedCalcIds: calcs.map((c) => c.id), flagDecisions: ack(calcs) }))
    expect(unwrap(service.settlementPreview(s.id)).days[0].confirmed).toEqual({ holidayWithin8: 8, holidayOver8: 4 })
  })
})

describe('동행 출장 — 초안만 보내고 각자 제출', () => {
  it('같은 사실만 복사하고 점심·휴게·사무실 근무는 복사하지 않는다', () => {
    const { service, repo } = setup()
    const mine = unwrap(service.createClaim(alice, {
      header: dayHeader(['대전']),
      entries: [siteEntry(MON, '08:00', '17:00', { lunchTaken: false, breaks: [{ start: '15:00', end: '15:30' }], actual: { departAt: '06:10', source: 'self' } })],
    }))
    const { created, skipped } = unwrap(service.inviteCompanions(alice, mine.id, [bob.id, carol.id, alice.id]))
    expect(created).toHaveLength(2)
    expect(skipped).toEqual([])
    const bobClaim = repo.getClaim(created[0])!
    expect(bobClaim).toMatchObject({ employeeId: bob.id, origin: 'companion_draft', status: 'draft', groupId: mine.groupId, initiatorId: alice.id })
    expect(repo.listDays(bobClaim.id)[0].entry).toEqual({ date: MON, site: { start: '08:00', end: '17:00' }, actual: { departAt: '06:10', source: 'companion_copy' } })
  })

  it('동행자 초안은 신청자가 제출할 수 없고, 동행자가 직접 제출한다', () => {
    const { service, repo } = setup()
    const mine = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const [bobId] = unwrap(service.inviteCompanions(alice, mine.id, [bob.id])).created
    const bobClaim = repo.getClaim(bobId)!
    expect(service.submit(alice, bobId, bobClaim.version)).toMatchObject({ code: 'FORBIDDEN' })
    expect(unwrap(service.submit(bob, bobId, bobClaim.version)).status).toBe('submitted')
  })

  it('이미 그날 신청이 있는 동행자는 건너뛴다', () => {
    const { service } = setup()
    unwrap(service.createClaim(bob, { header: dayHeader(['부산']), entries: [siteEntry(MON, '09:00', '18:00')] }))
    const mine = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(unwrap(service.inviteCompanions(alice, mine.id, [bob.id])).skipped).toEqual([{ employeeId: bob.id, reason: `${MON}에 이미 신청한 근무일이 있음` }])
  })

  it('동행자가 현장 시각을 바꾸면 관리자에게 불일치로 보인다', () => {
    const { service, repo } = setup()
    const mine = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const [bobId] = unwrap(service.inviteCompanions(alice, mine.id, [bob.id])).created
    expect(service.groupMismatches(mine.groupId)).toEqual([])
    unwrap(service.updateDraft(bob, bobId, repo.getClaim(bobId)!.version, { entries: [siteEntry(MON, '08:00', '19:00')] }))
    expect(service.groupMismatches(mine.groupId)).toEqual([{ date: MON, field: 'site', employeeIds: [alice.id, bob.id] }])
  })
})

describe('다음 날로 넘어가는 작업·이동 연결 (5-4, E7)', () => {
  const overnight = siteEntry(MON, '21:00', '11:00', { site: { start: '21:00', end: '11:00', endNextDay: true }, breaks: [{ start: '02:00', end: '03:00', startNextDay: true, endNextDay: true }] })

  it('같은 출장 안의 다음 날 기록과 연결한다', () => {
    const { service } = setup()
    const draft = unwrap(service.createClaim(alice, { header: stayHeader(['대전'], MON, TUE), entries: [overnight, siteEntry(TUE, '09:00', '11:00')] }))
    const [mon, tue] = service.latestCalcs(draft.id)
    expect(mon.carryOut).toMatchObject({ toDate: TUE, work: { start: 33, end: 35 }, linkedDayId: tue.dayId })
    expect(tue.carryIn).toMatchObject({ fromDate: MON, work: { start: 33, end: 35 } })
    expect(mon.result?.ok && mon.result.proposedBy).toContain('E7')
  })

  it('다음 날 기록이 없으면 표시하고, 관리자가 확인해야 승인할 수 있다', () => {
    const { service } = setup()
    const s = submitted(service, dayHeader(['대전']), [overnight])
    const calcs = service.latestCalcs(s.id)
    expect(calcs[0].classification.notices.map((n) => n.code)).toContain('NEXT_DAY_ENTRY_MISSING')
    expect(calcs[0].carryOut?.travel).toEqual([{ start: 35, end: 37 }])
    const flagsOnly = calcs.flatMap((c) => (c.result?.ok ? c.result.flags : []).map((f) => ({ calcId: c.id, code: f.code, decision: 'acknowledged' as const })))
    expect(service.review(boss, s.id, { action: 'approve', expectedCalcIds: calcs.map((c) => c.id), flagDecisions: flagsOnly }))
      .toMatchObject({ code: 'UNRESOLVED_FLAGS' })
    expect(service.review(boss, s.id, { action: 'approve', expectedCalcIds: calcs.map((c) => c.id), flagDecisions: ack(calcs) }).ok).toBe(true)
  })
})

describe('주간 점검', () => {
  it('그 주 진행 중인 신청만 모아 경고한다 (취소 건 제외)', () => {
    const { service } = setup()
    unwrap(service.createClaim(alice, { header: dayHeader(['대전'], MON), entries: [siteEntry(MON, '07:00', '20:00')] }))
    const t = unwrap(service.createClaim(alice, { header: dayHeader(['대전'], TUE), entries: [siteEntry(TUE, '07:00', '20:00')] }))
    expect(service.weeklyCheck(alice.id, WED).level).toBe('block_warning') // (4 + 4) × 2 = 16
    unwrap(service.cancel(alice, t.id, t.version))
    expect(service.weeklyCheck(alice.id, WED)).toMatchObject({ companyHours: 8, level: 'ok' })
  })
})

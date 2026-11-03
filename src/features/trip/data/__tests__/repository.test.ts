/**
 * 메모리 저장소가 DB 제약·트리거(계약-서버계산.md 2-1)와 같은 선에서 막는지 — 서비스 규칙을 우회해 직접 저장소를 건드려 본다.
 */
import { describe, expect, it } from 'vitest'
import { RepoError } from '../repository'
import { MON, TUE, alice, bob, boss, dayHeader, setup, siteEntry, unwrap } from './fixtures'

/** 던져진 RepoError 의 코드 (안 던지면 null) */
function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return e instanceof RepoError ? e.code : `not-RepoError: ${String(e)}`
  }
}

function approvedClaim() {
  const s = setup()
  const c = unwrap(s.service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
  const sent = unwrap(s.service.submit(alice, c.id, c.version))
  const calcs = s.service.latestCalcs(sent.id)
  unwrap(s.service.review(boss, sent.id, { action: 'approve', expectedCalcIds: calcs.map((x) => x.id) }))
  return { ...s, claimId: sent.id, day: s.repo.listDays(sent.id)[0], calcs }
}

describe('저장소 수준 잠금·정합성 (서비스를 우회해도 막힌다)', () => {
  it('승인된 신청의 근무일은 수정·삭제할 수 없다 (LOCKED)', () => {
    const { repo, day } = approvedClaim()
    expect(codeOf(() => repo.updateDay(day.id, day.revision, siteEntry(MON, '06:00', '17:00')))).toBe('LOCKED')
    expect(codeOf(() => repo.deleteDay(day.id))).toBe('LOCKED')
    expect(repo.listDays(day.claimId)[0].entry.site?.start).toBe('08:00')
  })

  it('반려·취소된 신청도 잠긴다', () => {
    const s = setup()
    const c = unwrap(s.service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    unwrap(s.service.cancel(alice, c.id, c.version))
    const day = s.repo.listDays(c.id)[0]
    expect(codeOf(() => s.repo.updateDay(day.id, day.revision, siteEntry(MON, '06:00', '17:00')))).toBe('LOCKED')
  })

  it('검토 기록의 calcIds 는 전부 그 신청의 계산 결과여야 한다 (REVIEW_CALC_MISMATCH)', () => {
    const s = setup()
    const a = unwrap(s.service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const b = unwrap(s.service.createClaim(bob, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const bCalc = s.service.latestCalcs(b.id)[0]
    expect(codeOf(() => s.repo.insertReview({ id: 'r-x', claimId: a.id, adminId: boss.id, action: 'approve', calcIds: [bCalc.id], flagDecisions: [], at: 'x' })))
      .toBe('REVIEW_CALC_MISMATCH')
    expect(codeOf(() => s.repo.insertReview({ id: 'r-y', claimId: a.id, adminId: boss.id, action: 'approve', calcIds: ['calc-없음'], flagDecisions: [], at: 'x' })))
      .toBe('REVIEW_CALC_MISMATCH')
    expect(s.repo.listReviews(a.id)).toEqual([])
  })

  it('계산 결과는 그 신청의 근무일·현재 입력 판에만 붙는다 (CALC_DAY_MISMATCH / CALC_STALE_OR_UNTRUSTED)', () => {
    const s = setup()
    const a = unwrap(s.service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const b = unwrap(s.service.createClaim(bob, { header: dayHeader(['대전'], TUE), entries: [siteEntry(TUE, '08:00', '17:00')] }))
    const aCalc = s.service.latestCalcs(a.id)[0]
    const bDay = s.repo.listDays(b.id)[0]
    expect(codeOf(() => s.repo.insertCalc({ ...aCalc, id: 'calc-x', dayId: bDay.id }))).toBe('CALC_DAY_MISMATCH') // 다른 신청의 근무일에 끼워 넣기
    const aDay = s.repo.listDays(a.id)[0]
    expect(codeOf(() => s.repo.insertCalc({ ...aCalc, id: 'calc-y', dayRevision: aDay.revision + 1 }))).toBe('CALC_STALE_OR_UNTRUSTED') // 오래된 입력 판
    expect(codeOf(() => s.repo.insertCalc({ ...aCalc }))).toBe('IMMUTABLE') // 덮어쓰기
    expect(s.service.latestCalcs(a.id)[0].id).toBe(aCalc.id)
  })

  it('승인된 계산 결과는 승인 뒤에도 그대로 남고, 승인 기록이 그 id 를 가리킨다', () => {
    const { repo, claimId, calcs } = approvedClaim()
    const review = repo.listReviews(claimId)[0]
    expect(review.calcIds).toEqual(calcs.map((c) => c.id))
    for (const id of review.calcIds) expect(repo.getCalc(id)).toEqual(calcs.find((c) => c.id === id))
    expect(Object.isFrozen(repo.getCalc(review.calcIds[0]))).toBe(true)
  })
})

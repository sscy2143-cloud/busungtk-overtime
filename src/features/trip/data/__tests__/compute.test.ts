import { describe, expect, it } from 'vitest'
import { NO_CALENDAR, dayKindOf, eachDate, isVerifiedCalendar, weekStartOf } from '../calendar'
import { classifyDay } from '../classify'
import { computeClaimDays } from '../compute'
import { MAX_STAY_DAYS, reviewItems } from '../service'
import type { DayEntry, TripDayRecord } from '../types'
import { MON, TEST_CALENDAR, TUE, WED, alice, dayHeader, setup, siteEntry, stayHeader, unwrap } from './fixtures'

const day = (date: string, entry: DayEntry, i = 1): TripDayRecord => ({ id: `day-${date}`, claimId: 'c', employeeId: alice.id, date, entry, revision: i })
const overnight = siteEntry(MON, '21:00', '11:00', { site: { start: '21:00', end: '11:00', endNextDay: true }, breaks: [{ start: '02:00', end: '03:00', startNextDay: true, endNextDay: true }] })
const compute = (days: TripDayRecord[], extra: Partial<Parameters<typeof computeClaimDays>[0]> = {}) =>
  computeClaimDays({ header: stayHeader(['대전'], MON, WED), employeeId: alice.id, days, calendar: TEST_CALENDAR, ...extra })
const codes = (d: { classification: { notices: { code: string }[] } }) => d.classification.notices.map((n) => n.code)

describe('다음 날로 넘어간 작업 ↔ 다음 날 입력 대조 (누락·겹침·빈틈)', () => {
  it('넘어온 작업(09~11)을 다음 날이 09시부터 입력하면 표시 없음', () => {
    const [mon, tue] = compute([day(MON, overnight), day(TUE, siteEntry(TUE, '09:00', '11:00'))])
    expect(mon.carryOut).toMatchObject({ toDate: TUE, work: { start: 33, end: 35 }, linkedDayId: `day-${TUE}` })
    expect(codes(tue)).toEqual([])
  })

  it('다음 날에 현장 입력이 없으면 CARRY_IN_NOT_ENTERED — 관리자 확인 항목', () => {
    const [, tue] = compute([day(MON, overnight), day(TUE, { date: TUE, noSiteWork: { reason: '이동만' }, travelStarts: { back: '12:00' } })])
    expect(codes(tue)).toContain('CARRY_IN_NOT_ENTERED')
  })

  it('다음 날 현장을 08시부터 입력하면 08~09가 전날과 겹침 → CARRY_IN_OVERLAP', () => {
    const [, tue] = compute([day(MON, overnight), day(TUE, siteEntry(TUE, '08:00', '11:00'))])
    expect(codes(tue)).toContain('CARRY_IN_OVERLAP')
    expect(tue.classification.notices.find((n) => n.code === 'CARRY_IN_OVERLAP')?.message).toContain('08:00~09:00')
  })

  it('다음 날 현장을 10시부터 입력하면 09~10이 빈틈 → CARRY_IN_GAP', () => {
    const [, tue] = compute([day(MON, overnight), day(TUE, siteEntry(TUE, '10:00', '11:00'))])
    expect(codes(tue)).toContain('CARRY_IN_GAP')
  })

  it('대조 표시는 전부 관리자 확인 항목이고, 승인 전에 처리해야 한다', () => {
    const { service } = setup()
    const c = unwrap(service.createClaim(alice, { header: stayHeader(['대전'], MON, TUE), entries: [overnight, siteEntry(TUE, '08:00', '11:00')] }))
    const [, tue] = service.latestCalcs(c.id)
    expect(reviewItems(tue)).toContain('CARRY_IN_OVERLAP')
  })

  it('다음 날 기록이 다른 진행 중 신청에 있으면 그쪽에 연결한다', () => {
    const other = day(TUE, siteEntry(TUE, '09:00', '11:00'))
    const [mon] = compute([day(MON, overnight)], { findActiveDay: (_e, d) => (d === TUE ? other : undefined) })
    expect(mon.carryOut?.linkedDayId).toBe(other.id)
    expect(codes(mon)).not.toContain('NEXT_DAY_ENTRY_MISSING')
  })
})

describe('같은 날 다른 신청 (기존 야근 등) — 5-8 중복 지급 금지', () => {
  it('조회 함수가 다른 신청을 돌려주면 관리자 확인 항목이 붙는다', () => {
    const { service } = setup({ otherRequestLookup: (_e, d) => (d === MON ? ['야근 18:00~21:00 (승인)'] : []) })
    const c = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const [calc] = service.latestCalcs(c.id)
    expect(reviewItems(calc)).toContain('OTHER_REQUEST_SAME_DAY')
    expect(calc.classification.notices.find((n) => n.code === 'OTHER_REQUEST_SAME_DAY')?.message).toContain('야근 18:00~21:00')
    expect(calc.result?.ok && calc.result.trip.hours).toBe(4) // 계산값은 바꾸지 않는다
  })

  it('조회 함수가 없거나 비어 있으면 표시 없음', () => {
    const { service } = setup()
    const c = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    expect(reviewItems(service.latestCalcs(c.id)[0])).toEqual([])
  })
})

describe('숙박 기간 상한 (임시 방어, 회사 규정 아님)', () => {
  it(`${MAX_STAY_DAYS}일까지 허용, 넘으면 INVALID_DATE`, () => {
    const { service } = setup()
    const okEnd = eachDate(MON, '2026-12-31')[MAX_STAY_DAYS - 1]
    const tooFar = eachDate(MON, '2026-12-31')[MAX_STAY_DAYS]
    expect(service.createClaim(alice, { header: stayHeader(['대전'], MON, okEnd), entries: [siteEntry(MON, '08:00', '17:00')] }).ok).toBe(true)
    expect(service.createClaim(alice, { header: stayHeader(['대전'], '2027-01-01', tooFar), entries: [siteEntry('2027-01-01', '08:00', '17:00')] }))
      .toMatchObject({ ok: false, code: 'INVALID_DATE' })
  })
})

describe('공휴일 달력 출처', () => {
  it('verified 라도 출처가 없으면 미검증으로 본다', () => {
    expect(isVerifiedCalendar(TEST_CALENDAR)).toBe(true)
    expect(isVerifiedCalendar(NO_CALENDAR)).toBe(false)
    expect(isVerifiedCalendar({ holidays: new Set(), verified: true, source: '' })).toBe(false)
    expect(isVerifiedCalendar({ holidays: new Set(), verified: true, source: 'none' })).toBe(false)
    const c = classifyDay(dayHeader(['대전']), siteEntry(MON, '08:00', '17:00'), { calendar: { holidays: new Set(), verified: true, source: ' ' } })
    expect(c.notices.map((n) => n.code)).toContain('HOLIDAY_SOURCE_UNVERIFIED')
  })
})

describe('실제 도착 다음 날 표시', () => {
  it('arriveNextDay 면 도착 시각이 24시간 뒤로 기록된다 (계산에는 영향 없음)', () => {
    const base = siteEntry(MON, '14:00', '20:00')
    const a = classifyDay(dayHeader(['부산']), { ...base, actual: { departAt: '08:00', arriveAt: '01:00', arriveNextDay: true, source: 'self' } }, { calendar: TEST_CALENDAR })
    const b = classifyDay(dayHeader(['부산']), { ...base, actual: { departAt: '08:00', arriveAt: '01:00', source: 'self' } }, { calendar: TEST_CALENDAR })
    expect(a.input?.actualRecord).toEqual({ departAt: 8, arriveAt: 25 })
    expect(b.input?.actualRecord).toEqual({ departAt: 8, arriveAt: 1 })
    const plain = classifyDay(dayHeader(['부산']), base, { calendar: TEST_CALENDAR })
    const strip = (i: typeof a.input) => { const { actualRecord, ...rest } = i!; void actualRecord; return rest }
    expect(strip(a.input)).toEqual(strip(plain.input))
  })
})

describe('날짜 경계', () => {
  it('연말을 넘는 숙박 출장, 일요일의 주 시작, 24:00 종료, 다음 날 09:00 정각', () => {
    const { service } = setup()
    const c = unwrap(service.createClaim(alice, {
      header: stayHeader(['부산'], '2026-12-31', '2027-01-02'),
      entries: [siteEntry('2026-12-31', '13:00', '18:00'), siteEntry('2027-01-01', '08:00', '17:00'), siteEntry('2027-01-02', '08:00', '12:00')],
    }))
    const calcs = service.latestCalcs(c.id)
    expect(calcs.map((x) => x.classification.workType)).toEqual(['stay_outbound', 'stay_middle', 'stay_return'])
    expect(calcs[1].classification.dayKind).toBe('weekday') // 2027-01-01 은 금요일. 공휴일은 달력이 말해 줘야 한다
    expect(weekStartOf('2027-01-03')).toBe('2026-12-28') // 일요일 → 그 주 월요일
    expect(dayKindOf('2027-01-03', new Set())).toBe('holiday')

    const midnight = classifyDay(dayHeader(['대전']), siteEntry(MON, '16:00', '24:00'), { calendar: TEST_CALENDAR })
    expect(midnight.input?.site).toEqual({ start: 16, end: 24 })
    expect(midnight.notices).toEqual([])

    const exactly9 = classifyDay(dayHeader(['대전']), siteEntry(MON, '21:00', '09:00', { site: { start: '21:00', end: '09:00', endNextDay: true } }), { calendar: TEST_CALENDAR })
    expect(exactly9.notices.map((n) => n.code)).not.toContain('NEXT_DAY_SPLIT') // 09시 정각까지는 전날 근무 (5-4)
    const past9 = classifyDay(dayHeader(['대전']), siteEntry(MON, '21:00', '09:01', { site: { start: '21:00', end: '09:01', endNextDay: true } }), { calendar: TEST_CALENDAR })
    expect(past9.notices.map((n) => n.code)).toContain('NEXT_DAY_SPLIT')
  })
})

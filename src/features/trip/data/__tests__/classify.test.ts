import { describe, expect, it } from 'vitest'
import { calculateTripDay, type TripDayResult } from '../../engine'
import { addDays, dayKindOf, eachDate, isIsoDate, weekStartOf } from '../calendar'
import { classifyDay } from '../classify'
import { parseClock, toHourRange } from '../time-input'
import type { ClaimHeader, DayEntry } from '../types'
import { HOLIDAY, MON, SAT, TUE, WED, dayHeader, siteEntry, stayHeader } from './fixtures'

const opts = { holidays: new Set([HOLIDAY]) }
const calc = (h: ClaimHeader, e: DayEntry): TripDayResult => {
  const c = classifyDay(h, e, opts)
  if (!c.input) throw new Error(`입력 부족: ${c.missing.join(',')}`)
  const r = calculateTripDay(c.input)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r
}

describe('날짜·시각 변환', () => {
  it('요일과 날짜 구분 (토요일·일요일·공휴일)', () => {
    expect(dayKindOf(MON, opts.holidays)).toBe('weekday')
    expect(dayKindOf(SAT, opts.holidays)).toBe('saturday')
    expect(dayKindOf('2026-11-08', opts.holidays)).toBe('holiday')
    expect(dayKindOf(HOLIDAY, opts.holidays)).toBe('holiday')
    expect(dayKindOf(SAT, new Set([SAT]))).toBe('holiday') // 토요일 공휴일 → 휴일
  })

  it('날짜 계산과 주 시작(월요일)', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(eachDate(MON, WED)).toEqual([MON, TUE, WED])
    expect(weekStartOf('2026-11-08')).toBe(MON)
    expect(weekStartOf(MON)).toBe(MON)
    expect(isIsoDate('2026-02-30')).toBe(false)
  })

  it('HH:MM 변환, 종료가 이르면 다음 날로 보고 안내', () => {
    expect(parseClock('07:30')).toBe(7.5)
    expect(parseClock('24:00')).toBe(24)
    expect(parseClock('24:30')).toBeNull()
    expect(parseClock('7시')).toBeNull()
    const notices: { code: string; message: string }[] = []
    expect(toHourRange({ start: '22:00', end: '03:00' }, '현장', notices)).toEqual({ start: 22, end: 27 })
    expect(notices.map((n) => n.code)).toEqual(['AUTO_NEXT_DAY'])
    expect(toHourRange({ start: '01:00', end: '05:00', startNextDay: true, endNextDay: true }, '현장', [])).toEqual({ start: 25, end: 29 })
  })
})

describe('근무 유형 자동 분류 — 직원은 유형을 고르지 않는다', () => {
  it('기본 입력(지역·현장 시각)만으로 당일 출장 — 팀장님 기준 사례 4시간', () => {
    const c = classifyDay(dayHeader(['대전']), siteEntry(MON, '08:00', '17:00'), opts)
    expect(c.workType).toBe('day_trip')
    expect(c.missing).toEqual([])
    expect(c.input?.lunchTaken).toBe(true) // 점심 기본값 "사용"
    expect(calc(dayHeader(['대전']), siteEntry(MON, '08:00', '17:00')).trip.hours).toBe(4)
  })

  it('숙박 출장: 첫날 ③, 중간일 ⑦(E5 제안), 마지막 날 ④', () => {
    const h = stayHeader(['대전'], MON, WED)
    expect([MON, TUE, WED].map((d) => classifyDay(h, siteEntry(d, '08:00', '17:00'), opts).workType))
      .toEqual(['stay_outbound', 'stay_middle', 'stay_return'])
    expect(calc(h, siteEntry(TUE, '08:00', '19:00')).proposedBy).toEqual(['E5'])
  })

  it('지역이 모두 제외 지역이면 ① 제외 지역 현장 (8번)', () => {
    const c = classifyDay(dayHeader(['경기:수원']), siteEntry(MON, '08:00', '19:00'), opts)
    expect(c.workType).toBe('excluded_site')
    expect(calc(dayHeader(['경기:수원']), siteEntry(MON, '08:00', '19:00')).overtime.hours).toBe(2)
  })

  it('사무실 근무 + 현장 → ⑤. 출발 시각을 비우면 추가 입력 없이 E4 제안값 (16번과 같은 시간)', () => {
    const e = siteEntry(MON, '21:00', '02:00', { office: { start: '09:00', end: '18:00' } })
    const c = classifyDay(dayHeader(['대전']), e, opts)
    expect(c.workType).toBe('office_then_depart')
    expect(c.missing).toEqual([])
    const r = calc(dayHeader(['대전']), e)
    expect([r.trip.hours, r.trip.nightTravelHours, r.overtime.hours, r.overtime.nightHours]).toEqual([4, 2, 5, 4])
    expect(r.proposedBy).toEqual(['E4'])
  })

  it('⑤에서 출발 시각을 넣으면 최종본 16번 그대로 확정값', () => {
    const e = siteEntry(MON, '21:00', '02:00', { office: { start: '09:00', end: '18:00' }, travelStarts: { out: '19:00', back: '02:00' } })
    const c = classifyDay(dayHeader(['대전']), e, opts)
    expect(c.input?.legs).toEqual([{ direction: 'out', start: 19 }, { direction: 'back', start: 26 }])
    expect(calc(dayHeader(['대전']), e).status).toBe('confirmed')
  })

  it('현장 작업 없음 → ⑥. 기준 시각이 없으니 출발 시각과 사유를 묻는다', () => {
    const c = classifyDay(dayHeader(['부산']), { date: MON, noSiteWork: { reason: '' } }, opts)
    expect(c.workType).toBe('travel_only')
    expect(c.input).toBeNull()
    expect(c.missing).toEqual(['noSiteWork.reason', 'travelStarts.out', 'travelStarts.back'])
  })

  it('숙박 마지막 날 이동 후 사무실 정리 (11번) → ⑥, 0시간 확정', () => {
    const h = stayHeader(['부산'], '2026-11-01', MON)
    const e: DayEntry = { date: MON, office: { start: '14:00', end: '16:00' }, travelStarts: { back: '10:00' }, earlyLeaveDirected: true }
    expect(classifyDay(h, e, opts).workType).toBe('travel_only')
    const r = calc(h, e)
    expect(r.trip.hours + r.overtime.hours).toBe(0)
    expect(r.status).toBe('confirmed')
  })

  it('현장 시각이 없으면 그 항목만 묻는다', () => {
    expect(classifyDay(dayHeader(['대전']), { date: MON }, opts).missing).toEqual(['site'])
  })

  it('제주는 실제 이동 시각과 증빙을 반드시 묻는다 (E6)', () => {
    expect(classifyDay(dayHeader(['제주']), siteEntry(MON, '14:00', '20:00'), opts).missing).toEqual(['jeju.legs', 'jeju.evidence'])
    const e = siteEntry(MON, '14:00', '20:00', { jeju: { legs: [{ start: '07:00', end: '13:00' }], evidenceFileIds: ['f1'] } })
    expect(calc(dayHeader(['제주']), e).overtime.hours).toBe(4)
  })

  it('토요일·공휴일은 날짜로 자동 판정, 토요일 주 결근·연차는 시스템 조회값으로 표시', () => {
    expect(classifyDay(dayHeader(['대전'], HOLIDAY), siteEntry(HOLIDAY, '08:00', '17:00'), opts).dayKind).toBe('holiday')
    const c = classifyDay(dayHeader(['대전'], SAT), siteEntry(SAT, '08:00', '17:00'), { ...opts, weekHasAbsenceOrLeave: true })
    expect(c.dayKind).toBe('saturday')
    expect(c.input?.weekHasAbsenceOrLeave).toBe(true)
  })

  it('다음 날 09시를 넘긴 작업은 안내를 남긴다 (E7)', () => {
    const c = classifyDay(dayHeader(['대전']), siteEntry(MON, '21:00', '11:00', { site: { start: '21:00', end: '11:00', endNextDay: true } }), opts)
    expect(c.notices.map((n) => n.code)).toContain('NEXT_DAY_SPLIT')
  })

  it('일정 밖 날짜, 잘못된 시각 형식', () => {
    expect(classifyDay(dayHeader(['대전']), siteEntry(TUE, '08:00', '17:00'), opts).notices[0].code).toBe('DATE_OUT_OF_SCHEDULE')
    const bad = classifyDay(dayHeader(['대전']), siteEntry(MON, '8시', '17:00'), opts)
    expect(bad.missing).toEqual(['site'])
    expect(bad.notices.map((n) => n.code)).toContain('INVALID_TIME')
  })

  it('실제 출발·도착 기록은 계산 결과를 바꾸지 않는다', () => {
    const base = siteEntry(MON, '10:00', '16:00')
    const withActual = { ...base, actual: { departAt: '07:00', arriveAt: '19:00', source: 'self' as const } }
    const a = calc(dayHeader(['충남']), base)
    const b = calc(dayHeader(['충남']), withActual)
    expect(b).toEqual(a)
    expect(b.trip.hours).toBe(1)
  })
})

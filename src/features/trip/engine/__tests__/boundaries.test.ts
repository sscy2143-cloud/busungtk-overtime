import { describe, expect, it } from 'vitest'
import { REGIONS } from '../regions'
import type { TripDayInput } from '../types'
import { FINAL_CASES } from './final-cases.fixture'
import { base, codes, hoursOf, run, runError } from './helpers'

const finalCase = (no: number) => FINAL_CASES.find((c) => c.no === no)!.input
const dayTrip = (region: string, start: number, end: number, lunchTaken = true): TripDayInput => ({
  ...base, lunchTaken, workType: 'day_trip', regions: [region], site: { start, end },
})

describe('지역별 표준 편도시간 (2절)', () => {
  it('경기도는 남부 21개 시·군이 제외 지역, 북부 10개 시·군이 1시간', () => {
    const gg = Object.entries(REGIONS).filter(([id]) => id.startsWith('경기:'))
    expect(gg.filter(([, r]) => r.kind === 'excluded')).toHaveLength(21)
    expect(gg.filter(([, r]) => r.kind === 'standard' && r.oneWayHours === 1)).toHaveLength(10)
  })

  it.each([
    ['충북', 1], ['충남', 2], ['세종', 2], ['대전', 2], ['강원', 2], ['전북', 2],
    ['경북', 3], ['대구', 3], ['광주광역시', 3], ['전남', 3], ['경남', 4], ['울산', 4], ['부산', 4],
  ] as const)('%s 편도 %i시간', (id, hours) => {
    expect(REGIONS[id]).toEqual({ kind: 'standard', oneWayHours: hours })
  })

  it('경기 광주시(제외)와 광주광역시(3시간)를 구분한다', () => {
    expect(codes(runError(dayTrip('경기:광주', 8, 17)))).toEqual(['REGION_TYPE_MISMATCH'])
    expect(run(dayTrip('광주광역시', 8, 17)).trip.hours).toBe(6)
  })

  it('실제 출발·도착 시각은 계산에 쓰지 않는다 (14·19번)', () => {
    for (const no of [14, 19]) {
      const { actualRecord, ...withoutActual } = finalCase(no)
      expect(actualRecord).toBeDefined()
      expect(run(finalCase(no))).toEqual(run(withoutActual))
    }
  })
})

describe('날짜 변경 (5-4)', () => {
  it('작업 20~03: 다음 날 09시 전이므로 전날 근무, 복귀 03~05 야간 이동 2', () => {
    const r = run(dayTrip('대전', 20, 27, false))
    expect(hoursOf(r)).toEqual({ trip: 3, nightTravel: 2, overtime: 0, nightOvertime: 0 })
    expect(r.actualNight.workHours).toBe(5)
    expect(r.requiresLegalReview).toContain('E2')
    expect(r.status).toBe('confirmed')
  })

  it('복귀 이동이 다음 날 09시를 넘으면 09시 이후분은 다음 날 정규근무', () => {
    const r = run(dayTrip('대전', 20, 32, false))
    expect(r.trace.travel).toEqual([{ start: 18, end: 20 }, { start: 32, end: 33 }])
    expect(hoursOf(r)).toEqual({ trip: 3, nightTravel: 0, overtime: 4, nightOvertime: 4 })
    // 09시 이후 1시간은 버리지 않고 다음 근무일 기록으로 넘긴다
    expect(r.nextDayTravel).toEqual([{ start: 33, end: 34 }])
    // 야간 연장 배분(N1)만 미확정이므로 나머지 값은 확정
    expect(r.valueStatus).toEqual({ trip: 'confirmed', nightTravel: 'confirmed', overtime: 'confirmed', nightOvertime: 'proposed' })
  })

  it('작업이 정확히 다음 날 09시에 끝나면 나누지 않는다 (E7 아님)', () => {
    const r = run(dayTrip('대전', 20, 33, false))
    expect(r.nextDay).toBeUndefined()
    expect(r.nextDayTravel).toEqual([{ start: 33, end: 35 }])
    expect(r.proposedBy).not.toContain('E7')
    expect(r.trip.hours).toBe(2)
  })

  it('다음 날 09시 이후에 시작한 작업은 다음 근무일로 입력해야 한다', () => {
    expect(codes(runError(dayTrip('대전', 33, 36)))).toEqual(['INVALID_RANGE'])
  })
})

describe('휴게시간', () => {
  it('점심을 못 쓴 날은 현장조정 +1 (4절)', () => {
    const r = run(dayTrip('대전', 8, 17, false))
    expect(hoursOf(r)).toEqual({ trip: 4, nightTravel: 0, overtime: 1, nightOvertime: 0 })
  })

  it('점심 외 휴게는 근무에서 빼고 표시한다', () => {
    const r = run({ ...dayTrip('대전', 7, 17), breaks: [{ start: 15, end: 16 }] })
    expect(hoursOf(r)).toEqual({ trip: 4, nightTravel: 1, overtime: 0, nightOvertime: 0 })
    expect(codes(r)).toContain('BREAK_DEDUCTED')
  })

  it('5-3에서 점심이 이동 중이면 빼지 않고 N2 제안값으로 표시한다', () => {
    const r = run({
      ...base, workType: 'office_then_depart', regions: ['대전'],
      office: { start: 7, end: 11 }, legs: [{ direction: 'out', start: 11 }], site: { start: 13, end: 19 },
    })
    expect(r.legal.totalWorkHours).toBe(12)
    expect(r.proposedBy).toContain('N2')
  })
})

describe('야간근로', () => {
  it('제외 지역 14~24(점심 없음): 연장 2 중 야간이 몇 시간인지 규정이 없어 N1 제안값', () => {
    const r = run({ ...base, lunchTaken: false, workType: 'excluded_site', regions: ['경기:수원'], site: { start: 14, end: 24 } })
    expect(r.overtime.hours).toBe(2)
    expect(r.overtime.nightHours).toBe(2)
    expect(r.actualNight.workHours).toBe(2)
    expect(r.proposedBy).toEqual(['N1'])
  })

  it('16번: 연장 작업이 전부 09~18 밖이면 야간 연장은 규정대로 확정', () => {
    const r = run(finalCase(16))
    expect(r.overtime.nightHours).toBe(4)
    expect(r.proposedBy).toEqual([])
  })

  it('이동이 22시에 끝나거나 06시에 시작하면 야간 이동이 아니다', () => {
    expect(run(finalCase(19)).trip.nightTravelHours).toBe(0) // 복귀 20~22
    expect(run(finalCase(1)).trip.nightTravelHours).toBe(0) // 출발 06~08
  })
})

describe('중복시간 (5-8)', () => {
  it('사무실 근무와 이동이 겹치면 오류', () => {
    const r = runError({
      ...base, workType: 'office_then_depart', regions: ['대전'], office: { start: 9, end: 18 },
      legs: [{ direction: 'out', start: 17 }], site: { start: 19, end: 22 },
    })
    expect(codes(r)).toEqual(['OVERLAP'])
  })

  it('휴게끼리 겹치면 오류', () => {
    expect(codes(runError({ ...dayTrip('대전', 7, 20), breaks: [{ start: 14, end: 16 }, { start: 15, end: 17 }] })))
      .toEqual(['OVERLAP'])
  })

  it('끝과 시작이 맞닿는 것은 겹침이 아니다 (16번 이동 19~21, 작업 21~)', () => {
    expect(run(finalCase(16)).ok).toBe(true)
  })
})

describe('여러 지역·제외 지역 (5-8, 5-1)', () => {
  it('대전 → 부산: 첫 지역 2 + 마지막 지역 4', () => {
    const r = run({ ...dayTrip('대전', 7, 20), regions: ['대전', '부산'] })
    expect(hoursOf(r)).toEqual({ trip: 6, nightTravel: 3, overtime: 4, nightOvertime: 0 })
  })

  it('첫 지역이 제외 지역이면 가는 시간 0', () => {
    expect(run({ ...dayTrip('대전', 8, 17), regions: ['경기:수원', '대전'] }).trip.hours).toBe(2)
  })

  it('제외 지역 현장은 회사 지시 집결 시각부터 근무', () => {
    const r = run({ ...base, workType: 'excluded_site', regions: ['경기:수원'], assemblyAt: 7, site: { start: 8, end: 17 } })
    expect(r.overtime.hours).toBe(1)
    expect(r.trip.hours).toBe(0)
  })

  it('출장 유형에 제외 지역만 넣거나, 제외 지역 유형에 출장 지역을 넣으면 오류', () => {
    expect(codes(runError(dayTrip('서울', 8, 17)))).toEqual(['REGION_TYPE_MISMATCH'])
    expect(codes(runError({ ...base, workType: 'excluded_site', regions: ['대전'], site: { start: 8, end: 17 } })))
      .toEqual(['REGION_TYPE_MISMATCH'])
    expect(codes(runError(dayTrip('평양', 8, 17)))).toEqual(['REGION_UNKNOWN'])
  })
})

describe('토요일·일요일·공휴일 (5-6)', () => {
  it('토요일: 이동은 전부 출장, 작업은 전부 연장 (8시간 차감 없음)', () => {
    const r = run({ ...finalCase(1), dayKind: 'saturday', weekHasAbsenceOrLeave: true })
    expect(hoursOf(r)).toEqual({ trip: 4, nightTravel: 0, overtime: 8, nightOvertime: 0 })
    expect(codes(r)).toContain('SATURDAY_WEEK_ABSENCE')
    expect(r.status).toBe('confirmed')
  })

  it('일요일·공휴일: 출장·연장 대신 휴일근로(8시간 이내/초과), 담당자 확인', () => {
    const r = run({ ...finalCase(1), dayKind: 'holiday' })
    expect(hoursOf(r)).toEqual({ trip: 0, nightTravel: 0, overtime: 0, nightOvertime: 0 })
    expect(r.holiday).toEqual({ within8Hours: 8, over8Hours: 4 })
    expect(codes(r)).toContain('HOLIDAY_REVIEW')
  })
})

describe('그 밖의 규정', () => {
  it('회사 지시 경유·지연은 증빙이 있을 때만 연장으로 인정 (5-8)', () => {
    const withEvidence = run({ ...finalCase(1), delay: { hours: 1, evidenceAttached: true } })
    expect(withEvidence.overtime.hours).toBe(1)
    expect(codes(withEvidence)).toContain('DELAY_REVIEW')
    const without = run({ ...finalCase(1), delay: { hours: 1, evidenceAttached: false } })
    expect(without.overtime.hours).toBe(0)
    expect(codes(without)).toContain('DELAY_NO_EVIDENCE')
  })

  it('회사 지시 조기 퇴근은 계산을 바꾸지 않는다 (5-5)', () => {
    expect(run({ ...finalCase(5), earlyLeaveDirected: true })).toEqual(run(finalCase(5)))
  })

  it('작업 없는 이동일에 이동이 없거나, 현장 없이 이동 시각도 없으면 오류', () => {
    expect(codes(runError({ ...base, workType: 'travel_only', regions: ['부산'] }))).toEqual(['TRAVEL_REQUIRED'])
    expect(codes(runError({ ...base, workType: 'travel_only', regions: ['부산'], legs: [{ direction: 'back' }] })))
      .toEqual(['TRAVEL_START_REQUIRED'])
  })

  it('잘못된 시각 범위는 오류', () => {
    expect(codes(runError(dayTrip('대전', 17, 8)))).toEqual(['INVALID_RANGE'])
  })
})

describe('T1 점검에서 찾은 구현 오류 (수정 후 회귀 방지)', () => {
  it('점심과 겹치는 휴게를 두 번 빼지 않는다 — 당일 출장', () => {
    // 수정 전: 휴게 12:30~13:30 을 1시간 통째로 빼서 연장 0. 점심과 겹치는 30분은 이미 점심으로 뺐다
    const r = run({ ...dayTrip('대전', 7, 17), breaks: [{ start: 12.5, end: 13.5 }] })
    expect(r.overtime.hours).toBe(0.5)
    expect(r.legal.totalWorkHours).toBe(12.5)
  })

  it('점심과 겹치는 휴게를 두 번 빼지 않는다 — 제외 지역 (8번에 점심을 휴게로도 적은 경우)', () => {
    // 수정 전: 근무 9시간, 연장 1 → 8번 기대값(연장 2)과 달라짐
    const r = run({ ...finalCase(8), breaks: [{ start: 12, end: 13 }] })
    expect(r.overtime.hours).toBe(2)
  })

  it('계산식이 쓰지 않는 입력은 조용히 버리지 않고 오류로 알린다', () => {
    // 수정 전: 당일 출장에 넣은 사무실 09~18 근무 8시간이 결과에서 사라짐
    expect(codes(runError({ ...dayTrip('대전', 19, 23), office: { start: 9, end: 18 } }))).toEqual(['FIELD_NOT_APPLICABLE'])
    expect(codes(runError({ ...dayTrip('대전', 10, 16), directedWaits: [{ start: 16, end: 19 }] }))).toEqual(['FIELD_NOT_APPLICABLE'])
    expect(codes(runError({ ...dayTrip('대전', 10, 16), legs: [{ direction: 'out', start: 8 }] }))).toEqual(['FIELD_NOT_APPLICABLE'])
    expect(codes(runError({ ...dayTrip('대전', 10, 16), assemblyAt: 8 }))).toEqual(['FIELD_NOT_APPLICABLE'])
  })
})

describe('T1 점검 2차: 무작위 테스트가 찾은 오류', () => {
  it('토요일에 점심을 썼는데 작업 구간에 12~13시가 없어도 야간 연장이 연장보다 크지 않다', () => {
    // 수정 전: 연장 1.5, 야간 연장 2 (연장은 점심 1시간을 뺐는데 야간은 빼지 않은 작업 구간으로 셈)
    const r = run({ ...dayTrip('대전', 21.5, 24), dayKind: 'saturday' })
    expect(r.overtime.hours).toBe(1.5)
    expect(r.overtime.nightHours).toBeLessThanOrEqual(1.5)
    // 어느 1시간이 점심이었는지 모르므로 야간 배분은 N1 제안값
    expect(r.proposedBy).toEqual(['N1'])
  })
})

describe('점심 차감 판정 (T1 최종 점검)', () => {
  it('4절: 점심을 썼다고 하면 그 시각이 이동 중이어도 1시간을 뺀다 — 최종본 식의 결과 (구현 오류 아님)', () => {
    // 대전 현장 14~20: 현장조정 = (9 − 14) + (20 − 18) = −3. 식에 점심 1시간이 이미 들어 있음 (9~18 = 9시간 − 점심 1)
    const r = run(dayTrip('대전', 14, 20))
    expect(r.trace.adjustmentHours).toBe(-3)
    expect(hoursOf(r)).toEqual({ trip: 1, nightTravel: 0, overtime: 0, nightOvertime: 0 })
    expect(r.status).toBe('confirmed')
  })

  it('5-3: 같은 상황(점심이 이동 중)은 최종본에 규정이 없어 빼지 않고 N2 제안값 — 4절과 다름을 기록', () => {
    const r = run({
      ...base, workType: 'office_then_depart', regions: ['대전'],
      office: { start: 7, end: 11 }, legs: [{ direction: 'out', start: 11 }], site: { start: 13, end: 19 },
    })
    expect(r.legal.totalWorkHours).toBe(12) // 점심 미차감
    expect(r.proposedBy).toContain('N2')
    expect(r.valueStatus.trip).toBe('proposed')
  })
})

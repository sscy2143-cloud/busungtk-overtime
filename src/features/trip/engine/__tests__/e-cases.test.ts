import { describe, expect, it } from 'vitest'
import { RULES } from '../rules'
import type { TripDayInput } from '../types'
import { checkWeek } from '../weekly'
import { FINAL_CASES } from './final-cases.fixture'
import { base, codes, hoursOf, run, runError } from './helpers'

const finalCase = (no: number) => FINAL_CASES.find((c) => c.no === no)!.input

describe('E1 검증식 0 하한 (채택)', () => {
  it.each([7, 15])('%i번: 일한 시간이 8시간 미만이어도 검증 오류가 나지 않는다', (no) => {
    const r = run(finalCase(no))
    expect(r.trip.hours + r.overtime.hours).toBe(0)
    expect(r.legal.dailyOver8Hours).toBe(0)
  })
})

describe('E2 연장이 아닌 야간 근로 (기록만)', () => {
  it('대전 당일 15~23(점심 없음): 연장 0이지만 실제 야간 근로 1시간을 따로 기록한다', () => {
    const r = run({ ...base, lunchTaken: false, workType: 'day_trip', regions: ['대전'], site: { start: 15, end: 23 } })
    expect(hoursOf(r)).toEqual({ trip: 4, nightTravel: 2, overtime: 0, nightOvertime: 0 })
    expect(r.actualNight.workHours).toBe(1)
    expect(r.requiresLegalReview).toContain('E2')
    // 기록만 하므로 회사 인정값은 제안값이 아니다
    expect(r.status).toBe('confirmed')
  })
})

describe('E3 5-3 남는 시간·모자란 시간 (제안)', () => {
  it('출장을 다 빼고도 남으면 연장에서 뺀다', () => {
    const r = run({
      ...base, lunchTaken: false, workType: 'office_then_depart', regions: ['대전'],
      office: { start: 6, end: 10 }, legs: [{ direction: 'out', start: 10 }], site: { start: 12, end: 14 },
    })
    // 총 8시간 → 초과 0. 09~18 밖 사무실 3시간을 연장에서 뺌
    expect(hoursOf(r)).toEqual({ trip: 0, nightTravel: 0, overtime: 0, nightOvertime: 0 })
    expect(r.status).toBe('proposed')
    expect(codes(r)).toContain('E3_SURPLUS_FROM_OVERTIME')
  })

  it('점심을 못 써서 모자라면 연장에 더한다', () => {
    const r = run({
      ...base, lunchTaken: false, workType: 'office_then_depart', regions: ['대전'],
      office: { start: 9, end: 18 }, legs: [{ direction: 'out', start: 18 }],
    })
    // 총 11 → 초과 3, 09~18 밖 이동 2 → 1시간 모자람
    expect(hoursOf(r)).toEqual({ trip: 2, nightTravel: 0, overtime: 1, nightOvertime: 0 })
    expect(r.trace.excessHours).toBe(3)
    expect(r.status).toBe('proposed')
    expect(codes(r)).toContain('E3_SHORTFALL_TO_OVERTIME')
  })
})

describe('E4 5-3 표준 이동 배치 (제안)', () => {
  it('이동 시각을 비우면 작업 시작 − T, 종료 + T 에 놓는다 (16번과 결과 같음, 제안값)', () => {
    const r = run({
      ...base, workType: 'office_then_depart', regions: ['대전'], office: { start: 9, end: 18 },
      legs: [{ direction: 'out' }, { direction: 'back' }], site: { start: 21, end: 26 },
    })
    expect(hoursOf(r)).toEqual({ trip: 4, nightTravel: 2, overtime: 5, nightOvertime: 4 })
    expect(r.trace.travel).toEqual([{ start: 19, end: 21 }, { start: 26, end: 28 }])
    expect(r.status).toBe('proposed')
    expect(r.proposedBy).toEqual(['E4'])
  })

  it('회사 지시 대기가 있으면 대기 앞에 놓는다', () => {
    const r = run({
      ...base, workType: 'office_then_depart', regions: ['대전'], office: { start: 9, end: 17 },
      directedWaits: [{ start: 19, end: 20 }], legs: [{ direction: 'out' }, { direction: 'back' }],
      site: { start: 20, end: 24 },
    })
    expect(r.trace.travel).toEqual([{ start: 17, end: 19 }, { start: 24, end: 26 }])
    expect(hoursOf(r)).toEqual({ trip: 3, nightTravel: 2, overtime: 5, nightOvertime: 2 })
  })

  it('사무실 근무와 겹쳐 놓을 자리가 없으면 시각 입력을 요구한다', () => {
    const r = runError({
      ...base, workType: 'office_then_depart', regions: ['대전'], office: { start: 9, end: 18 },
      site: { start: 19, end: 23 },
    })
    expect(codes(r)).toEqual(['E4_TRAVEL_CONFLICT'])
  })
})

describe('E5 숙박 중간일 유형 ⑦ (제안)', () => {
  it('대전 숙박 중간일 현장 08~19 → T = 0 으로 연장 2', () => {
    const r = run({ ...base, workType: 'stay_middle', regions: ['대전'], site: { start: 8, end: 19 } })
    expect(hoursOf(r)).toEqual({ trip: 0, nightTravel: 0, overtime: 2, nightOvertime: 0 })
    expect(r.status).toBe('proposed')
    expect(r.proposedBy).toEqual(['E5'])
  })
})

describe('E6 제주 (항상 제안)', () => {
  it('07시 출발, 현장 14~20 → 이동 6 + 작업 6 − 8 = 연장 4', () => {
    const r = run({
      ...base, workType: 'day_trip', regions: ['제주'], site: { start: 14, end: 20 },
      jejuActualLegs: [{ start: 7, end: 13 }], jejuEvidenceAttached: true,
    })
    expect(hoursOf(r)).toEqual({ trip: 0, nightTravel: 0, overtime: 4, nightOvertime: 0 })
    expect(r.legal.basis).toBe('actual')
    expect(r.status).toBe('proposed')
    expect(r.proposedBy).toEqual(['E6'])
  })

  it('실제 시각·증빙이 없으면 입력 플래그가 붙고 여전히 제안값이다', () => {
    const r = run({ ...base, workType: 'day_trip', regions: ['제주'], site: { start: 9, end: 18 } })
    expect(codes(r)).toEqual(expect.arrayContaining(['E6_JEJU', 'E6_NO_EVIDENCE', 'E6_ACTUAL_TIMES_REQUIRED']))
    expect(r.status).toBe('proposed')
  })
})

describe('E7 다음 날 09시를 넘긴 작업 (제안, 노무)', () => {
  const e7: TripDayInput = {
    ...base, workType: 'office_then_depart', regions: ['대전'], office: { start: 9, end: 18 },
    legs: [{ direction: 'out', start: 19 }], site: { start: 21, end: 35 },
  }

  it('작업 21~익일 11, 휴게 1시간 → 첫째 날 출장 2·연장 11·야간 근로 7', () => {
    const r = run({ ...e7, breaks: [{ start: 26, end: 27 }] })
    expect(hoursOf(r)).toEqual({ trip: 2, nightTravel: 0, overtime: 11, nightOvertime: 7 })
    expect(r.actualNight.workHours).toBe(7)
    expect(r.nextDay).toEqual({ start: 33, end: 35 })
    expect(r.status).toBe('proposed')
    expect(r.requiresLegalReview).toContain('E7')
  })

  it('휴게 기록이 없으면 표시한다 (2026-10-29 판의 연장 12는 이 경우)', () => {
    const r = run(e7)
    expect(r.overtime.hours).toBe(12)
    expect(codes(r)).toContain('E7_BREAK_NOT_RECORDED')
  })

  it('당일 출장이 09시를 넘기면 복귀 이동은 다음 날로 넘기고 가는 날처럼 계산한다', () => {
    const r = run({ ...base, lunchTaken: false, workType: 'day_trip', regions: ['대전'], site: { start: 21, end: 35 }, breaks: [{ start: 26, end: 27 }] })
    expect(r.trace.travel).toEqual([{ start: 19, end: 21 }])
    expect(r.nextDayTravel).toEqual([{ start: 35, end: 37 }])
    expect(r.proposedBy).toContain('E7')
  })

  it('나눈 두 날의 작업·이동 시간이 겹치지도 빠지지도 않는다', () => {
    const site = { start: 21, end: 35 }
    const breaks = [{ start: 26, end: 27 }]
    const day1 = run({ ...base, lunchTaken: false, workType: 'day_trip', regions: ['대전'], site, breaks })
    const sum = (rs: { start: number; end: number }[]) => rs.reduce((t, x) => t + x.end - x.start, 0)

    // 작업: 첫날 작업 구간 + 다음 날로 넘긴 구간 = 원래 작업 − 휴게
    expect(sum(day1.trace.work) + sum([day1.nextDay!])).toBe(site.end - site.start - 1)
    expect(Math.max(...day1.trace.work.map((w) => w.end))).toBeLessThanOrEqual(day1.nextDay!.start)
    // 이동: 첫날 이동 + 넘긴 이동 = 왕복 표준시간 2T
    expect(sum(day1.trace.travel) + sum(day1.nextDayTravel!)).toBe(4)

    // 다음 날을 숙박 오는 날(④)로 입력하면 09~11 작업과 11~13 복귀는 정규시간이라 추가 인정 없음 (5-4)
    const day2 = run({ ...base, lunchTaken: false, workType: 'stay_return', regions: ['대전'], site: { start: 9, end: 11 } })
    expect(day2.trace.travel).toEqual([{ start: 11, end: 13 }])
    expect(day2.trip.hours + day2.overtime.hours).toBe(0)
  })
})

describe('E8 모든 유형 야간 이동 기록', () => {
  it('부산 숙박 가는 날 현장 08~17: 04시 출발 → 야간 이동 2', () => {
    const r = run({ ...base, workType: 'stay_outbound', regions: ['부산'], site: { start: 8, end: 17 } })
    expect(hoursOf(r)).toEqual({ trip: 4, nightTravel: 2, overtime: 0, nightOvertime: 0 })
  })

  it('15번: 출장시간 0이어도 야간 이동 1을 기록한다', () => {
    expect(run(finalCase(15)).trip.nightTravelHours).toBe(1)
  })

  it('토요일에도 야간 이동을 기록한다', () => {
    const r = run({ ...finalCase(2), dayKind: 'saturday' })
    expect(r.trip.nightTravelHours).toBe(1)
  })
})

describe('E9 주간 점검 기준 분리 (경고만)', () => {
  it('출장 + 연장 9시간 → 경고, 법정 한도는 표준값 임시 판단으로 표시', () => {
    const w = checkWeek([run(finalCase(1)), run(finalCase(2))])
    expect(w.companyHours).toBe(9)
    expect(w.level).toBe('warning')
    expect(w.legal.basis).toBe('standard_travel')
    expect(w.flags.map((f) => f.code)).toEqual(['WEEK_OVER_8', 'E9_PROVISIONAL_BASIS'])
  })

  it('출장 + 연장 16시간 → 배정 차단 경고, 주 40시간 초과분은 따로 계산', () => {
    const w = checkWeek([run(finalCase(3)), run(finalCase(3))], 32)
    expect(w.companyHours).toBe(16)
    expect(w.level).toBe('block_warning')
    // 3번 하루 근로 = 이동 4 + 현장 12 = 16 → 32 + 32 = 64 → 40 초과 24
    expect(w.legal.totalWorkHours).toBe(64)
    expect(w.legal.over40Hours).toBe(24)
    expect(w.flags.map((f) => f.code)).toContain('E9_WEEKLY_LIMIT')
  })

  it('주간 점검은 하루 계산 결과를 바꾸지 않는다', () => {
    const day = run(finalCase(3))
    const before = structuredClone(day)
    checkWeek([day, day])
    expect(day).toEqual(before)
  })
})

describe('규칙 상태가 그대로 유지된다', () => {
  it('E1~E9·N1·N2·C-0 상태 (바꾸려면 회사·노무 결정 후 이 테스트도 함께 고쳐야 함)', () => {
    const statusOf = Object.fromEntries(
      (['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'N1', 'N2', 'C-0'] as const).map((id) => [id, RULES[id].status]),
    )
    expect(statusOf).toEqual({
      E1: 'adopted', E2: 'record_only', E3: 'undecided', E4: 'undecided', E5: 'undecided', E6: 'undecided',
      E7: 'undecided', E8: 'record_only', E9: 'warning_only', N1: 'undecided', N2: 'undecided', 'C-0': 'legal_review',
    })
  })

  it('N1만 걸린 결과는 야간 연장만 제안값이고, 다른 미확정 규칙은 모든 값을 제안값으로 만든다', () => {
    const n1 = run({ ...base, lunchTaken: false, workType: 'excluded_site', regions: ['경기:수원'], site: { start: 14, end: 24 } })
    expect(n1.proposedBy).toEqual(['N1'])
    expect(n1.valueStatus).toEqual({ trip: 'confirmed', nightTravel: 'confirmed', overtime: 'confirmed', nightOvertime: 'proposed' })
    const e5 = run({ ...base, workType: 'stay_middle', regions: ['대전'], site: { start: 8, end: 19 } })
    expect(Object.values(e5.valueStatus)).toEqual(['proposed', 'proposed', 'proposed', 'proposed'])
  })
})

describe('주간 점검 경계', () => {
  it('10분 단위 연장을 48일 더해 정확히 8시간이면 경고하지 않는다 (소수 오차 방지)', () => {
    const day = run({ ...base, workType: 'excluded_site', regions: ['경기:수원'], site: { start: 8, end: 17 + 10 / 60 } })
    expect(day.overtime.hours).toBeCloseTo(1 / 6)
    const w = checkWeek(Array.from({ length: 48 }, () => day))
    expect(w.companyHours).toBe(8)
    expect(w.level).toBe('ok')
  })
})

describe('C-0 법적 전제', () => {
  it('모든 결과에 급여 반영 전 노무 확인(C-0)이 표시된다', () => {
    for (const c of FINAL_CASES) expect(run(c.input).requiresLegalReview).toContain('C-0')
  })
})

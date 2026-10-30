/**
 * 최종본 9절 검증 사례 19건 (인정시간만. 금액은 엔진 범위 밖)
 * 17·18번은 시급만 다른 1·2번과 시간이 같다.
 */

import type { TripDayInput } from '../types'

export interface ExpectedHours {
  trip: number
  nightTravel: number
  overtime: number
  nightOvertime: number
}

export interface FinalCase {
  no: number
  title: string
  input: TripDayInput
  expected: ExpectedHours
}

const weekday = { dayKind: 'weekday', lunchTaken: true } as const
const dayTrip = (region: string, start: number, end: number): TripDayInput => ({
  ...weekday, workType: 'day_trip', regions: [region], site: { start, end },
})
const h = (trip: number, nightTravel: number, overtime: number, nightOvertime: number): ExpectedHours =>
  ({ trip, nightTravel, overtime, nightOvertime })

export const FINAL_CASES: FinalCase[] = [
  { no: 1, title: '대전 당일, 현장 08~17', input: dayTrip('대전', 8, 17), expected: h(4, 0, 0, 0) },
  { no: 2, title: '대전 당일, 현장 07~17', input: dayTrip('대전', 7, 17), expected: h(4, 1, 1, 0) },
  { no: 3, title: '대전 당일, 현장 07~20', input: dayTrip('대전', 7, 20), expected: h(4, 1, 4, 0) },
  { no: 4, title: '대전 당일, 현장 07~15', input: dayTrip('대전', 7, 15), expected: h(3, 1, 0, 0) },
  { no: 5, title: '대전 당일, 현장 10~16', input: dayTrip('대전', 10, 16), expected: h(1, 0, 0, 0) },
  { no: 6, title: '대전 당일, 현장 10~15', input: dayTrip('대전', 10, 15), expected: h(0, 0, 0, 0) },
  { no: 7, title: '대전 당일, A/S 10~11', input: dayTrip('대전', 10, 11), expected: h(0, 0, 0, 0) },
  {
    no: 8, title: '수원(제외 지역), 현장 08~19',
    input: { ...weekday, workType: 'excluded_site', regions: ['경기:수원'], site: { start: 8, end: 19 } },
    expected: h(0, 0, 2, 0),
  },
  { no: 9, title: '부산 당일, 현장 09~18', input: dayTrip('부산', 9, 18), expected: h(8, 1, 0, 0) },
  {
    no: 10, title: '부산 1박 첫째 날: 사무실 09~14, 이동 14~18, 저녁·대기 18~22, 작업 22~03',
    input: {
      ...weekday, workType: 'office_then_depart', regions: ['부산'],
      office: { start: 9, end: 14 }, legs: [{ direction: 'out', start: 14 }], site: { start: 22, end: 27 },
    },
    expected: h(0, 0, 5, 5),
  },
  {
    no: 11, title: '부산 1박 둘째 날: 이동 10~14, 정리 14~16, 회사 지시 퇴근',
    input: {
      ...weekday, workType: 'travel_only', regions: ['부산'],
      legs: [{ direction: 'back', start: 10 }], office: { start: 14, end: 16 }, earlyLeaveDirected: true,
    },
    expected: h(0, 0, 0, 0),
  },
  {
    no: 12, title: '10번과 같으나 작업 22~05',
    input: {
      ...weekday, workType: 'office_then_depart', regions: ['부산'],
      office: { start: 9, end: 14 }, legs: [{ direction: 'out', start: 14 }], site: { start: 22, end: 29 },
    },
    expected: h(0, 0, 7, 7),
  },
  {
    no: 13, title: '대전 숙박 가는 날, 현장 08~17',
    input: { ...weekday, workType: 'stay_outbound', regions: ['대전'], site: { start: 8, end: 17 } },
    expected: h(2, 0, 0, 0),
  },
  {
    no: 14, title: '홍성(충남 2시간), 현장 10~16, 실제 07 출발·19 도착',
    input: { ...dayTrip('충남', 10, 16), actualRecord: { departAt: 7, arriveAt: 19 } },
    expected: h(1, 0, 0, 0),
  },
  { no: 15, title: '대전 당일, 현장 07~10 (05시 출발)', input: dayTrip('대전', 7, 10), expected: h(0, 1, 0, 0) },
  {
    no: 16, title: '사무실 09~18 근무 후 대전 야간 출동: 이동 19~21, 작업 21~02, 복귀 02~04',
    input: {
      ...weekday, workType: 'office_then_depart', regions: ['대전'], office: { start: 9, end: 18 },
      legs: [{ direction: 'out', start: 19 }, { direction: 'back', start: 26 }], site: { start: 21, end: 26 },
    },
    expected: h(4, 2, 5, 4),
  },
  { no: 17, title: '대전 당일, 현장 08~17 (시급 20,000원)', input: dayTrip('대전', 8, 17), expected: h(4, 0, 0, 0) },
  { no: 18, title: '대전 당일, 현장 07~17 (시급 20,000원)', input: dayTrip('대전', 7, 17), expected: h(4, 1, 1, 0) },
  {
    no: 19, title: '홍성(충남 2시간), 현장 10~20, 실제 07 출발·22 회사 도착',
    input: { ...dayTrip('충남', 10, 20), actualRecord: { departAt: 7, arriveAt: 22 } },
    expected: h(4, 0, 1, 0),
  },
]

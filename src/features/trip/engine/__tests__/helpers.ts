import { calculateTripDay } from '../calculate'
import type { TripDayError, TripDayInput, TripDayResult } from '../types'
import type { ExpectedHours } from './final-cases.fixture'

/** 계산이 성공해야 하는 입력. 실패하면 오류 내용을 그대로 던진다 */
export function run(input: TripDayInput): TripDayResult {
  const r = calculateTripDay(input)
  if (!r.ok) throw new Error(`계산 실패: ${JSON.stringify(r.errors)}`)
  return r
}

/** 실패해야 하는 입력 */
export function runError(input: TripDayInput): TripDayError {
  const r = calculateTripDay(input)
  if (r.ok) throw new Error('오류가 나야 하는 입력인데 계산됨')
  return r
}

export const hoursOf = (r: TripDayResult): ExpectedHours => ({
  trip: r.trip.hours,
  nightTravel: r.trip.nightTravelHours,
  overtime: r.overtime.hours,
  nightOvertime: r.overtime.nightHours,
})

export const codes = (r: TripDayResult | TripDayError): string[] =>
  (r.ok ? r.flags : r.errors).map((f) => f.code)

export const base = { dayKind: 'weekday', lunchTaken: true } as const

/**
 * 주 52시간 점검 (최종본 6절 + E9)
 *
 * 회사 인정시간(출장 + 연장)과 법정 한도(주 근로 − 40)를 섞지 않고 따로 낸다.
 * 경고만 하고 계산 결과는 바꾸지 않는다.
 */

import type { ReviewFlag, TripDayResult } from './types'

export interface WeekCheck {
  /** 6절: 1주(월~일) 출장 + 연장 합계 */
  companyHours: number
  level: 'ok' | 'warning' | 'block_warning'
  /** E9: 법정 한도 판단. 표준 이동시간으로 낸 값이 섞이면 임시값 */
  legal: { totalWorkHours: number; over40Hours: number; basis: 'standard_travel' | 'actual' }
  flags: ReviewFlag[]
}

/**
 * @param days 그 주 출장 엔진 결과
 * @param otherWorkHours 같은 주 출장 외 근무시간 (사무실 정상근무 등)
 */
export function checkWeek(days: TripDayResult[], otherWorkHours = 0): WeekCheck {
  const flags: ReviewFlag[] = []
  // 분 단위 정수로 더해 소수 오차로 경계(8·12·40시간) 판정이 흔들리지 않게 한다
  const sumHours = (hs: number[]) => hs.reduce((t, h) => t + Math.round(h * 60), 0) / 60
  const companyHours = sumHours(days.flatMap((d) => [d.trip.hours, d.overtime.hours]))
  const level = companyHours > 12 ? 'block_warning' : companyHours > 8 ? 'warning' : 'ok'
  if (level === 'block_warning') {
    flags.push({ code: 'WEEK_OVER_12', kind: 'rule_review', rule: '6', message: `주 출장 + 연장 ${companyHours}시간: 12시간 초과, 배정 차단 경고` })
  } else if (level === 'warning') {
    flags.push({ code: 'WEEK_OVER_8', kind: 'rule_review', rule: '6', message: `주 출장 + 연장 ${companyHours}시간: 8시간 초과 경고` })
  }

  const totalWorkHours = sumHours([...days.map((d) => d.legal.totalWorkHours), otherWorkHours])
  const over40Hours = Math.max(0, totalWorkHours - 40)
  const basis = days.some((d) => d.legal.basis === 'standard_travel') ? 'standard_travel' : 'actual'
  if (basis === 'standard_travel') {
    flags.push({ code: 'E9_PROVISIONAL_BASIS', kind: 'rule_review', rule: 'E9', message: '법정 한도를 표준 이동시간으로 임시 판단함 (실제 기록 기준 아님)' })
  }
  if (over40Hours > 12) {
    flags.push({ code: 'E9_WEEKLY_LIMIT', kind: 'rule_review', rule: 'E9', message: `주 근로 40시간 초과분 ${over40Hours}시간: 12시간 한도 초과` })
  }
  return { companyHours, level, legal: { totalWorkHours, over40Hours, basis }, flags }
}

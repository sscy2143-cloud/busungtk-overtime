/**
 * 화면 시각 입력('HH:MM') → 엔진 시각(근무일 0시 기준 시, 다음 날이면 24 이상)
 */

import type { HourRange } from '../engine'
import type { ClockTime, Notice, TimeRangeInput } from './types'

const CLOCK = /^(\d{1,2}):(\d{2})$/

/** 'HH:MM' → 시. 24:00 까지 허용 */
export function parseClock(t: ClockTime): number | null {
  const m = CLOCK.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null
  return h + min / 60
}

/**
 * 범위 변환. 종료 표시가 없는데 종료가 시작보다 이르거나 같으면 다음 날로 보고 안내를 남긴다.
 * (03시 종료 → 27시, 최종본 3절 표기)
 */
export function toHourRange(r: TimeRangeInput, label: string, notices: Notice[]): HourRange | null {
  const s = parseClock(r.start)
  const e = parseClock(r.end)
  if (s === null || e === null) return null
  const start = s + (r.startNextDay ? 24 : 0)
  let end = e + (r.endNextDay ? 24 : 0)
  if (r.endNextDay === undefined && end <= start) {
    end += 24
    notices.push({ code: 'AUTO_NEXT_DAY', message: `${label} 종료 ${r.end}를 다음 날로 보았습니다. 맞는지 확인하세요` })
  }
  return { start, end }
}

export function toHour(t: ClockTime | undefined, nextDay = false): number | undefined {
  if (t === undefined) return undefined
  const h = parseClock(t)
  return h === null ? undefined : h + (nextDay ? 24 : 0)
}

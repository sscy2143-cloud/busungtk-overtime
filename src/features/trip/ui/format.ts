import type { HourRange } from '../engine'

/** 근무일 0시 기준 시 → '07:30', 다음 날이면 '다음 날 02:00' */
export function formatClock(hours: number): string {
  const total = Math.round(hours * 60)
  const day = Math.floor(total / 1440)
  const m = ((total % 1440) + 1440) % 1440
  const hh = String(Math.floor(m / 60)).padStart(2, '0')
  const mm = String(m % 60).padStart(2, '0')
  const prefix = day > 0 ? '다음 날 ' : day < 0 ? '전날 ' : ''
  return `${prefix}${hh}:${mm}`
}

export const formatRange = (r: HourRange): string => `${formatClock(r.start)}~${formatClock(r.end)}`

/** 2.5 → '2시간 30분', 0 → '0시간' */
export function formatHours(hours: number): string {
  const total = Math.round(hours * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

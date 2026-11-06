/**
 * 시각 구간 계산. 내부는 근무일 0시 기준 분(정수)으로 다뤄 소수 오차를 없앤다.
 */

import type { HourRange } from './types.js'

export interface Interval {
  start: number
  end: number
}

export const toMin = (hours: number): number => Math.round(hours * 60)
export const toHours = (minutes: number): number => minutes / 60
export const toInterval = (r: HourRange): Interval => ({ start: toMin(r.start), end: toMin(r.end) })
export const toRange = (iv: Interval): HourRange => ({ start: toHours(iv.start), end: toHours(iv.end) })

/** 정규시간 09~18 (1절) */
export const REGULAR: Interval = { start: 9 * 60, end: 18 * 60 }
/** 점심 12~13 (1절) */
export const LUNCH: Interval = { start: 12 * 60, end: 13 * 60 }
/** 다음 날 09:00 — 5-4 근무일 경계 */
export const NEXT_DAY_9 = 33 * 60
/** 야간 22~06 (1절). 전날 밤부터 사흘째 새벽까지 */
export const NIGHT: Interval[] = [-1, 0, 1, 2].map((k) => ({ start: (24 * k - 2) * 60, end: (24 * k + 6) * 60 }))

export const len = (iv: Interval): number => Math.max(0, iv.end - iv.start)
export const sumLen = (ivs: Interval[]): number => ivs.reduce((t, iv) => t + len(iv), 0)

/** ivs 와 windows 가 겹치는 길이. windows 끼리는 겹치지 않아야 한다 */
export function overlapMinutes(ivs: Interval[], windows: Interval[]): number {
  let total = 0
  for (const iv of ivs) {
    for (const w of windows) total += Math.max(0, Math.min(iv.end, w.end) - Math.max(iv.start, w.start))
  }
  return total
}

/** ivs 에서 cuts 를 뺀 나머지 구간 */
export function subtract(ivs: Interval[], cuts: Interval[]): Interval[] {
  let out = ivs.filter((iv) => iv.end > iv.start)
  for (const c of cuts) {
    const next: Interval[] = []
    for (const iv of out) {
      if (c.end <= iv.start || c.start >= iv.end) {
        next.push(iv)
        continue
      }
      if (c.start > iv.start) next.push({ start: iv.start, end: c.start })
      if (c.end < iv.end) next.push({ start: c.end, end: iv.end })
    }
    out = next
  }
  return out
}

/** 구간끼리 겹치는 곳이 있는지 (끝과 시작이 맞닿는 것은 겹침 아님) */
export function hasOverlap(ivs: Interval[]): boolean {
  const sorted = ivs.filter((iv) => iv.end > iv.start).sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return true
  }
  return false
}

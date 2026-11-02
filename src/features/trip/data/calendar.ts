/**
 * 날짜 계산 (YYYY-MM-DD). 현재 시각을 쓰지 않는다 — 같은 입력이면 같은 결과.
 */

import type { DayKind } from '../engine'

export type IsoDate = string

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(d: IsoDate): [number, number, number] | null {
  const m = ISO.exec(d)
  if (!m) return null
  const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, day))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== day) return null
  return [y, mo, day]
}

export const isIsoDate = (d: string): boolean => parts(d) !== null

const toIso = (t: Date): IsoDate => t.toISOString().slice(0, 10)

function utc(d: IsoDate): Date {
  const p = parts(d)
  if (!p) throw new Error(`잘못된 날짜: ${d}`)
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]))
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const t = utc(d)
  t.setUTCDate(t.getUTCDate() + n)
  return toIso(t)
}

/** start~end (양끝 포함) */
export function eachDate(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

/** 0 = 일요일 … 6 = 토요일 */
export const weekdayOf = (d: IsoDate): number => utc(d).getUTCDay()

/**
 * 최종본 3절 날짜 구분. 공휴일표는 호출하는 쪽이 넘긴다 (DB 단계에서 holidays 테이블).
 * 토요일이 공휴일이면 휴일로 본다 (휴일근로 쪽이 직원에게 불리하지 않음).
 */
export function dayKindOf(d: IsoDate, holidays: ReadonlySet<IsoDate>): DayKind {
  const w = weekdayOf(d)
  if (w === 0 || holidays.has(d)) return 'holiday'
  if (w === 6) return 'saturday'
  return 'weekday'
}

/** 그 주 월요일 (6절: 1주 = 월~일) */
export function weekStartOf(d: IsoDate): IsoDate {
  const w = weekdayOf(d)
  return addDays(d, w === 0 ? -6 : 1 - w)
}

/**
 * 공휴일 달력. 출처가 검증되지 않았으면(verified=false) 평일·휴일 구분을 관리자 확인 대상으로 올린다.
 * 코드에 공휴일을 고정하지 않는다 — 검증된 달력(DB holidays 테이블 등)을 주입한다.
 */
export interface HolidayCalendar {
  holidays: ReadonlySet<IsoDate>
  verified: boolean
  /** 예: 'holidays 테이블 2026 (검증 2026-11-01)', 'none' */
  source: string
}

/** 출처 없음 — 모든 날이 관리자 확인 대상이 된다 */
export const NO_CALENDAR: HolidayCalendar = Object.freeze({ holidays: new Set<IsoDate>(), verified: false, source: 'none' })

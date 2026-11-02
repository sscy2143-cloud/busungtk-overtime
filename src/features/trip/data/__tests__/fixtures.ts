import { createMemoryRepository } from '../repository'
import { createTripService, type ServiceDeps } from '../service'
import type { Actor, ClaimHeader, DayEntry } from '../types'

// 2026-11-02 월요일 · 11-07 토요일 · 11-08 일요일
export const MON = '2026-11-02'
export const TUE = '2026-11-03'
export const WED = '2026-11-04'
export const SAT = '2026-11-07'
export const HOLIDAY = '2026-11-05' // 테스트용 가상 공휴일

export const alice: Actor = { id: 'emp-alice', role: 'employee' }
export const bob: Actor = { id: 'emp-bob', role: 'employee' }
export const carol: Actor = { id: 'emp-carol', role: 'employee' }
export const boss: Actor = { id: 'admin-boss', role: 'admin' }

export const dayHeader = (regions: string[], date = MON): ClaimHeader => ({ regions, schedule: { kind: 'day', date } })
export const stayHeader = (regions: string[], startDate: string, endDate: string): ClaimHeader =>
  ({ regions, schedule: { kind: 'stay', startDate, endDate } })
export const siteEntry = (date: string, start: string, end: string, extra: Partial<DayEntry> = {}): DayEntry =>
  ({ date, site: { start, end }, ...extra })

export function setup(overrides: Partial<ServiceDeps> = {}) {
  const repo = createMemoryRepository()
  let seq = 0
  let tick = 0
  const deps: ServiceDeps = {
    repo,
    holidays: new Set([HOLIDAY]),
    now: () => `2026-11-10T09:00:${String(tick++).padStart(2, '0')}Z`,
    newId: (prefix) => `${prefix}-${++seq}`,
    ...overrides,
  }
  return { repo, service: createTripService(deps), deps }
}

export function unwrap<T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }): T {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.value
}

/**
 * 저장소 인터페이스 + 메모리 구현 (테스트·로컬 시험용)
 *
 * 실제 DB 구현(T6)은 같은 인터페이스를 Supabase RPC 로 구현한다.
 * 메모리 구현도 DB 제약을 흉내 낸다: 계산 결과 수정 불가, 버전 불일치 시 거부, 직원·날짜 중복 금지.
 */

import type { IsoDate } from './calendar'
import {
  ACTIVE_STATUSES,
  type TripAdjustmentRecord, type TripCalcRecord, type TripClaimRecord, type TripDayRecord, type TripReviewRecord,
} from './types'

export class RepoError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface TripRepository {
  insertClaim(claim: TripClaimRecord): void
  /** expectedVersion 이 현재 버전과 다르면 VERSION_CONFLICT */
  updateClaim(id: string, expectedVersion: number, patch: Partial<Omit<TripClaimRecord, 'id' | 'version'>>): TripClaimRecord
  getClaim(id: string): TripClaimRecord | undefined
  listClaims(filter?: { employeeId?: string; groupId?: string; status?: TripClaimRecord['status'] }): TripClaimRecord[]

  insertDay(day: TripDayRecord): void
  updateDay(id: string, expectedRevision: number, entry: TripDayRecord['entry']): TripDayRecord
  deleteDay(id: string): void
  listDays(claimId: string): TripDayRecord[]
  /** 같은 직원·날짜의 진행 중(취소·반려 제외) 근무일 */
  findActiveDay(employeeId: string, date: IsoDate, excludeClaimId?: string): TripDayRecord | undefined

  insertCalc(calc: TripCalcRecord): void
  getCalc(id: string): TripCalcRecord | undefined
  latestCalc(dayId: string): TripCalcRecord | undefined

  insertAdjustment(a: TripAdjustmentRecord): void
  listAdjustments(claimId: string): TripAdjustmentRecord[]
  insertReview(r: TripReviewRecord): void
  listReviews(claimId: string): TripReviewRecord[]
}

const clone = <T,>(v: T): T => structuredClone(v)

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.freeze(v)
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
  }
  return v
}

export function createMemoryRepository(): TripRepository {
  const claims = new Map<string, TripClaimRecord>()
  const days = new Map<string, TripDayRecord>()
  const calcs = new Map<string, TripCalcRecord>()
  const calcOrder: string[] = []
  const adjustments: TripAdjustmentRecord[] = []
  const reviews: TripReviewRecord[] = []

  const isActive = (claimId: string) => {
    const c = claims.get(claimId)
    return c !== undefined && ACTIVE_STATUSES.includes(c.status)
  }

  return {
    insertClaim(claim) {
      if (claims.has(claim.id)) throw new RepoError('DUPLICATE_ID', claim.id)
      claims.set(claim.id, clone(claim))
    },
    updateClaim(id, expectedVersion, patch) {
      const cur = claims.get(id)
      if (!cur) throw new RepoError('NOT_FOUND', id)
      if (cur.version !== expectedVersion) {
        throw new RepoError('VERSION_CONFLICT', `다른 곳에서 먼저 수정되었습니다 (현재 ${cur.version}, 요청 ${expectedVersion})`)
      }
      const next = { ...cur, ...clone(patch), id, version: cur.version + 1 }
      claims.set(id, next)
      return clone(next)
    },
    getClaim: (id) => {
      const c = claims.get(id)
      return c && clone(c)
    },
    listClaims(filter = {}) {
      return [...claims.values()]
        .filter((c) => (filter.employeeId === undefined || c.employeeId === filter.employeeId)
          && (filter.groupId === undefined || c.groupId === filter.groupId)
          && (filter.status === undefined || c.status === filter.status))
        .map(clone)
    },

    insertDay(day) {
      // UNIQUE(직원, 근무일) — 진행 중인 건끼리만
      if (isActive(day.claimId)) {
        for (const d of days.values()) {
          if (d.employeeId === day.employeeId && d.date === day.date && d.claimId !== day.claimId && isActive(d.claimId)) {
            throw new RepoError('DUPLICATE_DAY', `${day.date}에 이미 신청한 근무일이 있습니다`)
          }
        }
      }
      if (days.has(day.id)) throw new RepoError('DUPLICATE_ID', day.id)
      days.set(day.id, clone(day))
    },
    updateDay(id, expectedRevision, entry) {
      const cur = days.get(id)
      if (!cur) throw new RepoError('NOT_FOUND', id)
      if (cur.revision !== expectedRevision) throw new RepoError('VERSION_CONFLICT', `근무일 ${cur.date}이 먼저 수정되었습니다`)
      const next = { ...cur, entry: clone(entry), revision: cur.revision + 1 }
      days.set(id, next)
      return clone(next)
    },
    deleteDay(id) {
      days.delete(id)
    },
    listDays: (claimId) => [...days.values()].filter((d) => d.claimId === claimId).sort((a, b) => a.date.localeCompare(b.date)).map(clone),
    findActiveDay(employeeId, date, excludeClaimId) {
      for (const d of days.values()) {
        if (d.employeeId === employeeId && d.date === date && d.claimId !== excludeClaimId && isActive(d.claimId)) return clone(d)
      }
      return undefined
    },

    insertCalc(calc) {
      if (calcs.has(calc.id)) throw new RepoError('IMMUTABLE', '계산 결과는 수정할 수 없습니다')
      calcs.set(calc.id, deepFreeze(clone(calc)))
      calcOrder.push(calc.id)
    },
    getCalc: (id) => calcs.get(id),
    latestCalc(dayId) {
      for (let i = calcOrder.length - 1; i >= 0; i--) {
        const c = calcs.get(calcOrder[i])!
        if (c.dayId === dayId) return c
      }
      return undefined
    },

    insertAdjustment: (a) => void adjustments.push(clone(a)),
    listAdjustments: (claimId) => adjustments.filter((a) => a.claimId === claimId).map(clone),
    insertReview: (r) => void reviews.push(clone(r)),
    listReviews: (claimId) => reviews.filter((r) => r.claimId === claimId).map(clone),
  }
}

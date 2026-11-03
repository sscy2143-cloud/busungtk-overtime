/**
 * 관리자 승인 화면(T4) 목록·승인 가능 여부 모델
 */

import { reviewItems, type FlagDecision, type TripCalcRecord, type TripClaimRecord } from '../data'

export interface ReviewTotals {
  trip: number
  overtime: number
  holiday: number
}

export interface ReviewRow {
  claimId: string
  employeeId: string
  dates: string[]
  status: TripClaimRecord['status']
  /** 확정값 합계 */
  confirmed: ReviewTotals
  /** 제안값 합계 (회사 확정 전) */
  proposed: ReviewTotals
  /** 승인 전에 확인해야 할 항목 수 */
  reviewCount: number
  hasError: boolean
  companion: boolean
}

const zero = (): ReviewTotals => ({ trip: 0, overtime: 0, holiday: 0 })

export function toReviewRow(claim: TripClaimRecord, calcs: TripCalcRecord[], dates: string[]): ReviewRow {
  const confirmed = zero()
  const proposed = zero()
  let hasError = false
  const addMin = (t: ReviewTotals, k: keyof ReviewTotals, hours: number) => { t[k] = (Math.round(t[k] * 60) + Math.round(hours * 60)) / 60 }
  for (const c of calcs) {
    const r = c.result
    if (!r || !r.ok) {
      hasError = true
      continue
    }
    addMin(r.valueStatus.trip === 'confirmed' ? confirmed : proposed, 'trip', r.trip.hours)
    addMin(r.valueStatus.overtime === 'confirmed' ? confirmed : proposed, 'overtime', r.overtime.hours)
    if (r.holiday) addMin(r.status === 'confirmed' ? confirmed : proposed, 'holiday', r.holiday.within8Hours + r.holiday.over8Hours)
  }
  return {
    claimId: claim.id,
    employeeId: claim.employeeId,
    dates,
    status: claim.status,
    confirmed,
    proposed,
    reviewCount: calcs.reduce((t, c) => t + reviewItems(c).length, 0),
    hasError: hasError || calcs.some((c) => c.classification.missing.length > 0),
    companion: claim.origin === 'companion_draft',
  }
}

/** 승인 버튼을 막는 이유 (서비스의 review 와 같은 기준) */
export function approvalBlockers(claim: TripClaimRecord, calcs: TripCalcRecord[], decisions: FlagDecision[]): string[] {
  const out: string[] = []
  if (claim.status !== 'submitted') out.push('제출된 신청이 아닙니다')
  if (calcs.some((c) => !c.result || !c.result.ok)) out.push('계산되지 않은 근무일이 있습니다')
  const unresolved = calcs.flatMap((c) => reviewItems(c).filter((code) => !decisions.some((d) => d.calcId === c.id && d.code === code)))
  if (unresolved.length > 0) out.push(`확인하지 않은 표시 ${unresolved.length}건`)
  return out
}

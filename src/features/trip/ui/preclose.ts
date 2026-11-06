/**
 * T8 — 기간 마감 전 점검 (순수 함수). 규정 확정과 무관한 사실 점검만 한다.
 * 금액 계산·급여 반영·급여 항목 코드는 다루지 않는다. 마감 가능 여부는 "승인 절차가 끝났는가" 만 본다.
 * 회사 결정 전 값(제안값)과 노무 확인 대상은 마감을 막지 않고 경고로 알리되, 급여 반영 전 결정이 필요하다는 점을 남긴다.
 */
import type { ClaimStatus } from '../data'

export interface PreCloseClaim {
  id: string
  /** 담당자가 알아볼 수 있는 직원 표시 */
  ref: string
  status: ClaimStatus
  /** 아직 처리되지 않은 관리자 확인 항목 수 */
  openFlags: number
  /** 회사 결정 전 값이 들어 있는 항목 (예: nightOvertime) */
  heldKeys: string[]
  /** 노무 확인이 필요한 규칙 (예: C-0, E7) */
  legalReview: string[]
  /** 공휴일 달력 출처가 검증되지 않아 모든 날에 확인 항목이 붙은 신청인지 */
  calendarUnverified: boolean
}

export type PreCloseCode =
  | 'PENDING_REVIEW' | 'RETURNED_OPEN' | 'DRAFT_IN_PERIOD' | 'UNRESOLVED_FLAGS'
  | 'GROUP_MISMATCH' | 'CALENDAR_UNVERIFIED' | 'HELD_VALUES' | 'LEGAL_REVIEW'

export interface PreCloseItem {
  code: PreCloseCode
  message: string
  claimIds: string[]
}

export interface PreCloseResult {
  /** 막는 항목이 없으면 true — 급여 반영 가능 여부가 아니다 */
  canClose: boolean
  blockers: PreCloseItem[]
  warnings: PreCloseItem[]
  /** 점검 대상(취소·반려 제외) 신청 수 */
  checked: number
}

export function preCloseCheck(input: { claims: PreCloseClaim[]; groupMismatchCount?: number }): PreCloseResult {
  const live = input.claims.filter((c) => c.status !== 'cancelled' && c.status !== 'rejected')
  const ids = (pred: (c: PreCloseClaim) => boolean) => live.filter(pred).map((c) => c.id)
  const blockers: PreCloseItem[] = []
  const warnings: PreCloseItem[] = []
  const add = (list: PreCloseItem[], code: PreCloseCode, message: string, claimIds: string[]) => {
    if (claimIds.length > 0) list.push({ code, message, claimIds })
  }

  add(blockers, 'PENDING_REVIEW', '검토가 끝나지 않은 제출 건이 있습니다', ids((c) => c.status === 'submitted'))
  add(blockers, 'RETURNED_OPEN', '직원에게 되돌려져 재제출을 기다리는 건이 있습니다', ids((c) => c.status === 'returned'))
  add(blockers, 'DRAFT_IN_PERIOD', '제출되지 않은 작성 중인 건이 있습니다', ids((c) => c.status === 'draft'))
  add(blockers, 'UNRESOLVED_FLAGS', '처리되지 않은 관리자 확인 항목이 남아 있습니다', ids((c) => c.status === 'approved' && c.openFlags > 0))
  if ((input.groupMismatchCount ?? 0) > 0) {
    blockers.push({ code: 'GROUP_MISMATCH', message: `동행 출장에서 같은 날 지역·현장 시각이 다르거나 빠진 날이 ${input.groupMismatchCount}건 있습니다`, claimIds: [] })
  }

  add(warnings, 'CALENDAR_UNVERIFIED', '공휴일 달력 출처가 검증되지 않았습니다 — 담당자 확인이 필요합니다', ids((c) => c.calendarUnverified))
  add(warnings, 'HELD_VALUES', '회사 결정 전 값(제안값)이 포함돼 있습니다 — 급여 반영 전에 규정 결정이 필요합니다', ids((c) => c.heldKeys.length > 0))
  add(warnings, 'LEGAL_REVIEW', '노무 확인이 필요한 규칙이 걸려 있습니다 — 급여 반영 전에 확인이 필요합니다', ids((c) => c.legalReview.length > 0))

  return { canClose: blockers.length === 0, blockers, warnings, checked: live.length }
}

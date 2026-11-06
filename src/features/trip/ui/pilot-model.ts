/**
 * 시범 운영 비교 화면의 모델 — 승인된 신청의 정산 미리보기를 비교용 행으로 모은다. 순수 함수.
 * 급여에 쓰는 값이 아니라 수기 계산표와 대조하기 위한 값이다. 서비스 호출 규칙(관리자만, 스위치 OFF 면 거부)은 서비스가 그대로 적용한다.
 */
import type { Actor, GuardedTripService } from '../data'
import type { SystemRow } from '../pilot'

export interface PilotCollect {
  rows: SystemRow[]
  /** 정산 미리보기를 가져오지 못한 신청 — 조용히 빼지 않고 알린다 */
  errors: { claimId: string; message: string }[]
  /** 승인된 신청 수 */
  claims: number
}

export function collectPilotSystemRows(
  svc: Pick<GuardedTripService, 'reviewQueue' | 'settlementPreview'>,
  actor: Actor,
  refOf: (employeeId: string) => string,
): { ok: true; value: PilotCollect } | { ok: false; code: string; message: string } {
  const queue = svc.reviewQueue(actor, 'approved')
  if (!queue.ok) return { ok: false, code: queue.code, message: queue.message }
  const rows: SystemRow[] = []
  const errors: PilotCollect['errors'] = []
  for (const claim of queue.value) {
    const p = svc.settlementPreview(actor, claim.id)
    if (!p.ok) { errors.push({ claimId: claim.id, message: p.message }); continue }
    for (const d of p.value.days) rows.push({ ref: refOf(claim.employeeId), date: d.date, confirmed: d.confirmed, held: d.held })
  }
  return { ok: true, value: { rows, errors, claims: queue.value.length } }
}

export const PILOT_KEY_LABEL = {
  trip: '출장', nightTravel: '야간 이동', overtime: '연장', nightOvertime: '야간 연장',
  holidayWithin8: '휴일 8시간 이내', holidayOver8: '휴일 8시간 초과',
} as const

export const PILOT_STATUS_LABEL = {
  match: '일치', diff: '차이 있음', system_only: '시스템에만 있음', manual_only: '수기표에만 있음',
} as const

/**
 * 서버 강제 게이트 — 기능 활성화 여부와 사용자 역할을 "서버가 아는 값"으로 강제한다.
 *
 * 메뉴를 숨기는 것(ui/TRIP_FEATURE)은 운영 차단이 아니다. 모든 쓰기·조회는 이 계층을 거친다.
 *  - 기능 스위치가 꺼져 있으면 어떤 호출도 FEATURE_DISABLED 로 거부한다 (조회 포함).
 *  - 클라이언트가 보낸 역할(actor.role)은 믿지 않는다. 세션 사용자 ID로 서버가 역할을 찾고, 다르면 거부한다.
 *  - 직원은 본인 건만, 관리자 기능은 admin 역할만.
 *
 * 실제 DB 단계(T5)에서는 같은 규칙을 RPC 첫 줄에서 강제한다: trip_feature_enabled(key) → auth.uid() 역할 조회.
 */

import { createTripService, type GroupMismatch, type ServiceDeps, type TripService } from './service'
import type {
  Actor, Result, TripAdjustmentRecord, TripCalcRecord, TripClaimRecord, TripDayRecord, TripReviewRecord,
} from './types'
import type { WeekCheck } from '../engine'

export type FeatureKey = 'employeeForm' | 'adminReview' | 'payrollApply'

export interface FeatureState {
  enabled: boolean
  /** 어디서 읽은 값인지 — 'code-default', 'trip_feature_flags' 등 */
  source: string
}

export interface TripAccessGate {
  feature(key: FeatureKey): FeatureState
  /** 세션 사용자 ID → 서버가 아는 역할. 모르는 사용자면 null */
  resolveActor(userId: string): Actor | null
}

/** 기본값: 전부 꺼짐. 켜는 것은 운영 반영 단계에서 사용자 승인 후 */
export const FEATURES_ALL_OFF: Readonly<Record<FeatureKey, boolean>> = Object.freeze({
  employeeForm: false,
  adminReview: false,
  payrollApply: false,
})

/** 테스트·로컬 시험용 고정 게이트. 급여 반영(payrollApply)은 어떤 인자를 줘도 켜지지 않는다 */
export function createStaticGate(
  flags: Partial<Record<FeatureKey, boolean>>,
  directory: Readonly<Record<string, Actor['role']>>,
): TripAccessGate {
  const merged = { ...FEATURES_ALL_OFF, ...flags, payrollApply: false }
  return {
    feature: (key) => ({ enabled: merged[key], source: 'static' }),
    resolveActor: (userId) => (Object.hasOwn(directory, userId) ? { id: userId, role: directory[userId] } : null),
  }
}

/** 검토 화면 한 건 상세 — 서버가 한 번에 돌려주는 읽기 묶음 */
export interface ClaimDetailData {
  claim: TripClaimRecord
  days: TripDayRecord[]
  calcs: TripCalcRecord[]
  adjustments: TripAdjustmentRecord[]
  reviews: TripReviewRecord[]
  mismatches: GroupMismatch[]
  /** 마지막 승인이 묶인 계산 결과 (승인 뒤 입력이 바뀌어도 이 값은 그대로) */
  approvedCalcs: TripCalcRecord[]
  /** 같은 직원이 같은 날짜로 낸 다른 진행 중 신청 (중복 경고용) */
  sameDayOthers: { date: string; claimId: string }[]
}

export interface GuardedTripService {
  // 직원
  createClaim: TripService['createClaim']
  updateDraft: TripService['updateDraft']
  submit: TripService['submit']
  cancel: TripService['cancel']
  inviteCompanions: TripService['inviteCompanions']
  /** 본인 신청 목록 */
  myClaims(actor: Actor): Result<TripClaimRecord[]>
  /** 본인 신청 한 건과 입력 원본 (화면에 다시 불러올 때) */
  myClaim(actor: Actor, claimId: string): Result<{ claim: TripClaimRecord; days: TripDayRecord[] }>
  /** 본인 건이거나 관리자일 때만 */
  latestCalcs(actor: Actor, claimId: string): Result<TripCalcRecord[]>
  weeklyCheck(actor: Actor, anyDateInWeek: string, otherWorkHours?: number): Result<WeekCheck>
  // 관리자
  adminAdjustDay: TripService['adminAdjustDay']
  review: TripService['review']
  reviewQueue(actor: Actor, status?: TripClaimRecord['status']): Result<TripClaimRecord[]>
  claimDetail(actor: Actor, claimId: string): Result<ClaimDetailData>
  settlementPreview(actor: Actor, claimId: string): ReturnType<TripService['settlementPreview']>
  groupMismatches(actor: Actor, groupId: string): Result<ReturnType<TripService['groupMismatches']>>
  /** 화면이 켜도 되는지 (서버 값). 메뉴 노출용 — 차단은 각 호출에서 다시 한다 */
  featureState(key: FeatureKey): FeatureState
}

const fail = <T,>(code: string, message: string): Result<T> => ({ ok: false, code, message })

export function createGuardedTripService(deps: ServiceDeps, gate: TripAccessGate): GuardedTripService {
  const inner = createTripService(deps)

  /** 기능 스위치 + 서버 역할 확인. 통과하면 서버가 아는 actor 를 돌려준다 */
  function admit(key: FeatureKey, claimed: Actor, requiredRole?: Actor['role']): Result<Actor> {
    const f = gate.feature(key)
    if (!f.enabled) return fail('FEATURE_DISABLED', '출장수당 기능이 아직 열리지 않았습니다')
    const actual = gate.resolveActor(claimed.id)
    if (!actual) return fail('UNKNOWN_USER', '사용자를 확인할 수 없습니다. 다시 로그인하세요')
    if (actual.role !== claimed.role) return fail('ROLE_MISMATCH', '권한 정보가 서버와 다릅니다. 다시 로그인하세요')
    if (requiredRole && actual.role !== requiredRole) return fail('FORBIDDEN', '관리자만 할 수 있습니다')
    return { ok: true, value: actual }
  }

  function employeeOp<A extends unknown[], T>(fn: (actor: Actor, ...rest: A) => Result<T>) {
    return (claimed: Actor, ...rest: A): Result<T> => {
      const a = admit('employeeForm', claimed)
      return a.ok ? fn(a.value, ...rest) : a
    }
  }
  function adminOp<A extends unknown[], T>(fn: (actor: Actor, ...rest: A) => Result<T>) {
    return (claimed: Actor, ...rest: A): Result<T> => {
      const a = admit('adminReview', claimed, 'admin')
      return a.ok ? fn(a.value, ...rest) : a
    }
  }

  function canSee(actor: Actor, claimId: string): Result<TripClaimRecord> {
    const claim = deps.repo.getClaim(claimId)
    if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
    if (actor.role !== 'admin' && claim.employeeId !== actor.id) return fail('FORBIDDEN', '본인 신청만 볼 수 있습니다')
    return { ok: true, value: claim }
  }

  return {
    createClaim: employeeOp(inner.createClaim),
    updateDraft: employeeOp(inner.updateDraft),
    submit: employeeOp(inner.submit),
    cancel: employeeOp(inner.cancel),
    inviteCompanions: employeeOp(inner.inviteCompanions),
    myClaims: employeeOp((actor) => ({ ok: true, value: deps.repo.listClaims({ employeeId: actor.id }) })),
    myClaim: employeeOp((actor, claimId: string) => {
      const seen = canSee(actor, claimId)
      return seen.ok ? { ok: true, value: { claim: seen.value, days: deps.repo.listDays(claimId) } } : seen
    }),
    latestCalcs(claimed, claimId) {
      // 직원 화면·관리자 화면 어느 쪽이든 그 화면의 스위치가 켜져 있어야 한다
      const a = claimed.role === 'admin' ? admit('adminReview', claimed, 'admin') : admit('employeeForm', claimed)
      if (!a.ok) return a
      const seen = canSee(a.value, claimId)
      return seen.ok ? { ok: true, value: inner.latestCalcs(claimId) } : seen
    },
    weeklyCheck: employeeOp((actor, anyDateInWeek: string, otherWorkHours?: number) =>
      ({ ok: true, value: inner.weeklyCheck(actor.id, anyDateInWeek, otherWorkHours) })),

    adminAdjustDay: adminOp(inner.adminAdjustDay),
    review: adminOp(inner.review),
    reviewQueue: adminOp((_actor, status?: TripClaimRecord['status']) =>
      ({ ok: true, value: deps.repo.listClaims(status ? { status } : {}) })),
    claimDetail: adminOp((_actor, claimId: string) => {
      const claim = deps.repo.getClaim(claimId)
      if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
      const days = deps.repo.listDays(claimId)
      const reviews = deps.repo.listReviews(claimId)
      const approval = reviews.filter((r) => r.action === 'approve').at(-1)
      const approvedCalcs = approval
        ? approval.calcIds.map((id) => deps.repo.getCalc(id)).filter((c): c is TripCalcRecord => c !== undefined)
        : []
      const sameDayOthers = days.flatMap((d) => {
        const other = deps.repo.findActiveDay(claim.employeeId, d.date, claimId)
        return other ? [{ date: d.date, claimId: other.claimId }] : []
      })
      return {
        ok: true,
        value: {
          claim, days, calcs: inner.latestCalcs(claimId), adjustments: deps.repo.listAdjustments(claimId), reviews,
          mismatches: inner.groupMismatches(claim.groupId), approvedCalcs, sameDayOthers,
        },
      }
    }),
    settlementPreview: adminOp((_actor, claimId: string) => inner.settlementPreview(claimId)),
    groupMismatches: adminOp((_actor, groupId: string) => ({ ok: true, value: inner.groupMismatches(groupId) })),
    featureState: (key) => gate.feature(key),
  }
}

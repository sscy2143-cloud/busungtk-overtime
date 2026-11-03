/**
 * 메모리 GuardedTripService 를 화면용 TripClientService 모양으로 감싼다 (테스트·샌드박스·흐름 검증용).
 * 메모리 서비스는 저장할 때 바로 계산하므로 compute 는 최신 계산 결과 id 만 돌려주고, refresh 는 할 일이 없다.
 */

import { RULE_VERSION } from '../engine'
import { reviewItems, type Actor, type GuardedTripService, type Result } from '../data'
import { fail, ok } from './backend'
import type { ComputeSummary, TripClientService } from './types'

export interface MemoryClientOptions {
  now?: () => string
  /** 전체 조회 권한을 받은 직원 id (메모리 시험용). 비우면 아무도 없음 */
  viewGrants?: string[]
  /** 조회 권한자의 읽기를 대신 수행할 admin actor (메모리 서비스는 역할로만 판단하므로) */
  adminActor?: Actor
  /** 부여 후보 id (서버의 "활성·직급 팀장·admin 제외" 에 해당). 비우면(undefined) 메모리 시험에서는 누구나 후보 */
  candidates?: string[]
}

export function fromMemoryService(svc: GuardedTripService, opts: MemoryClientOptions = {}): TripClientService {
  const now = opts.now ?? (() => '1970-01-01T00:00:00Z')
  const granted = new Set(opts.viewGrants ?? [])
  const grantMeta = new Map<string, { grantedBy: string; grantedAt: string; note: string }>()
  for (const id of granted) grantMeta.set(id, { grantedBy: opts.adminActor?.id ?? 'admin', grantedAt: now(), note: '메모리 시험' })
  const eligible = (id: string) => (opts.candidates ? opts.candidates.includes(id) : true)
  const effective = (actor: Actor) => actor.role !== 'admin' && granted.has(actor.id) && eligible(actor.id)
  const viewerReader = (actor: Actor): Result<Actor> => {
    if (!svc.featureState('adminReview').enabled) return fail('FEATURE_DISABLED', '출장수당 기능이 아직 열리지 않았습니다')
    if (actor.role === 'admin') return ok(actor)
    if (!effective(actor)) return fail('VIEW_NOT_GRANTED', '전체 출장 내역 조회 권한이 없습니다')
    if (!opts.adminActor) return fail('VIEW_NOT_GRANTED', '메모리 시험에 adminActor 가 없습니다')
    return ok(opts.adminActor)
  }
  const compute = async (actor: Actor, claimId: string): Promise<Result<ComputeSummary>> => {
    const calcs = svc.latestCalcs(actor, claimId)
    if (!calcs.ok) return calcs
    if (calcs.value.length === 0) return fail('CALC_INCOMPLETE_SET', '근무일이 없습니다')
    return ok({
      claimId, ruleVersion: RULE_VERSION,
      calcIds: Object.fromEntries(calcs.value.map((c) => [c.dayId, c.id])),
      reviewCodes: Object.fromEntries(calcs.value.map((c) => [c.dayId, reviewItems(c)])),
    })
  }
  return {
    myClaims: svc.myClaims,
    myClaim: svc.myClaim,
    latestCalcs: svc.latestCalcs,
    weeklyCheck: svc.weeklyCheck,
    reviewQueue: svc.reviewQueue,
    claimDetail: svc.claimDetail,
    settlementPreview: svc.settlementPreview,
    groupMismatches: svc.groupMismatches,
    featureState: svc.featureState,
    createClaim: async (...a) => svc.createClaim(...a),
    updateDraft: async (...a) => svc.updateDraft(...a),
    submit: async (...a) => svc.submit(...a),
    cancel: async (...a) => svc.cancel(...a),
    inviteCompanions: async (...a) => svc.inviteCompanions(...a),
    adminAdjustDay: async (...a) => svc.adminAdjustDay(...a),
    review: async (...a) => svc.review(...a),
    compute,
    refresh: async () => ok({ actor: null, claims: 0, at: now() }),
    computeIssue: () => undefined,
    viewGrantState: (actor) => ({ granted: effective(actor), source: 'memory' }),
    viewerQueue: (actor, status) => { const r = viewerReader(actor); return r.ok ? svc.reviewQueue(r.value, status) : r },
    viewerDetail: (actor, claimId) => { const r = viewerReader(actor); return r.ok ? svc.claimDetail(r.value, claimId) : r },
    viewGrants: (actor) => ok([...granted].filter((id) => actor.role === 'admin' || (id === actor.id && eligible(id))).map((id) => ({ employeeId: id, ...grantMeta.get(id)! }))),
    viewGrantCandidates: (actor) => (actor.role === 'admin' ? ok([...(opts.candidates ?? [])]) : fail('FORBIDDEN', '관리자만 할 수 있습니다')),
    setViewGrant: async (actor, employeeId, enabled, note) => {
      if (actor.role !== 'admin') return fail('FORBIDDEN', '관리자만 할 수 있습니다')
      if (!note.trim()) return fail('REASON_REQUIRED', '부여·회수 사유를 입력하세요')
      if (employeeId === actor.id) return fail('INVALID_ARGUMENT', '본인에게는 부여할 수 없습니다')
      if (enabled && !eligible(employeeId)) return fail('NOT_ELIGIBLE', '부여 대상이 아닙니다 (활성이고 회사 직급이 팀장인 직원만)')
      const changed = enabled ? !granted.has(employeeId) : granted.has(employeeId)
      if (enabled) { granted.add(employeeId); grantMeta.set(employeeId, { grantedBy: actor.id, grantedAt: now(), note }) } else { granted.delete(employeeId); grantMeta.delete(employeeId) }
      return ok({ employeeId, enabled, changed })
    },
  }
}

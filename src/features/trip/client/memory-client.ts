/**
 * 메모리 GuardedTripService 를 화면용 TripClientService 모양으로 감싼다 (테스트·샌드박스·흐름 검증용).
 * 메모리 서비스는 저장할 때 바로 계산하므로 compute 는 최신 계산 결과 id 만 돌려주고, refresh 는 할 일이 없다.
 */

import { RULE_VERSION } from '../engine'
import { reviewItems, type Actor, type GuardedTripService, type Result } from '../data'
import { fail, ok } from './backend'
import type { ComputeSummary, TripClientService } from './types'

export function fromMemoryService(svc: GuardedTripService, opts: { now?: () => string } = {}): TripClientService {
  const now = opts.now ?? (() => '1970-01-01T00:00:00Z')
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
  }
}

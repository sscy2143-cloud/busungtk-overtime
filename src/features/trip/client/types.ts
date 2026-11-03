/**
 * T6 — 화면이 쓰는 서비스 모양 (실제 연결용).
 *
 * 읽기는 동기(거울 저장소에서), 쓰기는 비동기(서버 RPC). 메모리 구현과 원격 구현이 같은 모양이다.
 *  - 읽기: GuardedTripService 와 같은 서명. 원격 구현은 refresh() 로 받아 둔 거울 저장소에서 읽는다.
 *  - 쓰기: 같은 인자, 반환만 Promise. 원격 구현은 RPC → (필요하면) 서버 계산 → 거울 갱신 순으로 처리한다.
 *  - compute: 서버 재계산 (POST /api/trip-compute). 메모리 구현은 저장 때 이미 계산하므로 결과만 돌려준다.
 */

import type { Actor, GuardedTripService, Result } from '../data'

export type TripReadKey =
  | 'myClaims' | 'myClaim' | 'latestCalcs' | 'weeklyCheck'
  | 'reviewQueue' | 'claimDetail' | 'settlementPreview' | 'groupMismatches' | 'featureState'

export type TripWriteKey =
  | 'createClaim' | 'updateDraft' | 'submit' | 'cancel' | 'inviteCompanions'
  | 'adminAdjustDay' | 'review'

export type TripReads = Pick<GuardedTripService, TripReadKey>

export type TripWrites = {
  [K in TripWriteKey]: (...args: Parameters<GuardedTripService[K]>) => Promise<ReturnType<GuardedTripService[K]>>
}

/** 서버 계산 결과 요약 — 계약 1절 응답에서 화면이 쓰는 부분 */
export interface ComputeSummary {
  claimId: string
  ruleVersion: string
  /** day id → calc id */
  calcIds: Record<string, string>
  /** day id → 관리자 확인 항목 코드 */
  reviewCodes: Record<string, string[]>
}

export interface SyncInfo {
  /** 세션 사용자 (서버가 아는 값) */
  actor: Actor | null
  claims: number
  at: string
}

export interface TripClientService extends TripReads, TripWrites {
  /** 서버 재계산. 본인 건(직원) 또는 제출된 건(관리자) */
  compute(actor: Actor, claimId: string): Promise<Result<ComputeSummary>>
  /** 거울 저장소를 서버 값으로 다시 채운다. 쓰기 뒤에는 자동으로 한다 */
  refresh(): Promise<Result<SyncInfo>>
  /** 마지막 저장 뒤 서버 계산이 실패했으면 그 사유 (입력은 저장돼 있음). 없으면 undefined */
  computeIssue(claimId: string): { code: string; message: string } | undefined
}

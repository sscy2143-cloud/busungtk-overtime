/**
 * 서버 재계산(Vercel Function) 의 입출력 계약 — docs/출장수당/T5-DB-초안/계약-서버계산.md 와 1:1.
 *
 * 이 모듈은 DB 클라이언트를 모른다. 실제 I/O(ComputeIO)는 api/trip-compute.ts 가 DB SDK 로 구현하고,
 * 테스트는 가짜 ComputeIO 로 조작 시도를 흉내 낸다.
 */

import type { DayComputation } from '../data'
import type { Actor, ClaimHeader, ClaimStatus, DayEntry, IsoDate } from '../data'

/** 브라우저가 보내는 전부. 이 밖의 필드(계산 결과·규칙 버전·역할 등)는 읽지 않는다 */
export interface ComputeRequest {
  claimId: string
}

export interface ComputeSuccess {
  ok: true
  claimId: string
  ruleVersion: string
  /** day id → 저장된 calc id */
  calcIds: Record<string, string>
  /** day id → 관리자 확인 항목 코드 (화면 안내용) */
  reviewCodes: Record<string, string[]>
}

export type ComputeErrorCode =
  | 'UNKNOWN_USER' | 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND' | 'NOT_EDITABLE'
  | 'RULE_VERSION_MISMATCH' | 'CALC_INCOMPLETE_SET' | 'UNKNOWN_REGION' | 'CALC_INVARIANT' | 'STORE_FAILED' | 'BAD_REQUEST'

export interface ComputeFailure {
  ok: false
  code: ComputeErrorCode | string
  message: string
}

export type ComputeResponse = ComputeSuccess | ComputeFailure

export const HTTP_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNKNOWN_USER: 401,
  FEATURE_DISABLED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_EDITABLE: 409,
  RULE_VERSION_MISMATCH: 409,
  CALC_INCOMPLETE_SET: 422,
  UNKNOWN_REGION: 422,
  CALC_INVARIANT: 422,
  STORE_FAILED: 500,
}

/** DB 행 (snake_case — 계약 3절) */
export interface ClaimRow {
  id: string
  employee_id: string
  group_id: string
  origin: 'self' | 'companion_draft'
  header: ClaimHeader
  status: ClaimStatus
  version: number
}

export interface DayRow {
  id: string
  claim_id: string
  employee_id: string
  work_date: IsoDate
  entry: DayEntry
  revision: number
}

export interface OtherRequestRow {
  date: IsoDate
  planned_start: string
  planned_end: string
  status: string
}

/** 함수가 DB 에 대해 하는 일 전부. service_role 로 실행된다 — 반드시 서버 안에서만 */
export interface ComputeIO {
  /** 사용자 JWT → auth 사용자 id. 유효하지 않으면 null */
  userIdFromJwt(jwt: string): Promise<string | null>
  /** employees.id = auth.uid() */
  findEmployee(userId: string): Promise<Actor | null>
  featureEnabled(key: 'employee_form' | 'admin_review'): Promise<boolean>
  activeRuleVersion(): Promise<string | null>
  loadClaim(claimId: string): Promise<ClaimRow | null>
  /** is_removed = false 만 */
  loadDays(claimId: string): Promise<DayRow[]>
  /** 같은 직원의 다른 진행 중 신청의 근무일 (claim_status ∈ draft/submitted/returned/approved) */
  findOtherActiveDay(employeeId: string, date: IsoDate, excludeClaimId: string): Promise<DayRow | null>
  /** holidays.is_verified 행의 날짜. 0건이면 달력 미검증 */
  loadVerifiedHolidays(): Promise<{ dates: IsoDate[]; source: string }>
  /** overtime_requests 같은 직원·날짜·status ∉ (cancelled, rejected) */
  loadOtherRequests(employeeId: string, dates: IsoDate[]): Promise<OtherRequestRow[]>
  /** RPC trip_store_server_calcs — day id → calc id */
  storeCalcs(claimId: string, ruleVersion: string, calcs: Record<string, DayComputation>, computedBy: string): Promise<Record<string, string>>
}

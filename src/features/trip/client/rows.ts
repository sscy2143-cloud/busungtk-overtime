/**
 * DB 행(snake_case, 010_trip_tables.sql) ↔ 데이터 계층 기록(types.ts).
 * 표의 조회용 사본 칼럼(regions, start_date, *_min 등)은 읽지 않는다 — 원본은 jsonb(header, entry)다.
 */

import type {
  ClaimHeader, DayEntry, FlagDecision, IsoDate, TripAdjustmentRecord, TripCalcRecord, TripClaimRecord, TripDayRecord, TripReviewRecord,
} from '../data'

export interface ClaimRow {
  id: string
  employee_id: string
  group_id: string
  initiator_id: string
  origin: 'self' | 'companion_draft'
  header: ClaimHeader
  status: TripClaimRecord['status']
  version: number
  created_at: string
  updated_at: string
  submitted_at: string | null
}

export interface DayRow {
  id: string
  claim_id: string
  employee_id: string
  work_date: IsoDate
  entry: DayEntry
  revision: number
  is_removed: boolean
}

export interface CalcRow {
  id: string
  seq: number
  claim_id: string
  day_id: string
  day_revision: number
  rule_version: string
  classification: TripCalcRecord['classification']
  engine_input: TripCalcRecord['engineInput']
  result: TripCalcRecord['result']
  carry_out: TripCalcRecord['carryOut'] | null
  carry_in: TripCalcRecord['carryIn'] | null
  computed_at: string
}

export interface AdjustmentRow {
  id: string
  day_id: string
  claim_id: string
  admin_id: string
  before_entry: DayEntry
  after_entry: DayEntry
  reason: string
  created_at: string
}

export interface ReviewRow {
  id: string
  claim_id: string
  admin_id: string
  action: TripReviewRecord['action']
  calc_ids: string[]
  flag_decisions: FlagDecision[]
  reason: string | null
  created_at: string
}

export interface ViewGrantRow {
  employee_id: string
  granted_by: string
  granted_at: string
  note: string
}

export interface FeatureFlagRow {
  key: 'employee_form' | 'admin_review' | 'payroll_apply'
  enabled: boolean
}

export interface EmployeeRow {
  id: string
  role: string
  is_active: boolean
}

export const CLAIM_COLUMNS = ['id', 'employee_id', 'group_id', 'initiator_id', 'origin', 'header', 'status', 'version', 'created_at', 'updated_at', 'submitted_at']
export const DAY_COLUMNS = ['id', 'claim_id', 'employee_id', 'work_date', 'entry', 'revision', 'is_removed']
export const CALC_COLUMNS = ['id', 'seq', 'claim_id', 'day_id', 'day_revision', 'rule_version', 'classification', 'engine_input', 'result', 'carry_out', 'carry_in', 'computed_at']
export const ADJUSTMENT_COLUMNS = ['id', 'day_id', 'claim_id', 'admin_id', 'before_entry', 'after_entry', 'reason', 'created_at']
export const REVIEW_COLUMNS = ['id', 'claim_id', 'admin_id', 'action', 'calc_ids', 'flag_decisions', 'reason', 'created_at']
export const EMPLOYEE_COLUMNS = ['id', 'role', 'is_active']
export const VIEW_GRANT_COLUMNS = ['employee_id', 'granted_by', 'granted_at', 'note']

export function toViewGrant(r: ViewGrantRow): import('./types').ViewGrantRecord {
  return { employeeId: r.employee_id, grantedBy: r.granted_by, grantedAt: r.granted_at, note: r.note ?? '' }
}

export function toClaim(r: ClaimRow): TripClaimRecord {
  return {
    id: r.id, employeeId: r.employee_id, groupId: r.group_id, initiatorId: r.initiator_id, origin: r.origin,
    header: r.header, status: r.status, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
    ...(r.submitted_at ? { submittedAt: r.submitted_at } : {}),
  }
}

export function toDay(r: DayRow): TripDayRecord {
  return { id: r.id, claimId: r.claim_id, employeeId: r.employee_id, date: r.work_date, entry: r.entry, revision: r.revision }
}

export function toCalc(r: CalcRow): TripCalcRecord {
  return {
    id: r.id, claimId: r.claim_id, dayId: r.day_id, dayRevision: r.day_revision, ruleVersion: r.rule_version,
    classification: r.classification, engineInput: r.engine_input, result: r.result,
    ...(r.carry_out ? { carryOut: r.carry_out } : {}),
    ...(r.carry_in ? { carryIn: r.carry_in } : {}),
    computedAt: r.computed_at,
  }
}

export function toAdjustment(r: AdjustmentRow): TripAdjustmentRecord {
  return { id: r.id, dayId: r.day_id, claimId: r.claim_id, adminId: r.admin_id, before: r.before_entry, after: r.after_entry, reason: r.reason, at: r.created_at }
}

export function toReview(r: ReviewRow): TripReviewRecord {
  return {
    id: r.id, claimId: r.claim_id, adminId: r.admin_id, action: r.action, calcIds: r.calc_ids,
    flagDecisions: r.flag_decisions ?? [], ...(r.reason ? { reason: r.reason } : {}), at: r.created_at,
  }
}

/** employees.role → 출장 기능의 역할. admin 만 관리자, manager 는 직원으로 본다 (api/trip-compute.ts 와 같은 규칙) */
export const toRole = (role: string): 'employee' | 'admin' => (role === 'admin' ? 'admin' : 'employee')

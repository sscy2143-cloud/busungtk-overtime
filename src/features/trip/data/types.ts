/**
 * 출장 신청 데이터 계층 — 직원 입력 원본, 저장 기록, 계산 결과 기록
 *
 * 원칙
 *  - 직원 입력 원본(DayEntry)과 계산 결과(TripCalcRecord)를 분리해 저장한다. 계산 결과는 수정하지 않고 새로 만든다.
 *  - 기본 입력은 "지역 · 현장 시작/종료 · 점심 사용"뿐이다. 나머지는 예외 상황에서만 채운다.
 *  - 표준 이동시간은 직원 입력이 아니다. 실제 출발·도착 시각(actual)은 기록 전용이고 계산에 쓰지 않는다.
 */

import type { DayKind, HourRange, TripDayError, TripDayInput, TripDayResult, WorkType } from '../engine/index.js'
import type { IsoDate } from './calendar.js'

/** 'HH:MM' (00:00 ~ 24:00) */
export type ClockTime = string

/** 시각 범위 입력. 종료가 시작보다 이르면 다음 날로 자동 판단하고 안내한다 */
export interface TimeRangeInput {
  start: ClockTime
  end: ClockTime
  startNextDay?: boolean
  endNextDay?: boolean
}

export type Schedule =
  | { kind: 'day'; date: IsoDate }
  | { kind: 'stay'; startDate: IsoDate; endDate: IsoDate }

/** 출장 1건 공통 입력 */
export interface ClaimHeader {
  /** 방문 순서. 지역 코드는 engine/regions.ts */
  regions: string[]
  schedule: Schedule
}

/** 실제 출발·도착 기록의 출처 (계산에는 쓰지 않음) */
export type ActualSource = 'self' | 'companion_copy' | 'admin' | 'external'

/** 직원이 하루마다 입력하는 원본 */
export interface DayEntry {
  date: IsoDate
  // ── 기본 입력 ──
  site?: TimeRangeInput
  /** 기본값: 사용 */
  lunchTaken?: boolean
  // ── 예외 입력 (해당할 때만) ──
  /** 이날 지역이 출장 공통 지역과 다를 때 (여러 현장 방문 순서) */
  regions?: string[]
  /** 그날 사무실 근무 (현장 전이면 ⑤, 현장 없이 이동만이면 ⑥) */
  office?: TimeRangeInput
  /** 현장 작업 없음 (이동만, 고객 사정 작업 취소) */
  noSiteWork?: { reason: string }
  /** 이동 출발 시각. 보통 비워 두고, 계산 충돌이나 현장이 없는 날에만 받는다 (E4) */
  travelStarts?: { out?: ClockTime; back?: ClockTime }
  breaks?: TimeRangeInput[]
  directedWaits?: TimeRangeInput[]
  /** 제외 지역 현장의 회사 지시 사무실 집결 */
  assemblyAt?: ClockTime
  delay?: { hours: number; evidenceFileIds: string[] }
  jeju?: { legs: TimeRangeInput[]; evidenceFileIds: string[] }
  earlyLeaveDirected?: boolean
  /** 기록 전용. 표준시간으로 미리 채우지 않는다. 자정을 넘긴 도착은 arriveNextDay 로 표시 */
  actual?: { departAt?: ClockTime; arriveAt?: ClockTime; arriveNextDay?: boolean; source: ActualSource }
}

export type DayPosition = 'single' | 'first' | 'middle' | 'last'

/** 직원에게 더 받아야 하는 입력 */
export type MissingField =
  | 'site'
  | 'travelStarts.out'
  | 'travelStarts.back'
  | 'jeju.legs'
  | 'jeju.evidence'
  | 'noSiteWork.reason'

export interface Notice {
  code: string
  message: string
}

export interface Classification {
  workType: WorkType | null
  dayKind: DayKind
  position: DayPosition
  input: TripDayInput | null
  missing: MissingField[]
  notices: Notice[]
}

// ── 저장 기록 ──────────────────────────────────────────────

export type ClaimStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'rejected' | 'cancelled'

/** 같은 직원·같은 날짜에 동시에 있을 수 없는 상태 (UNIQUE(직원, 근무일) 대상) */
export const ACTIVE_STATUSES: readonly ClaimStatus[] = ['draft', 'submitted', 'returned', 'approved']

export interface TripClaimRecord {
  id: string
  employeeId: string
  /** 동행 묶음. 동행자도 각자 자기 건을 갖는다 */
  groupId: string
  /** 처음 만든 사람 (동행 초안이면 신청자) */
  initiatorId: string
  origin: 'self' | 'companion_draft'
  header: ClaimHeader
  status: ClaimStatus
  /** 동시 수정 감지용. 바뀔 때마다 1 증가 */
  version: number
  createdAt: string
  updatedAt: string
  submittedAt?: string
}

export interface TripDayRecord {
  id: string
  claimId: string
  employeeId: string
  date: IsoDate
  entry: DayEntry
  /** 입력이 바뀔 때마다 1 증가. 계산 결과는 이 번호에 묶인다 */
  revision: number
}

/** 다음 근무일로 넘어간 작업·이동 (5-4, E7) */
export interface CarryOver {
  toDate: IsoDate
  work?: HourRange
  travel: HourRange[]
  /** 다음 날 기록이 같은 직원에게 있는지 */
  linkedDayId?: string
}

/** 계산 결과 — 만든 뒤 바꾸지 않는다 */
export interface TripCalcRecord {
  id: string
  claimId: string
  dayId: string
  dayRevision: number
  ruleVersion: string
  classification: Omit<Classification, 'input'>
  engineInput: TripDayInput | null
  result: TripDayResult | TripDayError | null
  carryOut?: CarryOver
  /** 전날에서 넘어온 작업·이동 */
  carryIn?: { fromDate: IsoDate; work?: HourRange; travel: HourRange[] }
  computedAt: string
}

export interface TripAdjustmentRecord {
  id: string
  dayId: string
  claimId: string
  adminId: string
  before: DayEntry
  after: DayEntry
  reason: string
  at: string
}

/** 관리자가 확인 표시를 어떻게 처리했는지 */
export interface FlagDecision {
  calcId: string
  code: string
  /** acknowledged: 내용 확인 (제안값은 여전히 제안값으로 남음) */
  decision: 'acknowledged'
  note?: string
}

export interface TripReviewRecord {
  id: string
  claimId: string
  adminId: string
  action: 'approve' | 'reject' | 'return'
  /** 승인이 묶인 계산 결과 */
  calcIds: string[]
  flagDecisions: FlagDecision[]
  reason?: string
  at: string
}

export type Actor = { id: string; role: 'employee' | 'admin' }

export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

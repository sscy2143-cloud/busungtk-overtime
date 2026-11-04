/**
 * 출장수당 인정시간 계산 엔진 — 입력·출력 타입
 *
 * 기준: 「근태 전산 반영 요청: 출장수당·연장수당 자동 계산 (2026.10.26 최종본)」
 * 시간 입력은 최종본 3절 표기를 따른다: 근무일 0시 기준 시(hour), 자정을 넘기면 24를 더함 (03시 → 27).
 * 금액·단가는 이 엔진의 범위가 아니다.
 */

/** 최종본 3절 근무 유형 ①~⑥ + 검토 중인 ⑦(E5) */
export type WorkType =
  | 'excluded_site' // ① 제외 지역 현장
  | 'day_trip' // ② 당일 출장
  | 'stay_outbound' // ③ 숙박 출장 가는 날
  | 'stay_return' // ④ 숙박 출장 오는 날
  | 'office_then_depart' // ⑤ 사무실 근무 후 같은 날 출발
  | 'travel_only' // ⑥ 작업 없는 이동일 (도착 후 작업 취소 포함)
  | 'stay_middle' // ⑦ 숙박 중간일 — 최종본에 없음, E5 제안

/** 평일 / 토요일(휴무일) / 일요일·공휴일(휴일) */
export type DayKind = 'weekday' | 'saturday' | 'holiday'

/** 근무일 0시 기준 시각 범위 (시 단위, 다음 날이면 24 이상) */
export interface HourRange {
  start: number
  end: number
}

/** ⑤⑥ 이동 구간. 길이는 항상 표준 편도시간이고, start 를 주지 않으면 E4 제안 위치에 놓는다 */
export interface TravelLegInput {
  direction: 'out' | 'back'
  start?: number
}

export interface TripDayInput {
  workType: WorkType
  dayKind: DayKind
  /** 방문 순서대로. 지역 코드는 regions.ts */
  regions: string[]
  site?: HourRange
  office?: HourRange
  /** 점심 휴게 사용 여부 */
  lunchTaken: boolean
  /** 점심 외 휴게 */
  breaks?: HourRange[]
  /** 회사 지시 현장 대기 (자유 대기·숙소 저녁은 넣지 않음) */
  directedWaits?: HourRange[]
  /** ⑤⑥ 이동 구간 */
  legs?: TravelLegInput[]
  /** ① 회사 지시 사무실 집결 시각 */
  assemblyAt?: number
  /** 5-8 회사 지시 경유지·항공 지연 추가 시간 */
  delay?: { hours: number; evidenceAttached: boolean }
  /** E6 제주: 실제 이동 구간 (제주만 실제 시각을 계산에 씀 — 제안) */
  jejuActualLegs?: HourRange[]
  jejuEvidenceAttached?: boolean
  /** 5-6 토요일: 그 주에 결근·연차가 있는지 */
  weekHasAbsenceOrLeave?: boolean
  /** 5-5 회사 지시 조기 퇴근 (계산에 영향 없음, 기록용) */
  earlyLeaveDirected?: boolean
  /** 실제 출발·도착 시각 — 최종본 2절에 따라 기록만 하고 계산에는 쓰지 않음 */
  actualRecord?: { departAt?: number; arriveAt?: number }
}

/** 규칙 근거. 숫자는 최종본 절, E·N 은 검토 항목, C-0 은 법적 전제 */
export type RuleId =
  | '2' | '3' | '4' | '5-1' | '5-2' | '5-3' | '5-4' | '5-5' | '5-6' | '5-7' | '5-8' | '6'
  | 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8' | 'E9'
  | 'N1' | 'N2'
  | 'C-0'

/**
 * rule_review    최종본이 "담당자 확인"을 요구하는 경우 (규정)
 * undecided_rule 미확정 규칙으로 값을 냈음 → 결과는 제안값
 * input          입력 누락·오류
 */
export type FlagKind = 'rule_review' | 'undecided_rule' | 'input'

export interface ReviewFlag {
  code: string
  kind: FlagKind
  rule: RuleId
  message: string
}

/** confirmed = 최종본 규정만으로 계산 / proposed = 미확정 규칙이 하나라도 쓰임 */
export type ValueStatus = 'confirmed' | 'proposed'

export interface TripDayResult {
  ok: true
  ruleVersion: string
  status: ValueStatus
  /** 값별 상태. N1(야간 연장 배분)만 걸리면 야간 연장만 제안값이다 */
  valueStatus: { trip: ValueStatus; nightTravel: ValueStatus; overtime: ValueStatus; nightOvertime: ValueStatus }
  /** 결과를 제안값으로 만든 미확정 규칙 */
  proposedBy: RuleId[]
  /** 1그룹: 회사 출장수당 인정 */
  trip: { hours: number; nightTravelHours: number }
  /** 2그룹: 회사 연장수당 인정 */
  overtime: { hours: number; nightHours: number }
  /** 일요일·공휴일 휴일근로 (5-6). 평일·토요일은 null */
  holiday: { within8Hours: number; over8Hours: number } | null
  /** 3그룹: 법정 검증값. basis 가 standard_travel 이면 표준 이동시간으로 낸 임시값 (E9) */
  legal: { totalWorkHours: number; dailyOver8Hours: number; basis: 'standard_travel' | 'actual' }
  /** 4그룹: 실제 야간 근로 (22~06시 작업·사무실·지시 대기, 연장 여부와 무관) — E2 기록용 */
  actualNight: { workHours: number }
  flags: ReviewFlag[]
  /** 급여 반영 전 노무 확인이 필요한 항목 */
  requiresLegalReview: RuleId[]
  /** 미리보기용 계산 근거 (시 단위) */
  trace: {
    travel: HourRange[]
    work: HourRange[]
    adjustmentHours?: number
    excessHours?: number
  }
  /** E7: 다음 날 09시를 넘긴 작업 — 다음 근무일로 넘어가는 부분 */
  nextDay?: HourRange
  /** 다음 날 09시 이후로 넘어간 이동 (5-4 정규근무, E7 복귀). 이 근무일에는 넣지 않고 다음 근무일 기록에 넘긴다 */
  nextDayTravel?: HourRange[]
}

export interface TripDayError {
  ok: false
  errors: ReviewFlag[]
}

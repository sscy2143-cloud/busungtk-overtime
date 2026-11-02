/**
 * 화면 표시 문구. 코드 값은 바꾸지 않고 표시만 여기서 정한다.
 */

import type { DayKind, FlagKind, ValueStatus, WorkType } from '../engine'
import type { ClaimStatus, MissingField } from '../data'

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  excluded_site: '근거리 현장',
  day_trip: '당일 출장',
  stay_outbound: '숙박 출장 가는 날',
  stay_return: '숙박 출장 오는 날',
  office_then_depart: '사무실 근무 후 출발',
  travel_only: '이동만 한 날',
  stay_middle: '숙박 출장 중간일',
}

export const DAY_KIND_LABEL: Record<DayKind, string> = {
  weekday: '평일',
  saturday: '토요일',
  holiday: '일요일·공휴일',
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: '작성 중',
  submitted: '제출됨',
  returned: '되돌아옴',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
}

export const VALUE_STATUS_LABEL: Record<ValueStatus, string> = {
  confirmed: '확정',
  proposed: '제안값 · 회사 확정 전',
}

export const FLAG_KIND_LABEL: Record<FlagKind, string> = {
  rule_review: '규정상 담당자 확인',
  undecided_rule: '미확정 규칙 적용',
  input: '입력 확인',
}

/** 직원에게 추가로 물을 때 쓰는 질문 */
export const MISSING_FIELD_PROMPT: Record<MissingField, string> = {
  site: '현장 작업 시작·종료 시각을 입력하세요',
  'travelStarts.out': '출발 시각을 입력하세요',
  'travelStarts.back': '복귀 출발 시각을 입력하세요',
  'jeju.legs': '제주 출장은 실제 출발·도착 시각이 필요합니다',
  'jeju.evidence': '제주 출장은 항공권 등 증빙을 첨부하세요',
  'noSiteWork.reason': '작업하지 못한 사유를 입력하세요',
}

/** 확인 표시 코드 → 짧은 제목 (상세 문구는 엔진 메시지) */
export const FLAG_TITLE: Record<string, string> = {
  BREAK_DEDUCTED: '점심 외 휴게 차감',
  DELAY_REVIEW: '경유·지연 인정',
  DELAY_NO_EVIDENCE: '경유·지연 증빙 없음',
  SATURDAY_WEEK_ABSENCE: '토요일 근무 주 결근·연차',
  HOLIDAY_REVIEW: '휴일 근무',
  E3_SURPLUS_FROM_OVERTIME: '남는 시간 연장에서 차감 (E3)',
  E3_SHORTFALL_TO_OVERTIME: '모자란 시간 연장에 추가 (E3)',
  E4_TRAVEL_PLACED: '표준 이동 위치 자동 배치 (E4)',
  E5_STAY_MIDDLE: '숙박 중간일 (E5)',
  E6_JEJU: '제주 실제 시각 계산 (E6)',
  E6_NO_EVIDENCE: '제주 증빙 없음',
  E6_ACTUAL_TIMES_REQUIRED: '제주 실제 시각 없음',
  E7_SPLIT_AT_NEXT_DAY_9: '다음 날 09시에서 나눔 (E7)',
  E7_BREAK_NOT_RECORDED: '밤샘 작업 휴게 기록 없음',
  N1_NIGHT_OVERTIME_ALLOCATION: '야간 연장 배분 (N1)',
  N2_LUNCH_DURING_TRAVEL: '이동 중 점심 (N2)',
  NEXT_DAY_ENTRY_MISSING: '다음 날 근무 기록 없음',
  HOLIDAY_SOURCE_UNVERIFIED: '공휴일 달력 미검증',
}

export const flagTitle = (code: string): string => FLAG_TITLE[code] ?? code

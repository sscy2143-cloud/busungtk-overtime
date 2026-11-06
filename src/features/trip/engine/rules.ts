/**
 * 규칙 상태 목록. 여기서 'undecided' 인 규칙이 쓰이면 결과는 제안값(proposed)이 되고
 * 관리자 확인 전에는 급여에 반영하지 않는다. 상태를 바꾸는 것은 회사·노무 결정 후에만 한다.
 */

import type { RuleId } from './types.js'

export const RULE_VERSION = '2026-10-26-final/proposals-v0'

export type RuleStatus =
  | 'final' // 최종본 규정
  | 'adopted' // 최종본의 명백한 수식 보완 (E1: 0 하한)
  | 'record_only' // 기록만, 급여 반영은 별도 결정 (E2, E8)
  | 'warning_only' // 경고만 (E9)
  | 'undecided' // 미확정 → 제안값
  | 'legal_review' // 노무 확인 필요 (C-0)

export const RULES: Readonly<Record<RuleId, { status: RuleStatus; title: string }>> = Object.freeze({
  '2': { status: 'final', title: '지역별 표준 편도시간' },
  '3': { status: 'final', title: '입력 항목' },
  '4': { status: 'final', title: '당일 출장 현장조정' },
  '5-1': { status: 'final', title: '제외 지역 현장' },
  '5-2': { status: 'final', title: '숙박 출장 가는 날·오는 날' },
  '5-3': { status: 'final', title: '사무실 근무 후 출발·작업 없는 이동일' },
  '5-4': { status: 'final', title: '자정을 넘긴 작업' },
  '5-5': { status: 'final', title: '회사 지시 조기 퇴근' },
  '5-6': { status: 'final', title: '토요일·휴일' },
  '5-7': { status: 'final', title: '제주' },
  '5-8': { status: 'final', title: '여러 지역·경유·중복 금지' },
  '6': { status: 'final', title: '주 52시간 점검' },
  E1: { status: 'adopted', title: '검증식 0 하한' },
  E2: { status: 'record_only', title: '연장 아닌 야간 근로 기록' },
  E3: { status: 'undecided', title: '5-3 남는 시간·모자란 시간 처리' },
  E4: { status: 'undecided', title: '5-3 표준 이동 배치' },
  E5: { status: 'undecided', title: '숙박 중간일 유형 ⑦' },
  E6: { status: 'undecided', title: '제주 실제 시각 계산' },
  E7: { status: 'undecided', title: '다음 날 09시를 넘긴 작업' },
  E8: { status: 'record_only', title: '모든 유형 야간 이동 기록' },
  E9: { status: 'warning_only', title: '주간 한도 기준 분리' },
  N1: { status: 'undecided', title: '연장 중 야간시간 배분 (구현 중 발견)' },
  N2: { status: 'undecided', title: '5-3 이동 중 점심 처리 (구현 중 발견)' },
  'C-0': { status: 'legal_review', title: '표준 이동시간의 근로시간 간주 (제58조)' },
})

export const UNDECIDED_RULES: RuleId[] = (Object.keys(RULES) as RuleId[]).filter(
  (id) => RULES[id].status === 'undecided',
)

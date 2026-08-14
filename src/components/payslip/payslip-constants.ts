/** 지급항목명 → 근로기준법 시행령상 산출식 문구 (자동연동 항목 기본값) */
export const DEFAULT_CALC_FORMULAS: Record<string, string> = {
  '연장근로수당': '연장근로시간 수 x 시간당 통상임금 x 50%',
  '야간근로수당': '야간근로시간 수 x 시간당 통상임금 x 50%',
}

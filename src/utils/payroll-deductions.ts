import { WITHHOLDING_TAX_TABLE } from './withholding-tax-table'

/** 4대보험 근로자 부담 요율 (2026년 요율표 기준) */
export const NATIONAL_PENSION_RATE = 0.0475
export const HEALTH_INSURANCE_RATE = 0.03595
export const LONG_TERM_CARE_RATE_OF_HEALTH = 0.1314
export const EMPLOYMENT_INSURANCE_RATE = 0.009

/** 원천징수세율 선택(80/100/120%) — 부성티케이 기본값 120% */
export const WITHHOLDING_MULTIPLIER = 1.2

function roundTo10(n: number) {
  return Math.round(n / 10) * 10
}

/** 근로소득 간이세액표 조회 (월급여액, 공제대상가족수 1~11명) */
export function lookupWithholdingTax(monthlySalaryWon: number, dependents: number): number {
  const salaryThousand = monthlySalaryWon / 1000
  const famIdx = Math.min(11, Math.max(1, dependents))
  const row = WITHHOLDING_TAX_TABLE.find(r => salaryThousand >= r[0] && salaryThousand < r[1])
  if (!row) {
    // 표 범위(770천원~1억원) 밖이면 추정 불가 — 0 반환(직접 입력 필요)
    return 0
  }
  return row[1 + famIdx]
}

export interface AutoDeductions {
  근로소득세: number
  근로지방소득세: number
  국민연금: number
  건강보험: number
  장기요양보험: number
  고용보험: number
}

/** 지급총액 기준 4대보험·세금 자동추정 (실제 고지액과 소폭 다를 수 있는 추정치) */
export function calculateAutoDeductions(totalPayment: number, dependents: number): AutoDeductions {
  const 건강보험 = roundTo10(totalPayment * HEALTH_INSURANCE_RATE)
  const 근로소득세 = roundTo10(lookupWithholdingTax(totalPayment, dependents) * WITHHOLDING_MULTIPLIER)
  return {
    근로소득세,
    근로지방소득세: roundTo10(근로소득세 * 0.1),
    국민연금: roundTo10(totalPayment * NATIONAL_PENSION_RATE),
    건강보험,
    장기요양보험: roundTo10(건강보험 * LONG_TERM_CARE_RATE_OF_HEALTH),
    고용보험: roundTo10(totalPayment * EMPLOYMENT_INSURANCE_RATE),
  }
}

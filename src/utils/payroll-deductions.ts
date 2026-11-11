import { WITHHOLDING_TAX_TABLE } from './withholding-tax-table'

/** 4대보험 근로자 부담 요율 (2026년 요율표 기준) */
export const NATIONAL_PENSION_RATE = 0.0475
export const HEALTH_INSURANCE_RATE = 0.03595
export const LONG_TERM_CARE_RATE_OF_HEALTH = 0.1314
export const EMPLOYMENT_INSURANCE_RATE = 0.009

/**
 * 원천징수세율 선택(80/100/120%) — 부성티케이 기본값 120% (기존 운영값 그대로 유지).
 * 법정 기본은 100%(소득세법 시행령 제194조)이고 80·120%는 직원별 조정신청서가 있어야 하지만,
 * 120%로 정한 최초 근거를 확인하기 전까지 운영값을 바꾸지 않는다.
 */
export const WITHHOLDING_MULTIPLIER = 1.2

// 끝수 처리도 기존 운영 방식(10원 단위 반올림)을 그대로 유지한다.
// → 1천만원 미만 직원의 세액은 이번 수정 전과 한 푼도 달라지지 않는다.
function roundTo10(n: number) {
  return Math.round(n / 10) * 10
}

/**
 * 소득세법 시행령 [별표 2] 근로소득 간이세액표(2026.2.27 개정)의 "10,000천원" 행.
 * 표(WITHHOLDING_TAX_TABLE)는 9,980~10,000천원 미만 구간에서 끝나므로, 정확히 10,000천원과
 * 그 초과 구간은 별표 2 하단의 계산식으로 구한다. [공제대상가족 1명, 2명, …, 11명]
 */
const TAX_AT_10M: readonly number[] = [1507400, 1431570, 1200840, 1170840, 1140840, 1110840, 1080840, 1050840, 1020840, 990840, 960840]

/** 별표 2 "10,000천원 초과" 구간 계산식 — (10,000천원 세액) + 가산액 */
function overTenMillionAddition(monthlySalaryWon: number): number {
  const w = monthlySalaryWon
  if (w <= 14_000_000) return (w - 10_000_000) * 0.98 * 0.35 + 25_000
  if (w <= 28_000_000) return 1_397_000 + (w - 14_000_000) * 0.98 * 0.38
  if (w <= 30_000_000) return 6_610_600 + (w - 28_000_000) * 0.98 * 0.40
  if (w <= 45_000_000) return 7_394_600 + (w - 30_000_000) * 0.40
  if (w <= 87_000_000) return 13_394_600 + (w - 45_000_000) * 0.42
  return 31_034_600 + (w - 87_000_000) * 0.45
}

/**
 * 근로소득 간이세액표 조회 (월급여액, 공제대상가족수 1~11명)
 * - 770천원 미만: 표상 세액 없음 → 0원 (실제 세액 0)
 * - 770천원 이상 10,000천원 미만: 표 조회 (기존과 동일)
 * - 10,000천원: 표의 10,000천원 행 / 10,000천원 초과: 별표 2 계산식
 *   (이전에는 표에 행이 없어 0원이 나왔다 — 1천만원 이상 직원 근로소득세 0원 오류의 원인)
 * - 계산할 수 없는 입력(숫자가 아님·음수): null — 0원과 구분하기 위해 0으로 바꾸지 않는다
 */
export function lookupWithholdingTax(monthlySalaryWon: number, dependents: number): number | null {
  if (!Number.isFinite(monthlySalaryWon) || monthlySalaryWon < 0 || !Number.isFinite(dependents)) return null
  const famIdx = Math.min(11, Math.max(1, Math.trunc(dependents)))
  if (monthlySalaryWon >= 10_000_000) {
    const base = TAX_AT_10M[famIdx - 1]
    return monthlySalaryWon === 10_000_000 ? base : base + overTenMillionAddition(monthlySalaryWon)
  }
  const salaryThousand = monthlySalaryWon / 1000
  const row = WITHHOLDING_TAX_TABLE.find(r => salaryThousand >= r[0] && salaryThousand < r[1])
  if (!row) {
    // 표는 770천원부터 시작하고 10,000천원 이상은 위에서 처리했으므로, 여기 오는 건 770천원 미만뿐 — 세액 0원
    return 0
  }
  return row[1 + famIdx]
}

export interface AutoDeductions {
  /** null = 계산 실패(입력값 오류). 0원과 다름 — 화면에서 0으로 채우지 말 것 */
  근로소득세: number | null
  근로지방소득세: number | null
  국민연금: number
  건강보험: number
  장기요양보험: number
  고용보험: number
}

/** 지급총액 기준 4대보험·세금 자동추정 (실제 고지액과 소폭 다를 수 있는 추정치) */
export function calculateAutoDeductions(totalPayment: number, dependents: number): AutoDeductions {
  const 건강보험 = roundTo10(totalPayment * HEALTH_INSURANCE_RATE)
  const simpleTax = lookupWithholdingTax(totalPayment, dependents)
  const 근로소득세 = simpleTax == null ? null : roundTo10(simpleTax * WITHHOLDING_MULTIPLIER)
  return {
    근로소득세,
    근로지방소득세: 근로소득세 == null ? null : roundTo10(근로소득세 * 0.1),
    국민연금: roundTo10(totalPayment * NATIONAL_PENSION_RATE),
    건강보험,
    장기요양보험: roundTo10(건강보험 * LONG_TERM_CARE_RATE_OF_HEALTH),
    고용보험: roundTo10(totalPayment * EMPLOYMENT_INSURANCE_RATE),
  }
}

// ── 저장된 명세서 세액 점검 (화면 표시용 — 저장값을 바꾸지 않는다) ──

/** 상여·성과급 항목 여부(항목명 기준). 상여 원천징수(시행령 195조)는 세무 확인 전이라 자동계산하지 않는다 */
export function isBonusLabel(label: string) {
  return /상여|성과/.test(label)
}

/**
 * 비과세가 될 수 있는 지급항목(식대·자가운전보조금·보육수당 등, 소득세법 제12조). 이 전산에는 항목별 비과세 금액
 * 입력이 없어 과세급여에서 뺄 수 없으므로, 이런 항목이 있으면 세액을 자동 계산하지 않는다(잘못된 세액 방지).
 */
export function isTaxFreeCandidateLabel(label: string) {
  return /비과세|식대|식비|중식|자가운전|차량유지|보육|육아|출산/.test(label)
}

export interface IncomeTaxCalc {
  totalPayment: number
  /** null = 자동 계산하지 않음(0원과 다름) → 화면에 '계산 확인 필요' */
  incomeTax: number | null
  localTax: number | null
  /** 자동 계산하지 않은 이유 */
  holdReason: 'bonus' | 'taxfree' | 'invalid' | null
}

interface TaxLine { label: string; amount: number }

/**
 * 급여명세서 근로소득세 자동계산 = 지급합계 × 간이세액표 × 120%(기존 운영 방식 그대로, 1천만원 이상 계산식만 추가).
 * 상여·성과급 항목이 있는 달은 지급합계로 법정 세액이 정해지지 않으므로(시행령 195조: 지급대상기간 평균으로 계산)
 * 자동 계산하지 않고 '계산 확인 필요'로 둔다(직접 입력).
 */
export function calcIncomeTax(payments: readonly TaxLine[], dependents: number): IncomeTaxCalc {
  const totalPayment = payments.reduce((s, p) => s + (p.amount || 0), 0)
  if (payments.some(p => (p.amount || 0) !== 0 && isBonusLabel(p.label))) {
    return { totalPayment, incomeTax: null, localTax: null, holdReason: 'bonus' }
  }
  if (payments.some(p => (p.amount || 0) !== 0 && isTaxFreeCandidateLabel(p.label))) {
    return { totalPayment, incomeTax: null, localTax: null, holdReason: 'taxfree' }
  }
  const auto = calculateAutoDeductions(totalPayment, dependents)
  if (auto.근로소득세 == null || auto.근로지방소득세 == null) return { totalPayment, incomeTax: null, localTax: null, holdReason: 'invalid' }
  return { totalPayment, incomeTax: auto.근로소득세, localTax: auto.근로지방소득세, holdReason: null }
}

/** 계산값을 공제항목에 반영. 계산하지 않은 경우(null)에는 기존 금액을 그대로 두고 0으로 덮어쓰지 않는다 */
export function applyIncomeTax<T extends TaxLine>(items: T[], calc: IncomeTaxCalc): T[] {
  const { incomeTax, localTax } = calc
  if (incomeTax == null || localTax == null) return items
  return items.map(d =>
    d.label === '근로소득세' ? { ...d, amount: incomeTax } :
    d.label === '근로지방소득세' ? { ...d, amount: localTax } :
    d
  )
}

export type StoredTaxStatus = 'matches' | 'legit_zero' | 'suspected_zero_bug' | 'differs' | 'cannot_verify'

/**
 * 저장된 근로소득세와 지금 계산값을 비교해 상태를 나눈다.
 * calcTax = null 이면(상여 포함·입력 오류 등) 계산값을 확정할 수 없음.
 */
export function classifyStoredTax(stored: number | null, calcTax: number | null): StoredTaxStatus {
  if (calcTax != null && stored === calcTax) return calcTax === 0 ? 'legit_zero' : 'matches'
  if ((stored ?? 0) === 0 && (calcTax ?? 0) > 0) return 'suspected_zero_bug'
  if (calcTax == null) return 'cannot_verify'
  return 'differs'
}

export const STORED_TAX_STATUS_LABEL: Record<StoredTaxStatus, string> = {
  matches: '저장값과 계산값 일치',
  legit_zero: '계산상으로도 0원',
  suspected_zero_bug: '0원 저장 — 계산상 세액이 있음(1천만원 이상 0원 오류 의심)',
  differs: '저장값과 계산값이 다름(수동 입력이었는지 확인)',
  cannot_verify: '자동 계산 보류 — 세액을 직접 확인해야 함',
}

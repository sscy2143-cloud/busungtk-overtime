// 상여·성과급이 포함된 달의 근로소득세 — 소득세법 제136조, 같은 법 시행령 제195조
// (fix/payroll-tax-over-10m 작업트리에서 검증한 계산 핵심만 가져옴. 비율·끝수는 운영 설정(120%, 10원 반올림) 그대로)
//
//   월평균급여 = (상여 합계 + 지급대상기간의 상여외 급여 합계) ÷ 지급대상기간 월수
//   상여분 세액 = 간이세액표(월평균급여) × 비율 × 월수 − 지급대상기간 상여외 급여에 실제로 원천징수한 세액
//
// 지급대상기간
//   - 지급대상기간이 없는 상여(명절상여·연간 성과금 등): 그 해 1월(같은 해 직전 상여가 있으면 그 다음 달)부터 지급월까지
//   - 지급대상기간의 마지막 달이 아닌 달에 지급하면 지급대상기간이 없는 상여로 본다
//   - 같은 달 지급대상기간이 다른 상여: 기간 합계 ÷ 개수(1개월 미만 끝수는 1개월), 1년 초과는 1년
//
// 자료 신뢰성: 이전 달 자료는 담당자가 원천세 신고·확정 급여대장과 대조해 '확인' 표시한 것만 쓴다.
// 자료가 없거나 미확인이면 계산하지 않는다(세액을 추정하지 않음).
import { WITHHOLDING_MULTIPLIER, isBonusLabel, lookupWithholdingTax, type IncomeTaxCalc } from './payroll-deductions'

export type Ym = string // 'YYYY-MM'

export function ymAdd(ym: Ym, n: number): Ym {
  const [y, m] = ym.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}
function ymSpan(a: Ym, b: Ym): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by * 12 + bm) - (ay * 12 + am) + 1
}
const isYmd = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
// 운영 끝수 처리와 동일(10원 단위 반올림)
const round10 = (n: number) => Math.round(n / 10) * 10
const won = (n: number) => Math.round(n).toLocaleString('ko-KR')

/** 이전 달 자료 한 줄 (급여 귀속월 기준) */
export interface MonthRecord {
  month: Ym
  /** 그 달 상여외 급여(과세). null = 자료 없음(0원과 다름) */
  regularTaxable: number | null
  /** 그 달 상여외 급여에 실제로 원천징수한 소득세. null = 자료 없음 */
  regularTaxWithheld: number | null
  /** 그 달 지급한 상여 합계 — 같은 해 직전 상여월 판단용 */
  bonusPaid: number
  /** 원천세 신고·확정 급여대장 등 실제 자료와 대조했는가 */
  verified: boolean
}

export interface BonusLine { label: string; amount: number }

export interface BonusSlipInput {
  /** 명세서 귀속월 */
  period: Ym
  payments: readonly BonusLine[]
  dependents: number
  /** 상여 실제 지급일(YYYY-MM-DD) — 지급월로 지급대상기간을 정한다 */
  bonusPayDate: string | null
  /** 상여 항목별 지급대상기간 월수(항목명 → 월수). 없으면 지급대상기간 없는 상여 */
  bonusPeriods?: Record<string, number | null>
  /** 입사일 — 과세기간 중 입사면 계산하지 않음(세무 확인 필요) */
  hireDate?: string | null
  /** 같은 해 1월 ~ 지급 전달 자료 */
  history: readonly MonthRecord[]
  /** 검증용. 운영 화면은 넘기지 않음 → 운영 원천징수율(WITHHOLDING_MULTIPLIER) */
  ratio?: number
}

export interface BonusSlipCalc extends IncomeTaxCalc {
  regularTaxable: number
  bonusTotal: number
  regularTax: number | null
  bonusTax: number | null
  periodMonths: number | null
  steps: string[]
  /** 계산은 했지만 세무 확인이 필요한 점 */
  warnings: string[]
  /** 계산하지 못한 이유(필요한 자료) */
  errors: string[]
}

/** 상여 계산에 필요한 이전 달(같은 해 1월 ~ 지급 전달, 지급대상기간이 더 길면 그만큼) */
export function neededHistoryMonths(payMonth: Ym, periods: Record<string, number | null> = {}): Ym[] {
  const sinceJan = Number(payMonth.slice(5, 7))
  const fixed = Object.values(periods).filter((m): m is number => m != null).map(m => Math.min(12, Math.max(1, Math.ceil(m))))
  const need = Math.max(sinceJan, ...fixed)
  return Array.from({ length: need - 1 }, (_, i) => ymAdd(payMonth, -(need - 1) + i))
}

export function calcBonusSlipTax(input: BonusSlipInput): BonusSlipCalc {
  const { payments, dependents } = input
  const ratio = input.ratio ?? WITHHOLDING_MULTIPLIER
  const totalPayment = payments.reduce((s, p) => s + (p.amount || 0), 0)
  const bonuses = payments.filter(p => (p.amount || 0) !== 0 && isBonusLabel(p.label))
  const regularTaxable = payments.filter(p => !isBonusLabel(p.label)).reduce((s, p) => s + (p.amount || 0), 0)
  const bonusTotal = bonuses.reduce((s, p) => s + p.amount, 0)
  const errors: string[] = []
  const warnings: string[] = []
  const steps: string[] = []
  const fail = (regularTax: number | null = null): BonusSlipCalc => ({
    totalPayment, incomeTax: null, localTax: null, holdReason: 'bonus',
    regularTaxable, bonusTotal, regularTax, bonusTax: null, periodMonths: null, steps, warnings, errors,
  })

  if (bonuses.some(b => !Number.isFinite(b.amount) || b.amount < 0) || !Number.isFinite(regularTaxable) || regularTaxable < 0) {
    errors.push('지급 금액이 올바르지 않습니다')
    return fail()
  }
  const simpleRegular = lookupWithholdingTax(regularTaxable, dependents)
  const regularTax = simpleRegular == null ? null : round10(simpleRegular * ratio)
  if (regularTax == null) { errors.push('상여외 급여 세액을 계산할 수 없습니다'); return fail() }

  if (!isYmd(input.bonusPayDate)) { errors.push('상여·성과급 실제 지급일을 입력하세요 (지급한 달로 지급대상기간을 정함)'); return fail(regularTax) }
  const payMonth = input.bonusPayDate.slice(0, 7)
  if (payMonth !== input.period) {
    errors.push(`명세서 귀속월(${input.period})과 상여 지급월(${payMonth})이 다릅니다 — 지급대상기간에 넣을 급여 범위를 세무 확인 후 처리`)
    return fail(regularTax)
  }
  const year = payMonth.slice(0, 4)
  if (input.hireDate && input.hireDate.slice(0, 4) === year && input.hireDate > `${year}-01-01`) {
    errors.push(`과세기간 중 입사(${input.hireDate}) — 지급대상기간 판단은 세무 확인 후 처리`)
    return fail(regularTax)
  }

  const periods = input.bonusPeriods ?? {}
  const byMonth = new Map(input.history.map(r => [r.month, r]))
  // 지급월 자신의 행: 이번 명세서의 상여외 급여와 그 세액(이번 달에 함께 원천징수)
  byMonth.set(payMonth, { month: payMonth, regularTaxable, regularTaxWithheld: regularTax, bonusPaid: bonusTotal, verified: true })

  const isNoPeriod = (label: string) => periods[label] == null
  if (bonuses.some(b => isNoPeriod(b.label))) {
    // 직전 상여월에 따라 기간이 달라지므로 1월~지급 전달 전부 확인돼 있어야 한다
    for (let ym = `${year}-01`; ym < payMonth; ym = ymAdd(ym, 1)) {
      const r = input.history.find(h => h.month === ym)
      if (!r) errors.push(`${ym} 자료 없음 — 그 달 과세급여·실제 원천징수세액·상여 지급 여부 입력 필요`)
      else if (!r.verified) errors.push(`${ym} 미확인 — 원천세 신고·확정 급여대장과 대조 후 '확인' 표시 필요`)
    }
    if (errors.length) return fail(regularTax)
  }
  const priorBonusMonth = input.history
    .filter(r => r.month.startsWith(year) && r.month < payMonth && r.bonusPaid > 0)
    .map(r => r.month).sort().pop()
  const noPeriodStart = priorBonusMonth ? ymAdd(priorBonusMonth, 1) : `${year}-01`
  const noPeriodMonths = ymSpan(noPeriodStart, payMonth)
  const per = bonuses.map(b => isNoPeriod(b.label) ? noPeriodMonths : Math.min(12, Math.max(1, Math.ceil(periods[b.label]!))))
  const distinct = new Set(per)
  const periodMonths = distinct.size === 1 ? per[0] : Math.min(12, Math.ceil(per.reduce((s, m) => s + m, 0) / per.length))
  const periodStart = ymAdd(payMonth, -(periodMonths - 1))

  let regularSum = 0, withheldSum = 0
  for (let i = 0; i < periodMonths; i++) {
    const ym = ymAdd(periodStart, i)
    const r = byMonth.get(ym)
    if (!r || r.regularTaxable == null) { errors.push(`${ym} 과세급여 자료 없음`); continue }
    if (r.regularTaxWithheld == null) { errors.push(`${ym} 실제 원천징수세액 자료 없음`); continue }
    if (!r.verified) { errors.push(`${ym} 미확인 — 실제 자료와 대조 후 '확인' 표시 필요`); continue }
    if (ym !== payMonth && r.regularTaxWithheld === 0 && (lookupWithholdingTax(r.regularTaxable, dependents) ?? 0) > 0) {
      warnings.push(`${ym} 원천징수세액 0원 — 과세급여 ${won(r.regularTaxable)}이면 세액이 있어야 함(0원 오류 저장인지 실제 미징수인지 확인)`)
    }
    regularSum += r.regularTaxable
    withheldSum += r.regularTaxWithheld
  }
  if (errors.length) return fail(regularTax)

  const avg = (bonusTotal + regularSum) / periodMonths
  const simple = lookupWithholdingTax(avg, dependents)
  if (simple == null) { errors.push('월평균급여로 간이세액을 구할 수 없습니다'); return fail(regularTax) }
  const gross = simple * ratio * periodMonths
  const raw = gross - withheldSum
  const bonusTotalTax = raw <= 0 ? 0 : round10(raw)
  // 위 '기간 원천징수세액'에 이번 달 상여외 급여 세액(regularTax)이 들어 있으므로, 이번 달 소득세 = regularTax + bonusTotalTax
  const bonusTax = bonusTotalTax
  const incomeTax = regularTax + bonusTax
  // 지방소득세 = 각 원천징수 소득세(상여외 급여분·상여분)의 10% — 독립 계산기 검증 방식과 동일
  const localTax = round10(regularTax * 0.1) + round10(bonusTax * 0.1)
  if (raw < 0) warnings.push(`상여분 계산값이 음수(${won(raw)}) → 0원 처리(세무 확인 필요)`)
  if (ratio !== 1) warnings.push(`상여분에도 운영 원천징수율 ${Math.round(ratio * 100)}%를 곱했습니다 — 적용 여부 세무 확인 필요`)
  warnings.push(`${payMonth} 귀속 상여외 급여(${won(regularTaxable)})를 지급대상기간에 포함했습니다 — 실제 지급일이 다음 달이면 세무 확인 필요`)
  steps.push(
    `지급대상기간 ${periodStart}~${payMonth} (${periodMonths}개월)${priorBonusMonth ? ` — 직전 상여 ${priorBonusMonth} 다음 달부터` : ''}${distinct.size > 1 ? ` — 기간 ${per.join('+')} ÷ ${per.length}` : ''}`,
    `상여 ${won(bonusTotal)} + 기간 상여외 급여 ${won(regularSum)} = ${won(bonusTotal + regularSum)}`,
    `월평균급여 ${won(bonusTotal + regularSum)} ÷ ${periodMonths} = ${won(avg)}${avg >= 10_000_000 ? ' (1천만원 이상 → 별표2 계산식)' : ''}`,
    `간이세액 ${won(simple)} × ${Math.round(ratio * 100)}% × ${periodMonths}개월 = ${won(gross)}`,
    `− 기간 상여외 급여 원천징수세액 ${won(withheldSum)}(이번 달 ${won(regularTax)} 포함) = 상여분 ${won(bonusTax)}`,
    `이번 달 근로소득세 = 상여외 급여분 ${won(regularTax)} + 상여분 ${won(bonusTax)} = ${won(incomeTax)}, 지방소득세 ${won(localTax)}`,
  )
  return { totalPayment, incomeTax, localTax, holdReason: null, regularTaxable, bonusTotal, regularTax, bonusTax, periodMonths, steps, warnings, errors }
}

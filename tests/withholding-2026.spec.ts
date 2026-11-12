// 근로소득세 2026 간이세액표·120% 원천징수 검증 (합성 금액 + 홈택스 조회 기준값만 사용, 개인정보 없음)
// 실행: npx tsx --test tests/withholding-2026.spec.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { WITHHOLDING_TAX_TABLE } from '../src/utils/withholding-tax-table'
import {
  lookupWithholdingTax, calculateAutoDeductions, calcIncomeTax, applyIncomeTax, compareIncomeTax,
  WITHHOLDING_MULTIPLIER, NATIONAL_PENSION_RATE, HEALTH_INSURANCE_RATE, LONG_TERM_CARE_RATE_OF_HEALTH, EMPLOYMENT_INSURANCE_RATE,
} from '../src/utils/payroll-deductions'

interface Bracket { upTo: number | null; base: number; from: number; rate: number; plus: number }
const REF = JSON.parse(fs.readFileSync(new URL('./reference/withholding-tax-2026.json', import.meta.url), 'utf8')) as {
  rows: number[][]; taxAt10M: number[]; over10MBrackets: Bracket[]; withholdingRate: number
  hometaxCases: { name: string; monthlyTaxable: number; dependents: number; simpleTax100: number; incomeTax120: number; localTax: number }[]
}

// 기대값은 정수 연산으로 따로 계산(코드의 부동소수 계산과 독립)
const expIncome = (simple100: number) => Math.floor((simple100 * 12) / 100) * 10 // ×120% 후 10원 미만 절사
const expLocal = (income: number) => Math.floor(income / 100) * 10 // ×10% 후 10원 미만 절사
const refSimple = (won: number, fam: number): number => {
  if (won < 770_000) return 0
  if (won >= 10_000_000) {
    const base = REF.taxAt10M[fam - 1]
    if (won === 10_000_000) return base
    const b = REF.over10MBrackets.find(x => x.upTo == null || won <= x.upTo)!
    return base + b.base + (won - b.from) * b.rate + b.plus
  }
  const k = won / 1000
  const row = REF.rows.find(r => k >= r[0] && k < r[1])!
  return row[1 + fam]
}
const oldRound10 = (n: number) => Math.round(n / 10) * 10

test('홈택스 기준: 김민기 7,896,945원·가족 1명 → 100% 932,290 / 120% 1,118,740 / 지방 111,870', () => {
  for (const c of REF.hometaxCases) {
    assert.equal(lookupWithholdingTax(c.monthlyTaxable, c.dependents), c.simpleTax100, c.name)
    const a = calculateAutoDeductions(c.monthlyTaxable, c.dependents)
    assert.equal(a.근로소득세, c.incomeTax120, c.name)
    assert.equal(a.근로지방소득세, c.localTax, c.name)
    const calc = calcIncomeTax([{ label: '기본급', amount: c.monthlyTaxable }], c.dependents)
    assert.deepEqual([calc.incomeTax, calc.localTax, calc.holdReason], [c.incomeTax120, c.localTax, null])
  }
})

test('120% 원천징수율 유지', () => {
  assert.equal(WITHHOLDING_MULTIPLIER, 1.2)
  assert.equal(REF.withholdingRate, 1.2)
})

test('간이세액표 데이터가 2026 국세청 원본과 전 구간 일치', () => {
  assert.equal(WITHHOLDING_TAX_TABLE.length, REF.rows.length)
  assert.deepEqual(WITHHOLDING_TAX_TABLE, REF.rows)
  // 구간 연속성: 770천원 시작, 빈틈·겹침 없이 10,000천원까지
  assert.equal(REF.rows[0][0], 770)
  assert.equal(REF.rows.at(-1)![1], 10_000)
  for (let i = 1; i < REF.rows.length; i++) assert.equal(REF.rows[i][0], REF.rows[i - 1][1], `row ${i}`)
})

test('전 구간 × 가족 1~11명 × 경계값(이상·중간·미만-1원): 100%·120%·지방세', () => {
  let n = 0
  for (const r of REF.rows) {
    const lo = r[0] * 1000, hi = r[1] * 1000
    for (const won of [lo, Math.floor((lo + hi) / 2), hi - 1]) {
      for (let fam = 1; fam <= 11; fam++) {
        const simple = r[1 + fam]
        assert.equal(lookupWithholdingTax(won, fam), simple, `${won} fam${fam}`)
        const a = calculateAutoDeductions(won, fam)
        const inc = expIncome(simple)
        assert.equal(a.근로소득세, inc, `${won} fam${fam} 소득세`)
        assert.equal(a.근로지방소득세, expLocal(inc), `${won} fam${fam} 지방세`)
        n++
      }
    }
  }
  assert.equal(n, REF.rows.length * 3 * 11)
})

test('770천원 미만은 0원, 10,000천원 정확히는 표의 10,000천원 행', () => {
  for (let fam = 1; fam <= 11; fam++) {
    assert.equal(lookupWithholdingTax(769_999, fam), 0)
    assert.equal(calculateAutoDeductions(0, fam).근로소득세, 0)
    assert.equal(lookupWithholdingTax(9_999_999, fam), REF.rows.at(-1)![1 + fam])
    assert.equal(lookupWithholdingTax(10_000_000, fam), REF.taxAt10M[fam - 1])
    assert.equal(calculateAutoDeductions(10_000_000, fam).근로소득세, expIncome(REF.taxAt10M[fam - 1]))
  }
})

test('1,000만원 초과 별표2 계산식: 각 구간 경계 ±1원·중간값 × 가족 1~11명', () => {
  const points: number[] = [10_000_001, 10_192_308, 12_345_678]
  for (const b of REF.over10MBrackets) {
    points.push(b.from + 1)
    if (b.upTo != null) points.push(b.upTo, b.upTo + 1, Math.floor((b.from + b.upTo) / 2))
  }
  points.push(100_000_000)
  for (const won of points) for (let fam = 1; fam <= 11; fam++) {
    const simple = refSimple(won, fam)
    const got = lookupWithholdingTax(won, fam)!
    assert.ok(Math.abs(got - simple) < 1e-6, `${won} fam${fam} ${got} vs ${simple}`)
    const a = calculateAutoDeductions(won, fam)
    const inc = Math.floor(Math.round(simple * 1.2 * 1e6) / 1e7) * 10
    assert.equal(a.근로소득세, inc, `${won} fam${fam} 소득세`)
    assert.equal(a.근로지방소득세, expLocal(inc), `${won} fam${fam} 지방세`)
  }
  // 기존 확인값(10,192,308원·가족1) 유지
  assert.deepEqual([calculateAutoDeductions(10_192_308, 1).근로소득세, calculateAutoDeductions(10_192_308, 1).근로지방소득세], [1_918_030, 191_800])
})

test('가족 수 범위 밖 입력: 0명 이하 → 1명, 12명 이상 → 11명으로 처리(기존 동작 유지)', () => {
  assert.equal(lookupWithholdingTax(5_000_000, 0), lookupWithholdingTax(5_000_000, 1))
  assert.equal(lookupWithholdingTax(5_000_000, 15), lookupWithholdingTax(5_000_000, 11))
  assert.equal(lookupWithholdingTax(Number.NaN, 1), null)
  assert.equal(calculateAutoDeductions(-1, 1).근로소득세, null)
})

test('4대보험 계산 결과는 수정 전과 동일(10원 반올림 유지)', () => {
  for (let won = 0; won <= 20_000_000; won += 7_919) {
    const a = calculateAutoDeductions(won, 1)
    const 건강 = oldRound10(won * HEALTH_INSURANCE_RATE)
    assert.equal(a.국민연금, oldRound10(won * NATIONAL_PENSION_RATE))
    assert.equal(a.건강보험, 건강)
    assert.equal(a.장기요양보험, oldRound10(건강 * LONG_TERM_CARE_RATE_OF_HEALTH))
    assert.equal(a.고용보험, oldRound10(won * EMPLOYMENT_INSURANCE_RATE))
  }
})

test('상여·성과급·비과세 후보가 있으면 자동 계산하지 않고 기존 세액 보존', () => {
  const existing = [{ label: '근로소득세', amount: 123_450 }, { label: '근로지방소득세', amount: 12_340 }, { label: '국민연금', amount: 1 }]
  for (const extra of [{ label: '상여금', amount: 1_000_000 }, { label: '성과급', amount: 500_000 }, { label: '식대(비과세)', amount: 200_000 }]) {
    const calc = calcIncomeTax([{ label: '기본급', amount: 3_000_000 }, extra], 1)
    assert.equal(calc.incomeTax, null)
    assert.notEqual(calc.holdReason, null)
    assert.deepEqual(applyIncomeTax(existing, calc), existing)
  }
})

// ── 세액 차이 안내(compareIncomeTax) — 저장 뒤 지급액이 바뀐 명세서 ──
// 사례 금액: 저장 당시 지급액 7,728,693원(기본급+상여금+성과금) → 수당 168,252원 추가 → 7,896,945원, 가족 1명
const CASE_BEFORE = [{ label: '기본급', amount: 3_091_477 }, { label: '상여금', amount: 1_545_739 }, { label: '성과금', amount: 3_091_477 }]
const CASE_AFTER = [...CASE_BEFORE, { label: '연장근로수당', amount: 96_144 }, { label: '휴일근로수당', amount: 72_108 }]
const CASE_SAVED_TAX = [{ label: '근로소득세', amount: 1_075_200 }, { label: '근로지방소득세', amount: 107_520 }, { label: '국민연금', amount: 100_000 }]
const plain = (items: { label: string; amount: number }[]) => [{ label: '기본급', amount: items.reduce((s, p) => s + p.amount, 0) }]

test('사례 검산: 7,728,693원 → 1,075,200 / 107,520, 7,896,945원 → 1,118,740 / 111,870 (간이세액표 × 120%, 10원 미만 절사)', () => {
  const before = calculateAutoDeductions(7_728_693, 1)
  assert.deepEqual([before.근로소득세, before.근로지방소득세], [1_075_200, 107_520])
  const after = calculateAutoDeductions(7_896_945, 1)
  assert.deepEqual([after.근로소득세, after.근로지방소득세], [1_118_740, 111_870])
  assert.equal(CASE_AFTER.reduce((s, p) => s + p.amount, 0), 7_896_945)
})

test('상여·성과급 포함 명세서: 저장 세액을 바꾸지 않고 참고값만 돌려준다', () => {
  // 자동 계산은 여전히 하지 않는다(기존 보호 규칙)
  const calc = calcIncomeTax(CASE_AFTER, 1)
  assert.equal(calc.incomeTax, null)
  assert.equal(calc.holdReason, 'bonus')
  assert.deepEqual(applyIncomeTax(CASE_SAVED_TAX, calc), CASE_SAVED_TAX)
  const diff = compareIncomeTax(CASE_AFTER, CASE_SAVED_TAX, 1)
  assert.deepEqual(diff, {
    kind: 'bonus-reference', totalPayment: 7_896_945,
    current: { incomeTax: 1_075_200, localTax: 107_520 },
    calculated: { incomeTax: 1_118_740, localTax: 111_870 },
  })
})

test('일반 급여: 지급액이 바뀌어 저장 세액과 계산값이 다르면 mismatch, 확인 후 적용하면 세액 두 줄만 바뀐다', () => {
  const pays = plain(CASE_AFTER) // 같은 금액이지만 상여 항목 없음
  const diff = compareIncomeTax(pays, CASE_SAVED_TAX, 1)
  assert.equal(diff?.kind, 'mismatch')
  assert.deepEqual(diff?.calculated, { incomeTax: 1_118_740, localTax: 111_870 })
  const applied = applyIncomeTax(CASE_SAVED_TAX, calcIncomeTax(pays, 1))
  assert.deepEqual(applied, [{ label: '근로소득세', amount: 1_118_740 }, { label: '근로지방소득세', amount: 111_870 }, { label: '국민연금', amount: 100_000 }])
  assert.equal(compareIncomeTax(pays, applied, 1), null) // 적용 뒤에는 안내 없음
})

test('세액이 계산값과 같으면 안내 없음 / 비과세 후보 항목이 있으면 비교하지 않음 / 세액 줄이 없으면 비교하지 않음', () => {
  assert.equal(compareIncomeTax(plain(CASE_BEFORE), CASE_SAVED_TAX, 1), null)
  assert.equal(compareIncomeTax(CASE_BEFORE, CASE_SAVED_TAX, 1), null) // 상여 포함이지만 참고값과 같음
  assert.equal(compareIncomeTax([...plain(CASE_AFTER), { label: '식대', amount: 200_000 }], CASE_SAVED_TAX, 1), null)
  assert.equal(compareIncomeTax([...CASE_AFTER, { label: '식대', amount: 200_000 }], CASE_SAVED_TAX, 1), null)
  assert.equal(compareIncomeTax(plain(CASE_AFTER), [{ label: '국민연금', amount: 100_000 }], 1), null)
})

test('10원 반올림 시절 저장된 세액(1,118,750 / 111,880)은 일반 급여에서 mismatch로 안내된다', () => {
  const old = [{ label: '근로소득세', amount: 1_118_750 }, { label: '근로지방소득세', amount: 111_880 }]
  const diff = compareIncomeTax(plain(CASE_AFTER), old, 1)
  assert.deepEqual(diff?.calculated, { incomeTax: 1_118_740, localTax: 111_870 })
})

// [4대보험 고지액 일괄반영] 계산 검증 (가상 인물·금액만 사용, 개인정보 없음)
// 실행: npx tsx --test tests/insurance-bulk-apply.spec.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planInsuranceBulkApply, REASON_NO_SLIP, REASON_FILE_SLIP, REASON_DUPLICATE_NAME, REASON_UNKNOWN_EMPLOYEE,
  type BulkApplySlip, type BulkApplyEmployee,
} from '../src/utils/insurance-bulk-apply'
import type { InsuranceRow } from '../src/utils/insurance-csv'

const emp = (id: string, name: string, is_active = true): BulkApplyEmployee => ({ id, name, is_active })
const PAYS = [{ 항목: '기본급', 금액: 3_000_000 }, { 항목: '연장근로수당', 금액: 225_000, 시간: 7.5 }]
const DEDS = () => [
  { 항목: '근로소득세', 금액: 77_770, 산출근거: { 메모: '보존 확인용' } },
  { 항목: '근로지방소득세', 금액: 7_770 },
  { 항목: '국민연금', 금액: 100_000 },
  { 항목: '건강보험', 금액: 90_000 },
  { 항목: '장기요양보험', 금액: 11_000 },
  { 항목: '고용보험', 금액: 25_000 },
  { 항목: '기타공제', 금액: 5_000 },
]
const slip = (empId: string, over: Partial<BulkApplySlip> = {}): BulkApplySlip => {
  const 공제내역 = DEDS()
  return { id: `ps-${empId}`, employee_id: empId, file_path: null, 지급내역: PAYS, 지급합계: 3_225_000, 공제내역, ...over }
}
const NOTICE: InsuranceRow = { nationalPension: 142_500, health: 107_850, longTermCare: 14_170, employment: 27_000 }
const sum = (list: Array<{ 금액: number }>) => list.reduce((s, d) => s + d.금액, 0)

test('작성 상태와 관계없이(작성완료·되돌린 명세서 모두) 4대보험 4개 항목만 고지액으로 바뀐다', () => {
  const employees = [emp('a', '가상완료'), emp('b', '가상되돌림')]
  // 계산 함수는 유형을 보지 않는다 — 작성완료(generated)든 미작성으로 되돌린(null) 명세서든 같은 입력
  const plan = planInsuranceBulkApply({
    slips: [slip('a'), slip('b')], employees,
    notice: { 가상완료: NOTICE, 가상되돌림: NOTICE }, employmentUploaded: true,
  })
  assert.equal(plan.updates.length, 2)
  for (const u of plan.updates) {
    assert.deepEqual(u.changes, [
      { label: '국민연금', from: 100_000, to: 142_500 },
      { label: '건강보험', from: 90_000, to: 107_850 },
      { label: '장기요양보험', from: 11_000, to: 14_170 },
      { label: '고용보험', from: 25_000, to: 27_000 },
    ])
    const deds = u.patch.공제내역!
    // 소득세·지방소득세·기타공제는 그대로, 산출근거도 보존
    assert.deepEqual(deds[0], { 항목: '근로소득세', 금액: 77_770, 산출근거: { 메모: '보존 확인용' } })
    assert.deepEqual(deds[1], { 항목: '근로지방소득세', 금액: 7_770 })
    assert.deepEqual(deds[6], { 항목: '기타공제', 금액: 5_000 })
    // 공제합계·실지급액
    assert.equal(u.patch.공제합계, 77_770 + 7_770 + 142_500 + 107_850 + 14_170 + 27_000 + 5_000)
    assert.equal(u.patch.공제합계, sum(deds))
    assert.equal(u.patch.실지급액, 3_225_000 - u.patch.공제합계)
    // 저장 대상은 공제내역·공제합계·실지급액뿐 (지급내역·지급합계·유형·근로시간 등은 보내지 않는다)
    assert.deepEqual(Object.keys(u.patch).sort(), ['공제내역', '공제합계', '실지급액'].sort())
  }
  assert.deepEqual(plan.unmatchedNames, [])
  assert.deepEqual(plan.excluded, [])
})

test('입력으로 받은 명세서 객체는 변경하지 않는다', () => {
  const s = slip('a')
  const before = JSON.stringify(s)
  planInsuranceBulkApply({ slips: [s], employees: [emp('a', '가상완료')], notice: { 가상완료: NOTICE }, employmentUploaded: true })
  assert.equal(JSON.stringify(s), before)
})

test('고지서에 없는 직원은 기존 값을 유지하고 미매칭으로 표시된다', () => {
  const plan = planInsuranceBulkApply({
    slips: [slip('a'), slip('d')], employees: [emp('a', '가상완료'), emp('d', '가상미고지'), emp('n', '가상미고지무명세')],
    notice: { 가상완료: NOTICE }, employmentUploaded: true,
  })
  assert.deepEqual(plan.updates.map(u => u.name), ['가상완료'])
  assert.deepEqual(plan.unmatchedNames, ['가상미고지', '가상미고지무명세'])
  assert.deepEqual(plan.excluded, [])
})

test('명세서가 없는 직원은 새로 만들지 않고 "작성 시 자동 반영"으로 제외된다', () => {
  const plan = planInsuranceBulkApply({
    slips: [], employees: [emp('c', '가상없음')], notice: { 가상없음: NOTICE }, employmentUploaded: true,
  })
  assert.equal(plan.updates.length, 0)
  assert.deepEqual(plan.excluded, [{ name: '가상없음', reason: REASON_NO_SLIP }])
})

test('퇴사자(비활성)는 명세서가 없으면 대상에 넣지 않고, 명세서가 있으면 반영한다', () => {
  const employees = [emp('x', '가상퇴사무명세', false), emp('y', '가상퇴사유명세', false)]
  const plan = planInsuranceBulkApply({
    slips: [slip('y')], employees, notice: { 가상퇴사무명세: NOTICE, 가상퇴사유명세: NOTICE }, employmentUploaded: true,
  })
  assert.deepEqual(plan.updates.map(u => u.name), ['가상퇴사유명세'])
  assert.deepEqual(plan.excluded, [])
  assert.deepEqual(plan.unmatchedNames, [])
})

test('파일로 등록된 명세서(공제항목 없음)는 제외 사유와 함께 건너뛴다', () => {
  const plan = planInsuranceBulkApply({
    slips: [slip('f', { file_path: 'f/2026-10.pdf', 지급내역: null, 공제내역: null, 지급합계: null })],
    employees: [emp('f', '가상파일')], notice: { 가상파일: NOTICE }, employmentUploaded: true,
  })
  assert.equal(plan.updates.length, 0)
  assert.deepEqual(plan.excluded, [{ name: '가상파일', reason: REASON_FILE_SLIP }])
})

test('동명이인은 이름으로 구분할 수 없으므로 반영하지 않는다', () => {
  const plan = planInsuranceBulkApply({
    slips: [slip('k1'), slip('k2')], employees: [emp('k1', '가상동명'), emp('k2', '가상동명')],
    notice: { 가상동명: NOTICE }, employmentUploaded: true,
  })
  assert.equal(plan.updates.length, 0)
  assert.deepEqual(plan.excluded, [
    { name: '가상동명', reason: REASON_DUPLICATE_NAME },
    { name: '가상동명', reason: REASON_DUPLICATE_NAME },
  ])
})

test('직원 명단에 없는 명세서·고지서 이름은 반영하지 않고 따로 알려준다', () => {
  const plan = planInsuranceBulkApply({
    slips: [slip('ghost')], employees: [emp('a', '가상완료')],
    notice: { 가상완료: NOTICE, 가상외부인: NOTICE }, employmentUploaded: true,
  })
  assert.equal(plan.updates.length, 0)
  assert.deepEqual(plan.excluded, [
    { name: '(알 수 없음)', reason: REASON_UNKNOWN_EMPLOYEE },
    { name: '가상완료', reason: REASON_NO_SLIP },
  ])
  assert.deepEqual(plan.unknownNoticeNames, ['가상외부인'])
})

test('고용보험: 파일을 올렸는데 명단에 없으면 비대상 0원, 파일을 안 올렸으면 기존 값 유지', () => {
  const partial: InsuranceRow = { nationalPension: 142_500, health: 107_850, longTermCare: 14_170 }
  const base = { slips: [slip('a')], employees: [emp('a', '가상완료')], notice: { 가상완료: partial } }
  const uploaded = planInsuranceBulkApply({ ...base, employmentUploaded: true })
  assert.deepEqual(uploaded.updates[0].changes.find(c => c.label === '고용보험'), { label: '고용보험', from: 25_000, to: 0 })
  const notUploaded = planInsuranceBulkApply({ ...base, employmentUploaded: false })
  assert.equal(notUploaded.updates[0].changes.find(c => c.label === '고용보험'), undefined)
  assert.equal(notUploaded.updates[0].patch.공제내역!.find(d => d.항목 === '고용보험')!.금액, 25_000)
})

test('일부 보험만 올린 경우 올린 항목만 바뀐다', () => {
  const plan = planInsuranceBulkApply({
    slips: [slip('a')], employees: [emp('a', '가상완료')],
    notice: { 가상완료: { nationalPension: 142_500 } }, employmentUploaded: false,
  })
  assert.deepEqual(plan.updates[0].changes, [{ label: '국민연금', from: 100_000, to: 142_500 }])
})

test('다시 실행해도 결과가 같다(이미 반영된 명세서는 변동 없음)', () => {
  const employees = [emp('a', '가상완료')]
  const notice = { 가상완료: NOTICE }
  const first = planInsuranceBulkApply({ slips: [slip('a')], employees, notice, employmentUploaded: true })
  const applied = slip('a', { 공제내역: first.updates[0].patch.공제내역 })
  const second = planInsuranceBulkApply({ slips: [applied], employees, notice, employmentUploaded: true })
  assert.equal(second.updates.length, 0)
  assert.deepEqual(second.unchangedNames, ['가상완료'])
})

test('지급합계가 비어 있으면 지급내역 합으로 실지급액을 계산한다', () => {
  const plan = planInsuranceBulkApply({
    slips: [slip('a', { 지급합계: null })], employees: [emp('a', '가상완료')], notice: { 가상완료: NOTICE }, employmentUploaded: true,
  })
  assert.equal(plan.updates[0].patch.실지급액, 3_225_000 - plan.updates[0].patch.공제합계)
})

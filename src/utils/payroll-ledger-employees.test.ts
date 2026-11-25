import { describe, it, expect } from 'vitest'
import { ledgerEmployees } from './payroll-ledger-employees'
import { planInsuranceBulkApply } from './insurance-bulk-apply'

const emp = (id: string, is_active: boolean) => ({ id, name: id, is_active })
const employees = [emp('재직', true), emp('퇴직', false)]

describe('급여대장 직원 목록', () => {
  it('그 달 명세서가 있는 퇴직자는 올라온다', () => {
    expect(ledgerEmployees(employees, { 퇴직: { 유형: 'generated' } }).map(e => e.id)).toEqual(['재직', '퇴직'])
  })

  it('업로드 파일만 있거나 미작성으로 되돌린 명세서도 올라온다', () => {
    expect(ledgerEmployees(employees, { 퇴직: { 유형: null, file_path: 'a.pdf' } })).toHaveLength(2)
    expect(ledgerEmployees(employees, { 퇴직: { 유형: null, file_path: null } })).toHaveLength(2)
  })

  it('명세서가 없는 달에는 퇴직자를 올리지 않는다', () => {
    expect(ledgerEmployees(employees, {}).map(e => e.id)).toEqual(['재직'])
  })

  it('보험료 일괄반영은 명세서 없는 퇴직자를 대상으로 삼지 않는다 (기존 동작)', () => {
    const plan = planInsuranceBulkApply({ slips: [], employees, notice: {}, employmentUploaded: false })
    expect(plan.unmatchedNames).toEqual(['재직'])
  })
})

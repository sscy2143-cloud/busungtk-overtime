import type { InsuranceRow } from './insurance-csv'

/** [4대보험 고지액 일괄반영] 계산 — DB를 건드리지 않는 순수 함수(무엇을 어떻게 바꿀지만 정한다) */

export interface BulkApplySlip {
  id: string
  employee_id: string
  file_path?: string | null
  지급합계: number | null
  지급내역: Array<{ 항목: string; 금액: number }> | null
  // 공제내역 줄의 다른 속성(예: 근로소득세 산출근거)은 그대로 보존한다
  공제내역: Array<{ 항목: string; 금액: number; [key: string]: unknown }> | null
}

export interface BulkApplyEmployee {
  id: string
  name: string
  is_active: boolean
}

export interface BulkApplyChange { label: string; from: number; to: number }

export interface BulkApplyUpdate {
  slipId: string
  name: string
  changes: BulkApplyChange[]
  patch: { 공제내역: BulkApplySlip['공제내역']; 공제합계: number; 실지급액: number }
}

export interface BulkApplyPlan {
  /** 고지액으로 바뀌는 명세서 */
  updates: BulkApplyUpdate[]
  /** 고지서에 있지만 이미 같은 금액이라 바꿀 것이 없는 직원 */
  unchangedNames: string[]
  /** 고지서에 이름이 없는 직원 — 기존 값 유지 */
  unmatchedNames: string[]
  /** 고지서에는 있지만 반영하지 않은 직원과 그 이유 */
  excluded: Array<{ name: string; reason: string }>
  /** 고지서에는 있는데 직원 명단에 없는 이름 */
  unknownNoticeNames: string[]
}

export const INSURANCE_LABELS = ['국민연금', '건강보험', '장기요양보험', '고용보험'] as const

export const REASON_NO_SLIP = '명세서 없음 — 새로 작성할 때 자동 반영'
export const REASON_FILE_SLIP = '파일로 등록된 명세서 — 공제항목이 없어 반영 불가'
export const REASON_DUPLICATE_NAME = '같은 이름의 직원이 2명 이상 — 이름으로 구분할 수 없어 직접 입력 필요'
export const REASON_UNKNOWN_EMPLOYEE = '직원 정보를 찾을 수 없음'

/** 고지액 → 공제항목 금액. 반영할 값이 없으면 null(그 줄은 그대로 둔다) */
function noticeAmount(label: string, match: InsuranceRow, employmentUploaded: boolean): number | null {
  if (label === '건강보험') return match.health ?? null
  if (label === '장기요양보험') return match.longTermCare ?? null
  if (label === '국민연금') return match.nationalPension ?? null
  if (label === '고용보험') {
    if (match.employment != null) return match.employment
    // 고용보험 파일은 대상자만 명단에 오르므로, 그 파일을 올렸는데 이름이 없으면 비대상자로 보고 0원 처리
    return employmentUploaded ? 0 : null
  }
  return null
}

export function planInsuranceBulkApply(input: {
  /** 해당 귀속월의 명세서 전부(작성 상태 무관) */
  slips: BulkApplySlip[]
  employees: BulkApplyEmployee[]
  /** 직원명 → 업로드한 고지액 */
  notice: Record<string, InsuranceRow>
  /** 고용보험 고지 파일을 올렸는지 */
  employmentUploaded: boolean
}): BulkApplyPlan {
  const { slips, employees, notice, employmentUploaded } = input
  const plan: BulkApplyPlan = { updates: [], unchangedNames: [], unmatchedNames: [], excluded: [], unknownNoticeNames: [] }

  const empById = new Map(employees.map(e => [e.id, e]))
  const nameCount = new Map<string, number>()
  for (const e of employees) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1)

  // 명세서가 있는 직원 + 명세서가 아직 없는 재직 직원
  const slipByEmpId = new Map(slips.map(s => [s.employee_id, s]))
  const targetIds = [
    ...slips.map(s => s.employee_id),
    ...employees.filter(e => e.is_active && !slipByEmpId.has(e.id)).map(e => e.id),
  ]

  for (const empId of targetIds) {
    const emp = empById.get(empId)
    const slip = slipByEmpId.get(empId)
    if (!emp) { plan.excluded.push({ name: '(알 수 없음)', reason: REASON_UNKNOWN_EMPLOYEE }); continue }
    const match = notice[emp.name]
    if (!match) { plan.unmatchedNames.push(emp.name); continue }
    if ((nameCount.get(emp.name) ?? 0) > 1) { plan.excluded.push({ name: emp.name, reason: REASON_DUPLICATE_NAME }); continue }

    const deductions = slip?.공제내역 ?? []
    if (!slip || deductions.length === 0) {
      plan.excluded.push({ name: emp.name, reason: slip?.file_path ? REASON_FILE_SLIP : REASON_NO_SLIP })
      continue
    }

    const changes: BulkApplyChange[] = []
    const nextDeductions = deductions.map(d => {
      const to = noticeAmount(d.항목, match, employmentUploaded)
      if (to == null || to === d.금액) return d
      changes.push({ label: d.항목, from: d.금액 || 0, to })
      return { ...d, 금액: to }
    })
    if (changes.length === 0) { plan.unchangedNames.push(emp.name); continue }

    const 공제합계 = nextDeductions.reduce((s, d) => s + (d.금액 || 0), 0)
    const 지급합계 = slip.지급합계 ?? (slip.지급내역 ?? []).reduce((s, p) => s + (p.금액 || 0), 0)
    plan.updates.push({
      slipId: slip.id,
      name: emp.name,
      changes,
      patch: { 공제내역: nextDeductions, 공제합계, 실지급액: 지급합계 - 공제합계 },
    })
  }

  const employeeNames = new Set(employees.map(e => e.name))
  plan.unknownNoticeNames = Object.keys(notice).filter(n => !employeeNames.has(n))
  return plan
}

import { useState, useEffect } from 'react'
import { Calculator, DollarSign, Receipt, X, Edit3, Check, XCircle } from 'lucide-react'
import type { Employee, Expense, ExpenseCategory, OvertimeRequest } from '../types'
import { EXPENSE_CATEGORY_LABEL } from '../types'
import { StatusBadge } from '../components/common/StatusBadge'
import { supabase } from '../lib/supabase'

const PAY_MULTIPLIER = {
  extended: 1.5,
  night_overlap: 2.0,
  holiday_base: 1.5,
  holiday_over8: 2.0,
}

const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  meal: 'bg-orange-50 text-orange-700',
  transport: 'bg-blue-50 text-blue-700',
  supplies: 'bg-green-50 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

interface WageEditModal {
  open: boolean
  employee: Employee | null
  wage: string
}

interface RejectModal {
  open: boolean
  id: string
  reason: string
}

interface PayrollRow {
  employee: Employee
  extendedHours: number
  nightHours: number
  holidayHours: number
  totalPay: number
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return mins / 60
}

export function AdminPayrollPage() {
  const [tab, setTab] = useState<'payroll' | 'wages' | 'expenses'>('payroll')
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [employees, setEmployees] = useState<Employee[]>([])
  const [overtimeData, setOvertimeData] = useState<(OvertimeRequest & { employee: Employee })[]>([])
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [wageModal, setWageModal] = useState<WageEditModal>({ open: false, employee: null, wage: '' })
  const [rejectModal, setRejectModal] = useState<RejectModal>({ open: false, id: '', reason: '' })

  useEffect(() => {
    fetchEmployees()
  }, [])

  useEffect(() => {
    fetchOvertimeData()
  }, [month])

  async function fetchEmployees() {
    const { data, error } = await supabase.rpc('list_all_employees')
    if (!error && data) {
      setEmployees(data as Employee[])
    }
  }

  async function fetchOvertimeData() {
    const startDate = `${month}-01`
    const endOfMonth = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0)
    const endDate = `${month}-${String(endOfMonth.getDate()).padStart(2, '0')}`

    const { data, error } = await supabase
      .from('overtime_requests')
      .select('*, employee:employees!overtime_requests_employee_id_fkey(id, name, department, hourly_wage)')
      .eq('status', 'approved')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })

    if (!error && data) {
      setOvertimeData(data as (OvertimeRequest & { employee: Employee })[])
    }
  }

  function calculatePayroll(): PayrollRow[] {
    const map = new Map<string, PayrollRow>()

    for (const req of overtimeData) {
      const emp = req.employee
      if (!emp) continue

      const hours = calcHours(req.planned_start, req.planned_end)

      let multiplier: number
      let extendedHours = 0
      let nightHours = 0
      let holidayHours = 0

      if (req.type === 'extended') {
        multiplier = PAY_MULTIPLIER.extended
        extendedHours = hours
      } else if (req.type === 'night') {
        multiplier = PAY_MULTIPLIER.night_overlap
        nightHours = hours
      } else {
        multiplier = PAY_MULTIPLIER.holiday_base
        holidayHours = hours
      }

      const pay = hours * emp.hourly_wage * multiplier

      if (map.has(emp.id)) {
        const row = map.get(emp.id)!
        row.extendedHours += extendedHours
        row.nightHours += nightHours
        row.holidayHours += holidayHours
        row.totalPay += pay
      } else {
        map.set(emp.id, {
          employee: emp,
          extendedHours,
          nightHours,
          holidayHours,
          totalPay: pay,
        })
      }
    }

    return Array.from(map.values())
  }

  function openWageEdit(emp: Employee) {
    setWageModal({ open: true, employee: emp, wage: String(emp.hourly_wage) })
  }

  async function saveWage() {
    if (!wageModal.employee || !wageModal.wage) return
    const { error } = await supabase
      .from('employees')
      .update({ hourly_wage: Number(wageModal.wage) })
      .eq('id', wageModal.employee.id)

    if (!error) {
      setEmployees(prev => prev.map(e =>
        e.id === wageModal.employee!.id ? { ...e, hourly_wage: Number(wageModal.wage) } : e,
      ))
    }
    setWageModal({ open: false, employee: null, wage: '' })
  }

  function approveExpense(id: string) {
    setExpenses((prev) => prev.map((e) => e.id === id ? { ...e, status: 'approved' as const, approved_at: new Date().toISOString() } : e))
  }

  function openRejectExpense(id: string) {
    setRejectModal({ open: true, id, reason: '' })
  }

  function confirmRejectExpense() {
    setExpenses((prev) => prev.map((e) =>
      e.id === rejectModal.id
        ? { ...e, status: 'rejected' as const, rejection_reason: rejectModal.reason }
        : e,
    ))
    setRejectModal({ open: false, id: '', reason: '' })
  }

  function formatWon(amount: number): string {
    return new Intl.NumberFormat('ko-KR').format(amount) + '원'
  }

  const pendingExpenses = expenses.filter((e) => e.status === 'pending')
  const approvedExpenses = expenses.filter((e) => e.status === 'approved')
  const totalPending = pendingExpenses.reduce((s, e) => s + e.amount, 0)
  const totalApproved = approvedExpenses.reduce((s, e) => s + e.amount, 0)

  const payrollRows = calculatePayroll()
  const filteredRows = selectedEmployee === 'all'
    ? payrollRows
    : payrollRows.filter(r => r.employee.id === selectedEmployee)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">급여 계산</h1>
        <p className="text-sm text-gray-500 mt-0.5">야근 수당, 시급, 경비를 관리합니다</p>
      </div>

      {/* 탭 */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => setTab('payroll')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'payroll' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          <Calculator className="w-4 h-4" />
          수당 계산
        </button>
        <button
          onClick={() => setTab('wages')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'wages' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          시급 관리
        </button>
        <button
          onClick={() => setTab('expenses')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'expenses' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          <Receipt className="w-4 h-4" />
          경비 정산
          {pendingExpenses.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs bg-warning-500 text-white rounded-full">
              {pendingExpenses.length}
            </span>
          )}
        </button>
      </div>

      {/* 수당 계산 탭 */}
      {tab === 'payroll' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-medium text-gray-700">기간</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="all">전체</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>

          <div className="bg-blue-50 rounded-2xl p-4">
            <p className="text-xs font-semibold text-blue-700 mb-2">수당 배율 기준 (근로기준법)</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-blue-600">
              <span>연장근로: 시급 x {PAY_MULTIPLIER.extended}</span>
              <span>야간근로 (연장 중복): 시급 x {PAY_MULTIPLIER.night_overlap}</span>
              <span>휴일근로 (8h 이내): 시급 x {PAY_MULTIPLIER.holiday_base}</span>
              <span>휴일근로 (8h 초과): 시급 x {PAY_MULTIPLIER.holiday_over8}</span>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
              <Calculator className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">수당 데이터가 없습니다</p>
              <p className="text-xs text-gray-400">직원들의 야근 제출 데이터가 쌓이면 여기에 표시됩니다</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">이름</th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">시급</th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">연장</th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">야간</th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">휴일</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">총 수당</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRows.map((row) => (
                    <tr key={row.employee.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{row.employee.name}</p>
                        <p className="text-xs text-gray-400">{row.employee.department || '-'}</p>
                      </td>
                      <td className="px-3 py-3 text-center text-gray-600">{formatWon(row.employee.hourly_wage)}</td>
                      <td className="px-3 py-3 text-center text-gray-600">
                        {row.extendedHours > 0 ? `${row.extendedHours.toFixed(1)}h` : '-'}
                      </td>
                      <td className="px-3 py-3 text-center text-gray-600">
                        {row.nightHours > 0 ? `${row.nightHours.toFixed(1)}h` : '-'}
                      </td>
                      <td className="px-3 py-3 text-center text-gray-600">
                        {row.holidayHours > 0 ? `${row.holidayHours.toFixed(1)}h` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{formatWon(Math.round(row.totalPay))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 시급 관리 탭 */}
      {tab === 'wages' && (
        <div>
          {employees.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
              <DollarSign className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">등록된 직원이 없습니다</p>
              <p className="text-xs text-gray-400">사용자 관리에서 직원을 등록하면 시급을 설정할 수 있습니다</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">이름</th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500">부서</th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">포지션</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500">시급</th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">수정</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{emp.name}</p>
                        <p className="text-xs text-gray-400">{emp.email}</p>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{emp.department || '-'}</td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {emp.role === 'employee' ? '직원' : emp.role === 'manager' ? '인사담당' : '대표'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-gray-900">{formatWon(emp.hourly_wage)}</td>
                      <td className="px-3 py-3 text-center">
                        <button onClick={() => openWageEdit(emp)} className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 경비 정산 탭 */}
      {tab === 'expenses' && (
        <div className="space-y-4">
          {/* 경비 요약 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1">승인 대기</p>
              <p className="text-xl font-bold text-warning-600">{formatWon(totalPending)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{pendingExpenses.length}건</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1">이번 달 승인</p>
              <p className="text-xl font-bold text-success-600">{formatWon(totalApproved)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{approvedExpenses.length}건</p>
            </div>
          </div>

          {/* 경비 목록 */}
          {expenses.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
              <Receipt className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">제출된 경비가 없습니다</p>
              <p className="text-xs text-gray-400">직원들이 경비를 제출하면 여기에 표시됩니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {expenses.map((exp) => (
                <div key={exp.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-primary-700">
                          {exp.employee?.name?.charAt(0) ?? '?'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900">{exp.employee?.name ?? '직원'}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLOR[exp.category]}`}>
                            {EXPENSE_CATEGORY_LABEL[exp.category]}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(exp.date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                          <span className="mx-1">·</span>
                          {exp.description}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatWon(exp.amount)}</p>
                      <StatusBadge status={exp.status} />
                    </div>
                  </div>

                  {exp.status === 'pending' && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => approveExpense(exp.id)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold bg-success-500 text-white rounded-lg hover:bg-success-600 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        승인
                      </button>
                      <button
                        onClick={() => openRejectExpense(exp.id)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold bg-white text-danger-600 border border-danger-300 rounded-lg hover:bg-danger-50 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        반려
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 시급 수정 모달 */}
      {wageModal.open && wageModal.employee && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setWageModal({ open: false, employee: null, wage: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">시급 수정</h3>
              <button onClick={() => setWageModal({ open: false, employee: null, wage: '' })}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4"><span className="font-semibold">{wageModal.employee.name}</span>의 시급을 수정합니다</p>
            <div className="relative">
              <input type="number" value={wageModal.wage} onChange={(e) => setWageModal((p) => ({ ...p, wage: e.target.value }))} className="w-full px-3 py-3 pr-10 text-lg font-bold text-gray-900 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 text-right" min="0" step="100" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">원</span>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setWageModal({ open: false, employee: null, wage: '' })} className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">취소</button>
              <button onClick={saveWage} disabled={!wageModal.wage || Number(wageModal.wage) < 0} className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 경비 반려 모달 */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRejectModal({ open: false, id: '', reason: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">경비 반려 사유</h3>
              <button onClick={() => setRejectModal({ open: false, id: '', reason: '' })}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={3}
              placeholder="반려 사유를 입력하세요"
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((p) => ({ ...p, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setRejectModal({ open: false, id: '', reason: '' })} className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">취소</button>
              <button onClick={confirmRejectExpense} disabled={!rejectModal.reason.trim()} className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 disabled:opacity-40 transition-colors">반려</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Edit2, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

function fmtWon(amount: number) {
  return `${Math.round(amount).toLocaleString('ko-KR')}원`
}

interface LeavePayRow {
  empId: string
  name: string
  department: string
  dbWage: number
  totalDays: number
  usedDays: number
  remainingDays: number
}

export function AdminLeavePayPage() {
  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [rows, setRows] = useState<LeavePayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [wageOverrides, setWageOverrides] = useState<Record<string, number>>({})
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  useEffect(() => {
    setLoading(true)
    supabase
      .from('leave_balances')
      .select('employee_id, total_days, used_days, remaining_days, employee:employees!leave_balances_employee_id_fkey(id, name, department, hourly_wage)')
      .eq('year', calYear)
      .then(({ data }) => {
        if (data) {
          setRows(data.map((r: any) => ({
            empId: r.employee_id,
            name: r.employee?.name ?? '알 수 없음',
            department: r.employee?.department ?? '',
            dbWage: r.employee?.hourly_wage ?? 0,
            totalDays: r.total_days,
            usedDays: r.used_days,
            remainingDays: r.remaining_days,
          })).sort((a: LeavePayRow, b: LeavePayRow) => b.remainingDays - a.remainingDays))
        }
        setLoading(false)
      })
  }, [calYear])

  function getWage(empId: string, dbWage: number) {
    return wageOverrides[empId] ?? dbWage
  }

  // 연차수당 = 미사용 연차일수 × (시급 × 8시간)
  function calcPay(row: LeavePayRow) {
    const wage = getWage(row.empId, row.dbWage)
    return row.remainingDays * wage * 8
  }

  function startEdit(empId: string, currentWage: number) {
    setEditingEmpId(empId)
    setEditingValue(currentWage > 0 ? String(currentWage) : '')
  }

  async function confirmEdit(empId: string) {
    const parsed = parseInt(editingValue.replace(/,/g, ''), 10)
    const wage = isNaN(parsed) ? 0 : parsed
    await supabase.from('employees').update({ hourly_wage: wage }).eq('id', empId)
    setWageOverrides(prev => ({ ...prev, [empId]: wage }))
    setEditingEmpId(null)
  }

  function cancelEdit() {
    setEditingEmpId(null)
  }

  const totalPay = rows.reduce((s, row) => s + calcPay(row), 0)
  const wageFilledCount = rows.filter(r => getWage(r.empId, r.dbWage) > 0).length

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <p className="text-sm text-gray-400">불러오는 중...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">연차수당</h1>
        <p className="text-sm text-gray-500 mt-0.5">미사용 연차에 대한 수당을 계산합니다</p>
      </div>

      {/* 계산 기준 안내 */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 space-y-1.5">
        <p className="text-xs font-semibold text-blue-700">수당 계산 기준 (근로기준법)</p>
        <p className="text-xs text-blue-600">연차수당 = 미사용 연차일수 × 1일 통상임금 (시급 × 8시간)</p>
        <p className="text-xs text-blue-400">* 시급은 사원현황에서 설정하거나 여기서 직접 수정할 수 있습니다</p>
      </div>

      {/* 연도 선택 */}
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={() => setCalYear(y => y - 1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
        <span className="text-sm font-semibold text-gray-700 min-w-[60px] text-center">{calYear}년</span>
        <button
          onClick={() => setCalYear(y => y + 1)}
          disabled={calYear >= now.getFullYear()}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-gray-600" />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <p className="text-sm text-gray-400">해당 연도 연차 데이터가 없습니다</p>
        </div>
      ) : (
        <>
          {wageFilledCount < rows.length && (
            <div className="flex items-center gap-2 bg-warning-50 border border-warning-200 rounded-xl px-4 py-2.5 text-xs text-warning-700">
              <span>시급이 설정되지 않은 직원이 {rows.length - wageFilledCount}명 있습니다. 편집 버튼으로 시급을 입력해 주세요.</span>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">직원</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">부서</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">시급</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">총 연차</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">사용</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-orange-600">미사용</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">연차수당</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((row) => {
                    const wage = getWage(row.empId, row.dbWage)
                    const pay = row.remainingDays * wage * 8
                    const isEditing = editingEmpId === row.empId

                    return (
                      <tr key={row.empId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{row.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{row.department}</td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <div className="flex items-center gap-1 justify-center">
                              <input
                                type="number"
                                value={editingValue}
                                onChange={e => setEditingValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') confirmEdit(row.empId)
                                  if (e.key === 'Escape') cancelEdit()
                                }}
                                className="w-24 px-2 py-1 text-xs border border-primary-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400 text-right"
                                placeholder="시급 입력"
                                autoFocus
                              />
                              <button onClick={() => confirmEdit(row.empId)} className="p-1 text-success-600 hover:text-success-700">
                                <Check size={14} />
                              </button>
                              <button onClick={cancelEdit} className="p-1 text-gray-400 hover:text-gray-600">
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(row.empId, wage)}
                              className="flex items-center gap-1.5 mx-auto text-xs font-medium text-gray-700 hover:text-primary-700 group"
                            >
                              {wage > 0
                                ? <span>{wage.toLocaleString('ko-KR')}원</span>
                                : <span className="text-gray-300">미설정</span>
                              }
                              <Edit2 size={11} className="text-gray-300 group-hover:text-primary-500" />
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-500">{row.totalDays}일</td>
                        <td className="px-4 py-3 text-right text-xs text-gray-400">{row.usedDays}일</td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-orange-600">{row.remainingDays}일</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-800">
                          {wage > 0
                            ? fmtWon(pay)
                            : <span className="text-gray-300 font-normal text-xs">시급 입력 필요</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 text-sm" colSpan={6}>
                      {calYear}년 총 연차수당
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-primary-700 text-base">
                      {fmtWon(totalPay)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

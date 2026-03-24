import { useState, useEffect } from 'react'
import { RefreshCw, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

interface CompLeaveRecord {
  id: string
  employee_id: string
  granted_days: number
  reason: string
  created_at: string
  related_request_id: string
  employee: { name: string; department: string } | null
  overtime_request: { date: string; planned_start: string; planned_end: string } | null
}

interface GrantModal {
  open: boolean
  employeeId: string
  unit: 'hours' | 'days'
  value: number
  reason: string
}

interface EmployeeOption {
  id: string
  name: string
  department: string
  substitute_total: number
}

export function AdminCompLeavePage() {
  const { employee: currentUser } = useAuth()
  const [records, setRecords] = useState<CompLeaveRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [grantModal, setGrantModal] = useState<GrantModal>({
    open: false, employeeId: '', unit: 'hours', value: 1, reason: ''
  })

  const currentYear = new Date().getFullYear()

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    const [{ data: recs }, { data: emps }] = await Promise.all([
      supabase
        .from('substitute_history')
        .select('*, employee:employees!substitute_history_employee_id_fkey(name, department), overtime_request:overtime_requests!substitute_history_related_request_id_fkey(date, planned_start, planned_end)')
        .not('related_request_id', 'is', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('leave_balances')
        .select('employee_id, substitute_total, employee:employees!leave_balances_employee_id_fkey(id, name, department)')
        .eq('year', currentYear),
    ])
    if (recs) setRecords(recs as any)
    if (emps) {
      setEmployees(emps.map((b: any) => ({
        id: b.employee?.id ?? b.employee_id,
        name: b.employee?.name ?? '-',
        department: b.employee?.department ?? '-',
        substitute_total: b.substitute_total ?? 0,
      })).filter((e: EmployeeOption) => e.id))
    }
    setLoading(false)
  }

  async function confirmGrant() {
    const { employeeId, unit, value, reason } = grantModal
    if (!reason.trim() || value <= 0 || !employeeId) return

    const grantedDays = unit === 'hours' ? value / 8 : value
    const displayText = unit === 'hours' ? `${value}시간` : `${value}일`

    await supabase.from('substitute_history').insert({
      employee_id: employeeId,
      granted_days: grantedDays,
      reason: `${reason.trim()} (${displayText})`,
      granted_by: currentUser?.id ?? '',
    })

    const target = employees.find(e => e.id === employeeId)
    if (target) {
      await supabase
        .from('leave_balances')
        .update({ substitute_total: (target.substitute_total ?? 0) + grantedDays })
        .eq('employee_id', employeeId)
        .eq('year', currentYear)
    }

    setGrantModal({ open: false, employeeId: '', unit: 'hours', value: 1, reason: '' })
    fetchAll()
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const totalHours = records.reduce((s, r) => s + r.granted_days * 8, 0)

  const selectedEmp = employees.find(e => e.id === grantModal.employeeId)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-bold text-dark-900">대체휴가 현황</h1>
        <button
          onClick={() => setGrantModal({ open: true, employeeId: '', unit: 'hours', value: 1, reason: '' })}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white text-sm font-semibold rounded-lg hover:bg-primary-500 transition-colors"
        >
          <Plus size={16} />
          대체휴가 지급
        </button>
      </div>

      {/* 요약 */}
      {records.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-center">
            <p className="text-xs text-dark-500 mb-1">전환 건수</p>
            <p className="text-2xl font-bold text-primary-600">{records.length}<span className="text-sm ml-1 font-normal">건</span></p>
          </div>
          <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-center">
            <p className="text-xs text-dark-500 mb-1">총 전환 시간</p>
            <p className="text-2xl font-bold text-primary-600">{Math.round(totalHours * 10) / 10}<span className="text-sm ml-1 font-normal">시간</span></p>
          </div>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-dark-400">불러오는 중...</p>
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] py-16 text-center">
          <RefreshCw className="w-8 h-8 text-dark-200 mx-auto mb-3" />
          <p className="text-sm text-dark-400">대체휴가로 전환된 야근 내역이 없습니다</p>
          <p className="text-xs text-dark-300 mt-1">야근 승인 시 "대체휴가로 승인"을 선택하면 여기에 기록됩니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-100 bg-dark-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">직원</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400">부서</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-dark-500 whitespace-nowrap">야근 일자</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-dark-500 whitespace-nowrap">야근 시간</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-primary-600 whitespace-nowrap">부여 시간</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 whitespace-nowrap">사유</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-dark-400 whitespace-nowrap">처리일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-50">
                {records.map((r) => {
                  const hours = Math.round(r.granted_days * 8 * 10) / 10
                  const ot = r.overtime_request
                  return (
                    <tr key={r.id} className="hover:bg-dark-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-dark-800">{r.employee?.name ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-dark-400">{r.employee?.department ?? '-'}</td>
                      <td className="px-4 py-3 text-center text-xs text-dark-600">{ot?.date ?? '-'}</td>
                      <td className="px-4 py-3 text-center text-xs text-dark-500">
                        {ot ? `${ot.planned_start} ~ ${ot.planned_end}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 bg-dark-50 text-dark-700 text-xs font-semibold px-2 py-1 rounded-full">
                          +{hours}h
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-dark-500 max-w-[160px] truncate">{r.reason}</td>
                      <td className="px-4 py-3 text-center text-xs text-dark-400">{fmtDate(r.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 대체휴가 지급 모달 */}
      {grantModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setGrantModal(p => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">대체휴가 지급</h3>
              <button onClick={() => setGrantModal(p => ({ ...p, open: false }))}><X size={18} className="text-dark-400" /></button>
            </div>

            <div className="space-y-4">
              {/* 직원 선택 */}
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1.5">직원 선택 <span className="text-danger-500">*</span></label>
                <select
                  value={grantModal.employeeId}
                  onChange={(e) => setGrantModal(p => ({ ...p, employeeId: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                >
                  <option value="">직원을 선택하세요</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.department})
                    </option>
                  ))}
                </select>
                {selectedEmp && (
                  <p className="text-xs text-primary-600 mt-1">
                    현재 대체휴가 잔여: <strong>{Math.round(selectedEmp.substitute_total * 8 * 10) / 10}시간</strong>
                  </p>
                )}
              </div>

              {/* 단위 선택 */}
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1.5">지급 단위</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['hours', 'days'] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setGrantModal(p => ({ ...p, unit: u }))}
                      className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                        grantModal.unit === u
                          ? 'bg-primary-500 text-white border-primary-500'
                          : 'bg-white text-dark-600 border-dark-200 hover:border-teal-300'
                      }`}
                    >
                      {u === 'hours' ? '시간' : '일'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 수량 */}
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1.5">
                  지급 수량 <span className="text-danger-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0.5"
                    step={grantModal.unit === 'hours' ? 0.5 : 0.5}
                    value={grantModal.value}
                    onChange={(e) => setGrantModal(p => ({ ...p, value: Number(e.target.value) }))}
                    className="flex-1 px-3 py-2.5 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-400 text-right"
                  />
                  <span className="text-sm text-dark-500 w-8">{grantModal.unit === 'hours' ? '시간' : '일'}</span>
                </div>
                {grantModal.value > 0 && (
                  <p className="text-xs text-dark-400 mt-1">
                    = {grantModal.unit === 'hours'
                      ? `${grantModal.value / 8}일`
                      : `${grantModal.value * 8}시간`}
                  </p>
                )}
              </div>

              {/* 사유 */}
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1.5">
                  사유 <span className="text-danger-500">*</span>
                </label>
                <textarea
                  value={grantModal.reason}
                  onChange={(e) => setGrantModal(p => ({ ...p, reason: e.target.value }))}
                  rows={2}
                  placeholder="예: 2월 휴일근무 대체"
                  className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setGrantModal(p => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmGrant}
                disabled={!grantModal.employeeId || !grantModal.reason.trim() || grantModal.value <= 0}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-500 disabled:opacity-40 transition-colors"
              >
                지급
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

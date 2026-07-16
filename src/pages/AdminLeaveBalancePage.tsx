import { useState, useEffect } from 'react'
import { X, Plus, Minus, RefreshCw, FileText, ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { LEAVE_TYPE_LABEL } from '../types'
import type { LeaveType } from '../types'

interface EmployeeBalance {
  id: string
  name: string
  department: string
  total_days: number
  used_days: number
  remaining_days: number
  substitute_total: number
  substitute_used: number
}

interface AdjustModal {
  open: boolean
  employeeId: string
  employeeName: string
  currentTotal: number
  newTotal: number
  reason: string
}

type SubstituteUnit = 'days' | 'hours'

interface SubstituteGrantModal {
  open: boolean
  employeeId: string
  employeeName: string
  unit: SubstituteUnit
  value: number
  reason: string
}

interface SubHistoryRow {
  id: string
  granted_days: number
  reason: string
  created_at: string
  related_request_id: string | null
  overtime_request: { date: string; planned_start: string; planned_end: string } | null
}

const SUB_HISTORY_SELECT =
  'id, granted_days, reason, created_at, related_request_id, overtime_request:overtime_requests!substitute_history_related_request_id_fkey(date, planned_start, planned_end)'

export function AdminLeaveBalancePage() {
  const navigate = useNavigate()
  const { employee } = useAuth()
  const [balances, setBalances] = useState<EmployeeBalance[]>([])
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [adjustModal, setAdjustModal] = useState<AdjustModal>({ open: false, employeeId: '', employeeName: '', currentTotal: 0, newTotal: 0, reason: '' })
  const [subGrantModal, setSubGrantModal] = useState<SubstituteGrantModal>({ open: false, employeeId: '', employeeName: '', unit: 'hours', value: 1, reason: '' })
  const [adjustLogs, setAdjustLogs] = useState<Record<string, { reason: string; delta: number; date: string }[]>>({})
  const [otCompLeaveHours, setOtCompLeaveHours] = useState<Record<string, number>>({})
  const [usedDetailModal, setUsedDetailModal] = useState<{ open: boolean; employeeId: string; employeeName: string }>({ open: false, employeeId: '', employeeName: '' })
  const [leaveDetails, setLeaveDetails] = useState<{ id: string; type: LeaveType; start_date: string; end_date: string; days: number }[]>([])
  const [leaveDetailsLoading, setLeaveDetailsLoading] = useState(false)
  const [subDetailModal, setSubDetailModal] = useState<{ open: boolean; employeeId: string; employeeName: string }>({ open: false, employeeId: '', employeeName: '' })
  const [subHistory, setSubHistory] = useState<SubHistoryRow[]>([])
  const [subHistoryLoading, setSubHistoryLoading] = useState(false)
  const [editingSubId, setEditingSubId] = useState<string | null>(null)
  const [editSubHours, setEditSubHours] = useState('')
  const [editSubReason, setEditSubReason] = useState('')

  const currentYear = new Date().getFullYear()

  useEffect(() => {
    loadBalances()
    loadAdjustLogs()
    loadOtCompLeave()
  }, [])

  async function loadBalances() {
    setBalancesLoading(true)
    const { data, error } = await supabase.rpc('list_employee_balances', { p_year: currentYear })
    if (!error && data) {
      setBalances((data as EmployeeBalance[]).map((b) => ({
        ...b,
        substitute_total: b.substitute_total ?? 0,
        substitute_used: b.substitute_used ?? 0,
      })))
    }
    setBalancesLoading(false)
  }

  async function loadOtCompLeave() {
    const { data } = await supabase
      .from('substitute_history')
      .select('employee_id, granted_days')
      .not('related_request_id', 'is', null)

    if (data) {
      const grouped: Record<string, number> = {}
      for (const r of data) {
        grouped[r.employee_id] = (grouped[r.employee_id] ?? 0) + r.granted_days * 8
      }
      setOtCompLeaveHours(grouped)
    }
  }

  async function loadAdjustLogs() {
    const { data } = await supabase
      .from('ot_audit_logs')
      .select('*')
      .eq('action', 'leave_adjust')
      .order('created_at', { ascending: false })
      .limit(100)

    if (data) {
      const grouped: Record<string, { reason: string; delta: number; date: string }[]> = {}
      for (const log of data) {
        const empId = log.target_id
        if (!grouped[empId]) grouped[empId] = []
        grouped[empId].push({
          reason: log.payload?.reason ?? '',
          delta: log.payload?.delta ?? 0,
          date: new Date(log.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
        })
      }
      setAdjustLogs(grouped)
    }
  }

  async function openUsedDetail(emp: EmployeeBalance) {
    setUsedDetailModal({ open: true, employeeId: emp.id, employeeName: emp.name })
    setLeaveDetailsLoading(true)
    const { data } = await supabase
      .from('leave_requests')
      .select('id, type, start_date, end_date, days')
      .eq('employee_id', emp.id)
      .eq('status', 'approved')
      .gte('start_date', `${currentYear}-01-01`)
      .lte('start_date', `${currentYear}-12-31`)
      .order('start_date', { ascending: false })
    setLeaveDetails(data ?? [])
    setLeaveDetailsLoading(false)
  }

  async function loadSubHistory(employeeId: string) {
    const { data } = await supabase
      .from('substitute_history')
      .select(SUB_HISTORY_SELECT)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
    setSubHistory((data as unknown as SubHistoryRow[]) ?? [])
  }

  async function openSubDetail(emp: EmployeeBalance) {
    setSubDetailModal({ open: true, employeeId: emp.id, employeeName: emp.name })
    setEditingSubId(null)
    setSubHistoryLoading(true)
    await loadSubHistory(emp.id)
    setSubHistoryLoading(false)
  }

  function startEditSub(row: SubHistoryRow) {
    setEditingSubId(row.id)
    setEditSubHours(String(Math.round(row.granted_days * 8 * 100) / 100))
    setEditSubReason(row.reason)
  }

  async function saveEditSub(id: string) {
    const hours = parseFloat(editSubHours)
    if (!hours || hours <= 0) { alert('시간을 올바르게 입력하세요'); return }
    const { error } = await supabase.rpc('adjust_substitute_grant', {
      p_history_id: id,
      p_new_granted_days: hours / 8,
      p_new_reason: editSubReason.trim(),
    })
    if (error) { alert('수정에 실패했습니다: ' + error.message); return }
    setEditingSubId(null)
    await loadSubHistory(subDetailModal.employeeId)
    await loadBalances()
    await loadOtCompLeave()
  }

  async function deleteSub(row: SubHistoryRow) {
    const msg = row.related_request_id
      ? '이 건은 야근을 대체휴가로 전환한 내역입니다.\n삭제하면 해당 야근이 다시 수당 계산 대상이 됩니다.\n삭제할까요?'
      : '이 대체휴가 지급 내역을 삭제할까요?'
    if (!window.confirm(msg)) return
    const { error } = await supabase.rpc('delete_substitute_grant', { p_history_id: row.id })
    if (error) { alert('삭제에 실패했습니다: ' + error.message); return }
    await loadSubHistory(subDetailModal.employeeId)
    await loadBalances()
    await loadOtCompLeave()
  }

  function openAdjust(emp: EmployeeBalance) {
    setAdjustModal({ open: true, employeeId: emp.id, employeeName: emp.name, currentTotal: emp.total_days, newTotal: emp.total_days, reason: '' })
  }

  async function confirmAdjust() {
    const { employeeId, currentTotal, newTotal, reason } = adjustModal
    const delta = newTotal - currentTotal

    const { data, error } = await supabase.rpc('upsert_leave_balance', {
      p_employee_id: employeeId, p_year: currentYear, p_delta: delta, p_reason: reason,
    })

    if (!error && data) {
      const updated = Array.isArray(data) ? data[0] : data
      if (updated) {
        setBalances((prev) =>
          prev.map((b) =>
            b.id === employeeId
              ? { ...b, total_days: updated.total_days, used_days: updated.used_days, remaining_days: updated.remaining_days }
              : b,
          ),
        )
      }
    } else {
      setBalances((prev) =>
        prev.map((b) =>
          b.id === employeeId
            ? { ...b, total_days: Math.max(b.total_days + delta, 0), remaining_days: Math.max(b.remaining_days + delta, 0) }
            : b,
        ),
      )
    }

    const logEntry = { reason, delta, date: new Date().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) }
    setAdjustLogs((prev) => ({ ...prev, [employeeId]: [logEntry, ...(prev[employeeId] ?? [])] }))
    await supabase.from('ot_audit_logs').insert({
      actor_id: employee?.id ?? null,
      action: 'leave_adjust',
      target_type: 'leave_balance',
      target_id: employeeId,
      payload: { reason, delta, year: currentYear, newTotal },
    })

    setAdjustModal({ open: false, employeeId: '', employeeName: '', currentTotal: 0, newTotal: 0, reason: '' })
  }

  function openSubstituteGrant(emp: EmployeeBalance) {
    setSubGrantModal({ open: true, employeeId: emp.id, employeeName: emp.name, unit: 'hours', value: 1, reason: '' })
  }

  async function confirmSubstituteGrant() {
    const { employeeId, unit, value, reason } = subGrantModal
    if (!reason.trim() || value <= 0) return

    const grantedDays = unit === 'hours' ? value / 8 : value
    const displayText = unit === 'hours' ? `${value}시간` : `${value}일`

    const { data: newTotal, error } = await supabase.rpc('grant_substitute_leave', {
      p_employee_id: employeeId,
      p_granted_days: grantedDays,
      p_reason: `${reason.trim()} (${displayText})`,
      p_year: currentYear,
    })
    if (error) {
      alert('대체휴가 부여에 실패했습니다: ' + error.message)
      return
    }

    setBalances((prev) =>
      prev.map((b) =>
        b.id === employeeId
          ? { ...b, substitute_total: typeof newTotal === 'number' ? newTotal : (b.substitute_total ?? 0) + grantedDays }
          : b,
      ),
    )

    setSubGrantModal({ open: false, employeeId: '', employeeName: '', unit: 'hours', value: 1, reason: '' })
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/admin/leave')}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-dark-50 hover:bg-dark-100 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-dark-500" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-dark-900">직원별 연차 현황</h1>
          <p className="text-sm text-dark-500 mt-0.5">{currentYear}년</p>
        </div>
      </div>

      {/* 범례 */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-dark-400">
          <span className="inline-flex items-center gap-1 border border-dark-200 px-1.5 py-0.5 rounded text-dark-500 mr-1">연차</span>
          연차 총 일수 조정
        </span>
        <span className="text-xs text-dark-400">
          <span className="inline-flex items-center gap-1 border border-primary-200 px-1.5 py-0.5 rounded text-primary-600 mr-1">대체</span>
          대체휴가 추가 지급
        </span>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        {balancesLoading ? (
          <p className="text-center text-sm text-dark-400 py-10">불러오는 중...</p>
        ) : balances.length === 0 ? (
          <p className="text-center text-sm text-dark-400 py-10">
            활성 직원이 없습니다. 사용자 관리에서 직원을 먼저 등록해주세요.
          </p>
        ) : (
          <>
            {/* 데스크톱 테이블 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-dark-50 border-b border-dark-100">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-dark-500">이름</th>
                    <th className="text-center px-2 py-3 text-xs font-semibold text-dark-500">연차</th>
                    <th className="text-center px-2 py-3 text-xs font-semibold text-dark-500">사용</th>
                    <th className="text-center px-2 py-3 text-xs font-semibold text-dark-500">잔여</th>
                    <th className="text-center px-2 py-3 text-xs font-semibold text-primary-600">대체</th>
                    <th className="text-center px-2 py-3 text-xs font-semibold text-dark-500">조정</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-100">
                  {balances.map((b) => (
                    <tr key={b.id} className="hover:bg-dark-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-dark-900 text-sm">{b.name}</p>
                        <p className="text-xs text-dark-400">{b.department}</p>
                        {adjustLogs[b.id]?.[0] && (
                          <p className="text-xs text-primary-500 mt-0.5 flex items-center gap-0.5">
                            <FileText className="w-3 h-3 shrink-0" />
                            <span className="truncate">{adjustLogs[b.id][0].reason}</span>
                            <span className="text-dark-300 shrink-0">({adjustLogs[b.id][0].date})</span>
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3 text-center text-sm text-dark-700">{b.total_days}일</td>
                      <td className="px-2 py-3 text-center">
                        <button
                          onClick={() => openUsedDetail(b)}
                          className="text-sm text-warning-600 font-medium underline underline-offset-2 hover:text-warning-700 transition-colors"
                        >
                          {b.used_days}일
                        </button>
                      </td>
                      <td className={`px-2 py-3 text-center text-sm font-bold ${b.remaining_days <= 5 ? 'text-danger-600' : 'text-primary-600'}`}>
                        {b.remaining_days}일
                      </td>
                      <td className="px-2 py-3 text-center text-sm text-primary-600 font-bold">
                        {(() => {
                          const days = (b.substitute_total ?? 0) - (b.substitute_used ?? 0)
                          const hours = Math.round(days * 8 * 10) / 10
                          const otHours = Math.round((otCompLeaveHours[b.id] ?? 0) * 10) / 10
                          return (
                            <button
                              type="button"
                              onClick={() => openSubDetail(b)}
                              className="mx-auto block rounded-lg px-2 py-1 hover:bg-primary-50 transition-colors"
                              title="대체휴가 내역 보기/수정"
                            >
                              {days}일 <span className="text-xs font-normal text-primary-400">({hours}h)</span>
                              {otHours > 0 && (
                                <div className="text-xs font-normal text-primary-500 mt-0.5 underline underline-offset-2">야근전환 -{otHours}h</div>
                              )}
                            </button>
                          )
                        })()}
                      </td>
                      <td className="px-2 py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => openAdjust(b)}
                            className="text-xs text-dark-500 border border-dark-200 px-2 py-1 rounded-lg hover:border-primary-400 hover:text-primary-600 transition-colors"
                          >
                            연차
                          </button>
                          <button
                            onClick={() => openSubstituteGrant(b)}
                            className="text-xs text-primary-600 border border-primary-200 px-2 py-1 rounded-lg hover:border-primary-400 hover:bg-dark-50 transition-colors flex items-center gap-0.5"
                          >
                            <RefreshCw className="w-3 h-3" />
                            대체
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 모바일 카드 목록 */}
            <div className="md:hidden divide-y divide-dark-100">
              {balances.map((b) => {
                const subDays = (b.substitute_total ?? 0) - (b.substitute_used ?? 0)
                const subHours = Math.round(subDays * 8 * 10) / 10
                const otHours = Math.round((otCompLeaveHours[b.id] ?? 0) * 10) / 10
                return (
                  <div key={b.id} className="px-4 py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-dark-900 text-sm">{b.name}</p>
                        <p className="text-xs text-dark-400">{b.department}</p>
                      </div>
                      {adjustLogs[b.id]?.[0] && (
                        <p className="text-xs text-primary-500 flex items-center gap-0.5 max-w-[140px] text-right">
                          <FileText className="w-3 h-3 shrink-0" />
                          <span className="truncate">{adjustLogs[b.id][0].reason}</span>
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-dark-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-[10px] text-dark-400 mb-0.5">연차</p>
                        <p className="text-sm font-semibold text-dark-700">{b.total_days}일</p>
                      </div>
                      <button
                        onClick={() => openUsedDetail(b)}
                        className="bg-warning-50 rounded-xl px-3 py-2 text-center hover:bg-warning-100 transition-colors"
                      >
                        <p className="text-[10px] text-warning-500 mb-0.5">사용</p>
                        <p className="text-sm font-semibold text-warning-600 underline underline-offset-2">{b.used_days}일</p>
                      </button>
                      <div className={`rounded-xl px-3 py-2 text-center ${b.remaining_days <= 5 ? 'bg-danger-50' : 'bg-primary-50'}`}>
                        <p className={`text-[10px] mb-0.5 ${b.remaining_days <= 5 ? 'text-danger-500' : 'text-primary-500'}`}>잔여</p>
                        <p className={`text-sm font-bold ${b.remaining_days <= 5 ? 'text-danger-600' : 'text-primary-600'}`}>{b.remaining_days}일</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openSubDetail(b)}
                      className="w-full bg-primary-50 rounded-xl px-3 py-2 flex items-center justify-between hover:bg-primary-100 transition-colors text-left"
                    >
                      <p className="text-xs text-primary-600 font-medium">대체휴가 잔여 <span className="text-primary-400">›</span></p>
                      <div className="text-right">
                        <span className="text-sm font-bold text-primary-700">{subDays}일</span>
                        <span className="text-xs font-normal text-primary-400 ml-1">({subHours}h)</span>
                        {otHours > 0 && (
                          <p className="text-xs text-primary-500 underline underline-offset-2">야근전환 -{otHours}h</p>
                        )}
                      </div>
                    </button>

                    <div className="flex gap-2">
                      <button
                        onClick={() => openAdjust(b)}
                        className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:border-primary-400 hover:text-primary-600 transition-colors"
                      >
                        연차 조정
                      </button>
                      <button
                        onClick={() => openSubstituteGrant(b)}
                        className="flex-1 py-2.5 text-sm font-medium text-primary-600 border border-primary-200 rounded-xl hover:border-primary-400 hover:bg-primary-50 transition-colors flex items-center justify-center gap-1"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        대체 부여
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* 사용 내역 모달 */}
      {usedDetailModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setUsedDetailModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
              <div>
                <h3 className="text-base font-bold text-dark-900">{usedDetailModal.employeeName} 연차 사용 내역</h3>
                <p className="text-xs text-dark-400 mt-0.5">{currentYear}년</p>
              </div>
              <button onClick={() => setUsedDetailModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {leaveDetailsLoading ? (
                <p className="text-center text-sm text-dark-400 py-8">불러오는 중...</p>
              ) : leaveDetails.length === 0 ? (
                <p className="text-center text-sm text-dark-400 py-8">사용 내역이 없습니다</p>
              ) : (
                <div className="divide-y divide-dark-100">
                  {leaveDetails.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium text-dark-800">
                          {r.start_date === r.end_date ? r.start_date : `${r.start_date} ~ ${r.end_date}`}
                        </p>
                        <p className="text-xs text-dark-400 mt-0.5">{LEAVE_TYPE_LABEL[r.type as LeaveType]}</p>
                      </div>
                      <span className="text-sm font-semibold text-warning-600">{r.days}일</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-dark-100 flex justify-between items-center">
              <span className="text-xs text-dark-400">총 사용</span>
              <span className="text-sm font-bold text-warning-600">
                {leaveDetails.reduce((sum, r) => sum + r.days, 0)}일
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 대체휴가 내역 상세/관리 모달 */}
      {subDetailModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSubDetailModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100 shrink-0">
              <div>
                <h3 className="text-base font-bold text-dark-900">{subDetailModal.employeeName} 대체휴가 내역</h3>
                <p className="text-xs text-dark-400 mt-0.5">{currentYear}년 · 부여 내역 수정/삭제 가능</p>
              </div>
              <button onClick={() => setSubDetailModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {subHistoryLoading ? (
                <p className="text-center text-sm text-dark-400 py-8">불러오는 중...</p>
              ) : subHistory.length === 0 ? (
                <p className="text-center text-sm text-dark-400 py-8">대체휴가 지급 내역이 없습니다</p>
              ) : (
                <div className="divide-y divide-dark-100">
                  {subHistory.map((row) => {
                    const hours = Math.round(row.granted_days * 8 * 100) / 100
                    const isOt = !!row.related_request_id
                    const isEditing = editingSubId === row.id
                    return (
                      <div key={row.id} className="px-5 py-3.5">
                        {isEditing ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0.5"
                                step="0.5"
                                value={editSubHours}
                                onChange={(e) => setEditSubHours(e.target.value)}
                                className="w-24 px-2 py-1.5 text-sm border border-primary-300 rounded-lg text-right focus:outline-none focus:ring-1 focus:ring-primary-400"
                                autoFocus
                              />
                              <span className="text-sm text-dark-500">시간 = {(parseFloat(editSubHours || '0') / 8).toFixed(2)}일</span>
                            </div>
                            <input
                              type="text"
                              value={editSubReason}
                              onChange={(e) => setEditSubReason(e.target.value)}
                              placeholder="사유"
                              className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
                            />
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => setEditingSubId(null)} className="flex-1 py-1.5 text-xs font-medium text-dark-600 border border-dark-200 rounded-lg hover:bg-dark-50">취소</button>
                              <button onClick={() => saveEditSub(row.id)} className="flex-1 py-1.5 text-xs font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600">저장</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-bold text-primary-600">+{hours}h</span>
                                <span className="text-xs text-dark-400">({row.granted_days}일)</span>
                                {isOt && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 font-medium">야근전환</span>
                                )}
                              </div>
                              {isOt && row.overtime_request && (
                                <p className="text-xs text-dark-500 mt-0.5">
                                  야근 {row.overtime_request.date} ({row.overtime_request.planned_start}~{row.overtime_request.planned_end})
                                </p>
                              )}
                              <p className="text-xs text-dark-400 mt-0.5 truncate">{row.reason}</p>
                              <p className="text-[11px] text-dark-300 mt-0.5">
                                {new Date(row.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })} 지급
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => startEditSub(row)} className="text-xs text-dark-500 border border-dark-200 px-2 py-1 rounded-lg hover:border-primary-400 hover:text-primary-600 transition-colors">수정</button>
                              <button onClick={() => deleteSub(row)} className="text-xs text-danger-600 border border-danger-200 px-2 py-1 rounded-lg hover:bg-danger-50 transition-colors">삭제</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-dark-100 flex items-center justify-between bg-dark-50 shrink-0">
              <span className="text-xs text-dark-500">대체휴가 총 지급</span>
              <span className="text-sm font-bold text-primary-700">
                {Math.round(subHistory.reduce((s, r) => s + r.granted_days * 8, 0) * 100) / 100}h
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 일수 조정 모달 */}
      {adjustModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAdjustModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">연차 일수 조정</h3>
              <button onClick={() => setAdjustModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-sm text-dark-600 mb-4">
              <span className="font-semibold">{adjustModal.employeeName}</span>의 총 연차 일수를 설정합니다
            </p>

            <div className="flex items-center justify-center gap-4 mb-2">
              <button
                type="button"
                onClick={() => setAdjustModal((p) => ({ ...p, newTotal: Math.max(0, p.newTotal - 1) }))}
                className="w-10 h-10 rounded-xl bg-dark-100 flex items-center justify-center hover:bg-dark-200 transition-colors"
              >
                <Minus className="w-4 h-4 text-dark-600" />
              </button>
              <div className="text-center">
                <span className="text-3xl font-black text-primary-600">{adjustModal.newTotal}</span>
                <p className="text-xs text-dark-400 mt-0.5">일</p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModal((p) => ({ ...p, newTotal: p.newTotal + 1 }))}
                className="w-10 h-10 rounded-xl bg-dark-100 flex items-center justify-center hover:bg-dark-200 transition-colors"
              >
                <Plus className="w-4 h-4 text-dark-600" />
              </button>
            </div>
            {adjustModal.newTotal !== adjustModal.currentTotal && (
              <p className="text-xs text-center text-dark-400 mb-4">
                기존 {adjustModal.currentTotal}일 → {adjustModal.newTotal}일 ({adjustModal.newTotal - adjustModal.currentTotal > 0 ? '+' : ''}{adjustModal.newTotal - adjustModal.currentTotal}일)
              </p>
            )}
            {adjustModal.newTotal === adjustModal.currentTotal && <div className="mb-4" />}

            <textarea
              className="w-full border border-dark-200 rounded-xl px-3 py-2.5 text-sm text-dark-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={2}
              placeholder="조정 사유를 입력하세요"
              value={adjustModal.reason}
              onChange={(e) => setAdjustModal((p) => ({ ...p, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setAdjustModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmAdjust}
                disabled={adjustModal.newTotal === adjustModal.currentTotal || !adjustModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-40 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 대체휴가 부여 모달 */}
      {subGrantModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSubGrantModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary-600" />
                대체휴가 부여
              </h3>
              <button onClick={() => setSubGrantModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-sm text-dark-600 mb-4">
              <span className="font-semibold">{subGrantModal.employeeName}</span>에게 대체휴가를 부여합니다
            </p>

            <div className="flex bg-dark-100 rounded-xl p-1 gap-1 mb-4">
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({ ...p, unit: 'hours', value: 1 }))}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  subGrantModal.unit === 'hours' ? 'bg-white text-dark-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500'
                }`}
              >
                시간
              </button>
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({ ...p, unit: 'days', value: 0.5 }))}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  subGrantModal.unit === 'days' ? 'bg-white text-dark-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500'
                }`}
              >
                일
              </button>
            </div>

            <div className="flex items-center justify-center gap-4 mb-2">
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({
                  ...p,
                  value: Math.max(p.unit === 'hours' ? 1 : 0.5, p.value - (p.unit === 'hours' ? 1 : 0.5)),
                }))}
                className="w-10 h-10 rounded-xl bg-dark-100 flex items-center justify-center hover:bg-dark-200 transition-colors"
              >
                <Minus className="w-4 h-4 text-dark-600" />
              </button>
              <div className="text-center">
                <span className="text-3xl font-black text-primary-600">+{subGrantModal.value}</span>
                <p className="text-xs text-dark-400 mt-0.5">{subGrantModal.unit === 'hours' ? '시간' : '일'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({
                  ...p,
                  value: p.value + (p.unit === 'hours' ? 1 : 0.5),
                }))}
                className="w-10 h-10 rounded-xl bg-dark-100 flex items-center justify-center hover:bg-dark-200 transition-colors"
              >
                <Plus className="w-4 h-4 text-dark-600" />
              </button>
            </div>

            {subGrantModal.unit === 'hours' && (
              <p className="text-xs text-center text-dark-400 mb-4">
                = {(subGrantModal.value / 8).toFixed(1)}일 (8시간 = 1일)
              </p>
            )}
            {subGrantModal.unit === 'days' && <div className="mb-4" />}

            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">
                부여 사유 <span className="text-danger-500">*</span>
              </label>
              <textarea
                className="w-full border border-dark-200 rounded-xl px-3 py-2.5 text-sm text-dark-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
                rows={2}
                placeholder="부여 사유를 입력하세요 (예: 2/15 휴일근무 대체)"
                value={subGrantModal.reason}
                onChange={(e) => setSubGrantModal((p) => ({ ...p, reason: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setSubGrantModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmSubstituteGrant}
                disabled={subGrantModal.value <= 0 || !subGrantModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-500 disabled:opacity-40 transition-colors"
              >
                부여
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

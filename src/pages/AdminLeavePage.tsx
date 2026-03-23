import { useState, useEffect } from 'react'
import { X, Plus, Minus, Trash2, RefreshCw, FileText, Clock, CheckSquare, AlertTriangle, Calendar } from 'lucide-react'
import type { LeaveRequest } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

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

export function AdminLeavePage() {
  const { employee } = useAuth()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [balances, setBalances] = useState<EmployeeBalance[]>([])
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: string; reason: string }>({ open: false, id: '', reason: '' })
  const [adjustModal, setAdjustModal] = useState<AdjustModal>({ open: false, employeeId: '', employeeName: '', currentTotal: 0, newTotal: 0, reason: '' })
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; id: string; employeeName: string; days: number; status: string }>({ open: false, id: '', employeeName: '', days: 0, status: '' })
  const [subGrantModal, setSubGrantModal] = useState<SubstituteGrantModal>({ open: false, employeeId: '', employeeName: '', unit: 'hours', value: 1, reason: '' })
  const [adjustLogs, setAdjustLogs] = useState<Record<string, { reason: string; delta: number; date: string }[]>>({})
  const [otCompLeaveHours, setOtCompLeaveHours] = useState<Record<string, number>>({})

  const currentYear = new Date().getFullYear()

  useEffect(() => {
    fetchLeaveRequests()
    loadBalances()
    loadAdjustLogs()
    loadOtCompLeave()
  }, [])

  async function fetchLeaveRequests() {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*, employee:employees!leave_requests_employee_id_fkey(id, name, department)')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setRequests(data as LeaveRequest[])
    }
  }

  async function loadBalances() {
    setBalancesLoading(true)
    const { data, error } = await supabase.rpc('list_employee_balances', { p_year: currentYear })
    if (!error && data) {
      // RPC 결과에 substitute 컬럼이 없을 수 있으므로 기본값 설정
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

  async function handleApprove(id: string) {
    const req = requests.find((r) => r.id === id)
    if (!req) return

    const now = new Date().toISOString()
    const myRole = employee?.role // 'admin' = 대표, 'manager' = 인사담당자

    // 현재 승인자의 역할에 따라 업데이트 필드 결정
    const updateFields: Record<string, unknown> = {}

    if (myRole === 'admin') {
      // 대표 승인
      updateFields.approved_by = employee?.id ?? null
      updateFields.approved_at = now
    } else {
      // 인사담당자 승인
      updateFields.manager_approved_by = employee?.id ?? null
      updateFields.manager_approved_at = now
    }

    // 상대방이 이미 승인했는지 확인 → 둘 다 승인이면 최종 승인
    const otherApproved = myRole === 'admin'
      ? !!req.manager_approved_at  // 인사담당자가 이미 승인했는지
      : !!req.approved_at          // 대표가 이미 승인했는지

    if (otherApproved) {
      // 둘 다 승인 완료 → 최종 승인 상태로 변경
      updateFields.status = 'approved'
    } else {
      // 한쪽만 승인 → 중간 상태
      updateFields.status = 'manager_approved'
    }

    const { error: reqErr } = await supabase
      .from('leave_requests')
      .update(updateFields)
      .eq('id', id)

    if (reqErr) {
      void reqErr
      return
    }

    // 둘 다 승인된 경우에만 연차/대체휴가 차감
    if (otherApproved) {
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('used_days, substitute_used, substitute_total')
        .eq('employee_id', req.employee_id)
        .eq('year', currentYear)
        .single()

      if (bal) {
        if (req.use_substitute) {
          await supabase
            .from('leave_balances')
            .update({ substitute_used: Number(bal.substitute_used) + Number(req.days) })
            .eq('employee_id', req.employee_id)
            .eq('year', currentYear)
        } else {
          await supabase
            .from('leave_balances')
            .update({ used_days: Number(bal.used_days) + Number(req.days) })
            .eq('employee_id', req.employee_id)
            .eq('year', currentYear)
        }
      }
    }

    setRequests((prev) => prev.map((r) => r.id === id ? {
      ...r,
      ...updateFields as Partial<LeaveRequest>,
    } : r))
    loadBalances()
  }

  function openReject(id: string) {
    setRejectModal({ open: true, id, reason: '' })
  }

  async function confirmReject() {
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: 'rejected', rejection_reason: rejectModal.reason })
      .eq('id', rejectModal.id)

    if (!error) {
      setRequests((prev) => prev.map((r) => r.id === rejectModal.id ? { ...r, status: 'rejected', rejection_reason: rejectModal.reason } : r))
    }
    setRejectModal({ open: false, id: '', reason: '' })
  }

  async function confirmDelete() {
    const { id, status, days } = deleteModal
    const req = requests.find((r) => r.id === id)

    // 승인 상태였던 건 삭제 시 차감했던 잔여 복원
    if (status === 'approved' && req) {
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('used_days, substitute_used')
        .eq('employee_id', req.employee_id)
        .eq('year', currentYear)
        .single()

      if (bal) {
        if (req.use_substitute) {
          await supabase
            .from('leave_balances')
            .update({ substitute_used: Math.max(0, Number(bal.substitute_used) - Number(days)) })
            .eq('employee_id', req.employee_id)
            .eq('year', currentYear)
        } else {
          await supabase
            .from('leave_balances')
            .update({ used_days: Math.max(0, Number(bal.used_days) - Number(days)) })
            .eq('employee_id', req.employee_id)
            .eq('year', currentYear)
        }
      }
    }

    const { error } = await supabase.from('leave_requests').delete().eq('id', id)
    if (!error) {
      setRequests((prev) => prev.filter((r) => r.id !== id))
      loadBalances()
    }
    setDeleteModal({ open: false, id: '', employeeName: '', days: 0, status: '' })
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
              ? {
                  ...b,
                  total_days: updated.total_days,
                  used_days: updated.used_days,
                  remaining_days: updated.remaining_days,
                }
              : b,
          ),
        )
      }
    } else {
      // fallback: 낙관적 업데이트 (데모/오류 시)
      setBalances((prev) =>
        prev.map((b) =>
          b.id === employeeId
            ? {
                ...b,
                total_days: Math.max(b.total_days + delta, 0),
                remaining_days: Math.max(b.remaining_days + delta, 0),
              }
            : b,
        ),
      )
    }

    // 조정 로그 저장
    const logEntry = { reason, delta, date: new Date().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) }
    setAdjustLogs((prev) => ({
      ...prev,
      [employeeId]: [logEntry, ...(prev[employeeId] ?? [])],
    }))
    await supabase.from('ot_audit_logs').insert({
      actor_id: employee?.id ?? null,
      action: 'leave_adjust',
      target_type: 'leave_balance',
      target_id: employeeId,
      payload: { reason, delta, year: currentYear, newTotal },
    })

    setAdjustModal({ open: false, employeeId: '', employeeName: '', currentTotal: 0, newTotal: 0, reason: '' })
  }

  // 대체휴가 부여
  function openSubstituteGrant(emp: EmployeeBalance) {
    setSubGrantModal({ open: true, employeeId: emp.id, employeeName: emp.name, unit: 'hours', value: 1, reason: '' })
  }

  async function confirmSubstituteGrant() {
    const { employeeId, unit, value, reason } = subGrantModal
    if (!reason.trim() || value <= 0) return

    // 시간→일 변환 (8시간 = 1일)
    const grantedDays = unit === 'hours' ? value / 8 : value
    const displayText = unit === 'hours' ? `${value}시간` : `${value}일`

    // substitute_history에 기록
    await supabase.from('substitute_history').insert({
      employee_id: employeeId,
      granted_days: grantedDays,
      reason: `${reason.trim()} (${displayText})`,
      granted_by: employee?.id ?? '',
    })

    // leave_balances.substitute_total 업데이트
    const target = balances.find((b) => b.id === employeeId)
    if (target) {
      await supabase
        .from('leave_balances')
        .update({ substitute_total: (target.substitute_total ?? 0) + grantedDays })
        .eq('employee_id', employeeId)
        .eq('year', currentYear)

      setBalances((prev) =>
        prev.map((b) =>
          b.id === employeeId
            ? { ...b, substitute_total: (b.substitute_total ?? 0) + grantedDays }
            : b,
        ),
      )
    }

    setSubGrantModal({ open: false, employeeId: '', employeeName: '', unit: 'hours', value: 1, reason: '' })
  }

  const LEAVE_TYPE_COLOR: Record<string, string> = {
    annual: 'bg-primary-50 text-primary-700',
    half_am: 'bg-purple-50 text-purple-700',
    half_pm: 'bg-purple-50 text-purple-700',
    special: 'bg-teal-50 text-teal-700',
  }

  const pendingRequests = requests.filter(r => r.status === 'pending' || r.status === 'manager_approved')
  const thisMonthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const thisMonthApproved = requests.filter(r => r.status === 'approved' && r.start_date?.startsWith(thisMonthPrefix)).length
  const lowRemainingEmployees = balances.filter(b => b.remaining_days <= 5)
  const avgRemaining = balances.length > 0
    ? (balances.reduce((s, b) => s + b.remaining_days, 0) / balances.length).toFixed(1)
    : '-'

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">휴가 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">팀 휴가 현황을 한눈에 파악하세요</p>
      </div>

      {/* 상단: KPI + 대기 목록 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 좌: 주요 지표 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">현황 요약</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-warning-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-warning-500" />
                <span className="text-xs text-warning-600 font-medium">승인 대기</span>
              </div>
              <p className="text-2xl font-bold text-warning-700">{pendingRequests.length}<span className="text-sm ml-1">건</span></p>
            </div>
            <div className="bg-success-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <CheckSquare className="w-4 h-4 text-success-500" />
                <span className="text-xs text-success-600 font-medium">이번달 승인</span>
              </div>
              <p className="text-2xl font-bold text-success-700">{thisMonthApproved}<span className="text-sm ml-1">건</span></p>
            </div>
            <div className={`rounded-xl p-3 ${lowRemainingEmployees.length > 0 ? 'bg-danger-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className={`w-4 h-4 ${lowRemainingEmployees.length > 0 ? 'text-danger-500' : 'text-gray-400'}`} />
                <span className={`text-xs font-medium ${lowRemainingEmployees.length > 0 ? 'text-danger-600' : 'text-gray-500'}`}>잔여 5일 이하</span>
              </div>
              <p className={`text-2xl font-bold ${lowRemainingEmployees.length > 0 ? 'text-danger-700' : 'text-gray-400'}`}>
                {lowRemainingEmployees.length}<span className="text-sm ml-1">명</span>
              </p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-blue-600 font-medium">평균 잔여</span>
              </div>
              <p className="text-2xl font-bold text-blue-700">{avgRemaining}<span className="text-sm ml-1">일</span></p>
            </div>
          </div>

          {/* 잔여 5일 이하 직원 목록 */}
          {lowRemainingEmployees.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-danger-600 mb-2">⚠ 잔여 연차 부족 직원</p>
              <div className="space-y-1">
                {lowRemainingEmployees.map(emp => (
                  <div key={emp.id} className="flex items-center justify-between text-xs bg-danger-50 rounded-lg px-3 py-1.5">
                    <span className="text-gray-700 font-medium">{emp.name}</span>
                    <span className={`font-bold ${emp.remaining_days <= 0 ? 'text-danger-700' : 'text-warning-600'}`}>
                      잔여 {emp.remaining_days}일
                      {emp.remaining_days <= 0 && <span className="ml-1">소진</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 우: 승인 대기 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 shrink-0">
            <h2 className="text-sm font-semibold text-gray-900">승인 대기중</h2>
          </div>
          {pendingRequests.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10">
              <p className="text-sm text-gray-400">대기중인 건이 없습니다</p>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 max-h-[320px] divide-y divide-gray-50">
              {pendingRequests.map(req => (
                <div key={req.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary-700">
                      {req.employee?.name?.charAt(0) ?? '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-gray-800">{req.employee?.name ?? '-'}</span>
                      <span className="text-xs text-gray-400">{req.employee?.department}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${LEAVE_TYPE_COLOR[req.type]}`}>
                        {LEAVE_TYPE_LABEL[req.type]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {req.start_date}{req.start_date !== req.end_date ? ` ~ ${req.end_date}` : ''} ({req.days}일)
                      </span>
                    </div>
                    {req.reason && <p className="text-xs text-gray-400 truncate mt-0.5">{req.reason}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0 items-center">
                    {req.status === 'manager_approved' && (
                      <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full mr-1">1차 승인</span>
                    )}
                    <button
                      onClick={() => handleApprove(req.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-white bg-success-500 rounded-lg hover:bg-success-600 transition-colors"
                    >
                      승인
                    </button>
                    <button
                      onClick={() => openReject(req.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-danger-600 border border-danger-300 rounded-lg hover:bg-danger-50 transition-colors"
                    >
                      반려
                    </button>
                    <button
                      onClick={() => setDeleteModal({ open: true, id: req.id, employeeName: req.employee?.name ?? '', days: req.days, status: req.status })}
                      className="p-1.5 text-danger-400 hover:text-danger-600 hover:bg-danger-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 직원별 연차 현황 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            직원별 연차 현황
            <span className="text-xs font-normal text-gray-400 ml-2">{currentYear}년</span>
          </h2>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-gray-400">
              <span className="inline-flex items-center gap-1 border border-gray-200 px-1.5 py-0.5 rounded text-gray-500 mr-1">연차</span>
              연차 총 일수 조정
            </span>
            <span className="text-xs text-gray-400">
              <span className="inline-flex items-center gap-1 border border-teal-200 px-1.5 py-0.5 rounded text-teal-600 mr-1">대체</span>
              대체휴가 추가 지급
            </span>
          </div>
        </div>
        {balancesLoading ? (
          <p className="text-center text-sm text-gray-400 py-10">불러오는 중...</p>
        ) : balances.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            활성 직원이 없습니다. 사용자 관리에서 직원을 먼저 등록해주세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">이름</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500">연차</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500">사용</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500">잔여</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold text-teal-600">대체</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500">조정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {balances.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900 text-sm">{b.name}</p>
                      <p className="text-xs text-gray-400">{b.department}</p>
                      {adjustLogs[b.id]?.[0] && (
                        <p className="text-xs text-primary-500 mt-0.5 flex items-center gap-0.5">
                          <FileText className="w-3 h-3 shrink-0" />
                          <span className="truncate">{adjustLogs[b.id][0].reason}</span>
                          <span className="text-gray-300 shrink-0">({adjustLogs[b.id][0].date})</span>
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center text-sm text-gray-700">{b.total_days}일</td>
                    <td className="px-2 py-3 text-center text-sm text-warning-600 font-medium">{b.used_days}일</td>
                    <td className={`px-2 py-3 text-center text-sm font-bold ${b.remaining_days <= 5 ? 'text-danger-600' : 'text-primary-600'}`}>
                      {b.remaining_days}일
                    </td>
                    <td className="px-2 py-3 text-center text-sm text-teal-600 font-bold">
                      {(() => {
                        const days = (b.substitute_total ?? 0) - (b.substitute_used ?? 0)
                        const hours = Math.round(days * 8 * 10) / 10
                        const otHours = Math.round((otCompLeaveHours[b.id] ?? 0) * 10) / 10
                        return (
                          <>
                            {days}일 <span className="text-xs font-normal text-teal-400">({hours}h)</span>
                            {otHours > 0 && (
                              <div className="text-xs font-normal text-orange-500 mt-0.5">야근전환 -{otHours}h</div>
                            )}
                          </>
                        )
                      })()}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => openAdjust(b)}
                          className="text-xs text-gray-500 border border-gray-200 px-2 py-1 rounded-lg hover:border-primary-400 hover:text-primary-600 transition-colors"
                        >
                          연차
                        </button>
                        <button
                          onClick={() => openSubstituteGrant(b)}
                          className="text-xs text-teal-600 border border-teal-200 px-2 py-1 rounded-lg hover:border-teal-400 hover:bg-teal-50 transition-colors flex items-center gap-0.5"
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
        )}
      </div>

      {/* 반려 모달 */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRejectModal({ open: false, id: '', reason: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">반려 사유 입력</h3>
              <button onClick={() => setRejectModal({ open: false, id: '', reason: '' })}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={3}
              placeholder="반려 사유를 입력하세요"
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRejectModal({ open: false, id: '', reason: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={confirmReject}
                disabled={!rejectModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 disabled:opacity-40 transition-colors"
              >
                반려
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">휴가 신청 삭제</h3>
              <button onClick={() => setDeleteModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              <span className="font-semibold">{deleteModal.employeeName}</span>의 휴가 신청({deleteModal.days}일)을 삭제하시겠습니까?
            </p>
            {deleteModal.status === 'approved' && (
              <p className="text-xs text-warning-600 bg-warning-50 rounded-lg px-3 py-2 mt-2">
                승인된 건이므로 삭제 시 잔여 연차가 복원됩니다.
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setDeleteModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors"
              >
                삭제
              </button>
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
              <h3 className="text-base font-bold text-gray-900">연차 일수 조정</h3>
              <button onClick={() => setAdjustModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-semibold">{adjustModal.employeeName}</span>의 총 연차 일수를 설정합니다
            </p>

            {/* 총 연차 입력 */}
            <div className="flex items-center justify-center gap-4 mb-2">
              <button
                type="button"
                onClick={() => setAdjustModal((p) => ({ ...p, newTotal: Math.max(0, p.newTotal - 1) }))}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <Minus className="w-4 h-4 text-gray-600" />
              </button>
              <div className="text-center">
                <span className="text-3xl font-black text-primary-600">
                  {adjustModal.newTotal}
                </span>
                <p className="text-xs text-gray-400 mt-0.5">일</p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModal((p) => ({ ...p, newTotal: p.newTotal + 1 }))}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4 text-gray-600" />
              </button>
            </div>
            {adjustModal.newTotal !== adjustModal.currentTotal && (
              <p className="text-xs text-center text-gray-400 mb-4">
                기존 {adjustModal.currentTotal}일 → {adjustModal.newTotal}일 ({adjustModal.newTotal - adjustModal.currentTotal > 0 ? '+' : ''}{adjustModal.newTotal - adjustModal.currentTotal}일)
              </p>
            )}
            {adjustModal.newTotal === adjustModal.currentTotal && <div className="mb-4" />}

            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={2}
              placeholder="조정 사유를 입력하세요"
              value={adjustModal.reason}
              onChange={(e) => setAdjustModal((p) => ({ ...p, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setAdjustModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={confirmAdjust}
                disabled={adjustModal.newTotal === adjustModal.currentTotal || !adjustModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors"
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
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-teal-600" />
                대체휴가 부여
              </h3>
              <button onClick={() => setSubGrantModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-semibold">{subGrantModal.employeeName}</span>에게 대체휴가를 부여합니다
            </p>

            {/* 단위 선택 (시간/일) */}
            <div className="flex bg-gray-100 rounded-xl p-1 gap-1 mb-4">
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({ ...p, unit: 'hours', value: 1 }))}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  subGrantModal.unit === 'hours' ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                시간
              </button>
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({ ...p, unit: 'days', value: 0.5 }))}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  subGrantModal.unit === 'days' ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                일
              </button>
            </div>

            {/* 수량 입력 */}
            <div className="flex items-center justify-center gap-4 mb-2">
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({
                  ...p,
                  value: Math.max(p.unit === 'hours' ? 1 : 0.5, p.value - (p.unit === 'hours' ? 1 : 0.5)),
                }))}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <Minus className="w-4 h-4 text-gray-600" />
              </button>
              <div className="text-center">
                <span className="text-3xl font-black text-teal-600">
                  +{subGrantModal.value}
                </span>
                <p className="text-xs text-gray-400 mt-0.5">
                  {subGrantModal.unit === 'hours' ? '시간' : '일'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({
                  ...p,
                  value: p.value + (p.unit === 'hours' ? 1 : 0.5),
                }))}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            {/* 변환 안내 */}
            {subGrantModal.unit === 'hours' && (
              <p className="text-xs text-center text-gray-400 mb-4">
                = {(subGrantModal.value / 8).toFixed(1)}일 (8시간 = 1일)
              </p>
            )}
            {subGrantModal.unit === 'days' && <div className="mb-4" />}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                부여 사유 <span className="text-danger-500">*</span>
              </label>
              <textarea
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
                rows={2}
                placeholder="부여 사유를 입력하세요 (예: 2/15 휴일근무 대체)"
                value={subGrantModal.reason}
                onChange={(e) => setSubGrantModal((p) => ({ ...p, reason: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setSubGrantModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={confirmSubstituteGrant}
                disabled={subGrantModal.value <= 0 || !subGrantModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-40 transition-colors"
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

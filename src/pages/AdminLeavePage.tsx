import { useState, useEffect } from 'react'
import { X, Plus, Minus, Trash2, RefreshCw } from 'lucide-react'
import { StatusBadge } from '../components/common/StatusBadge'
import type { LeaveRequest } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const ADMIN_KEY = '6325'

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
  delta: number
  reason: string
}

interface SubstituteGrantModal {
  open: boolean
  employeeId: string
  employeeName: string
  days: number
  reason: string
}

export function AdminLeavePage() {
  const { isDemo, employee } = useAuth()
  const [tab, setTab] = useState<'approvals' | 'balances'>('approvals')
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [balances, setBalances] = useState<EmployeeBalance[]>([])
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: string; reason: string }>({ open: false, id: '', reason: '' })
  const [adjustModal, setAdjustModal] = useState<AdjustModal>({ open: false, employeeId: '', employeeName: '', delta: 0, reason: '' })
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; id: string; employeeName: string; days: number; status: string }>({ open: false, id: '', employeeName: '', days: 0, status: '' })
  const [subGrantModal, setSubGrantModal] = useState<SubstituteGrantModal>({ open: false, employeeId: '', employeeName: '', days: 1, reason: '' })

  const currentYear = new Date().getFullYear()

  useEffect(() => {
    fetchLeaveRequests()
    loadBalances()
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
    const params = isDemo
      ? { p_admin_key: ADMIN_KEY, p_year: currentYear }
      : { p_year: currentYear }

    const { data, error } = await supabase.rpc('list_employee_balances', params)
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

  async function handleApprove(id: string) {
    const req = requests.find((r) => r.id === id)
    if (!req) return

    const { error: reqErr } = await supabase
      .from('leave_requests')
      .update({
        status: 'approved',
        approved_by: employee?.id ?? null,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (reqErr) {
      console.error('승인 실패:', reqErr)
      return
    }

    // leave_balances.used_days 증가
    const { data: bal } = await supabase
      .from('leave_balances')
      .select('used_days')
      .eq('employee_id', req.employee_id)
      .eq('year', currentYear)
      .single()

    if (bal) {
      await supabase
        .from('leave_balances')
        .update({ used_days: Number(bal.used_days) + Number(req.days) })
        .eq('employee_id', req.employee_id)
        .eq('year', currentYear)
    }

    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: 'approved' } : r))
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

    // 승인 상태였던 건 삭제 시 used_days 차감 (잔여 복원)
    if (status === 'approved' && req) {
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('used_days')
        .eq('employee_id', req.employee_id)
        .eq('year', currentYear)
        .single()

      if (bal) {
        await supabase
          .from('leave_balances')
          .update({ used_days: Math.max(0, Number(bal.used_days) - Number(days)) })
          .eq('employee_id', req.employee_id)
          .eq('year', currentYear)
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
    setAdjustModal({ open: true, employeeId: emp.id, employeeName: emp.name, delta: 0, reason: '' })
  }

  async function confirmAdjust() {
    const { employeeId, delta, reason } = adjustModal

    const params = isDemo
      ? { p_admin_key: ADMIN_KEY, p_employee_id: employeeId, p_year: currentYear, p_delta: delta, p_reason: reason }
      : { p_employee_id: employeeId, p_year: currentYear, p_delta: delta, p_reason: reason }

    const { data, error } = await supabase.rpc('upsert_leave_balance', params)

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

    setAdjustModal({ open: false, employeeId: '', employeeName: '', delta: 0, reason: '' })
  }

  // 대체휴가 부여
  function openSubstituteGrant(emp: EmployeeBalance) {
    setSubGrantModal({ open: true, employeeId: emp.id, employeeName: emp.name, days: 1, reason: '' })
  }

  async function confirmSubstituteGrant() {
    const { employeeId, days, reason } = subGrantModal
    if (!reason.trim() || days <= 0) return

    // substitute_history에 기록
    await supabase.from('substitute_history').insert({
      employee_id: employeeId,
      granted_days: days,
      reason: reason.trim(),
      granted_by: employee?.id ?? '',
    })

    // leave_balances.substitute_total 업데이트
    const target = balances.find((b) => b.id === employeeId)
    if (target) {
      await supabase
        .from('leave_balances')
        .update({ substitute_total: (target.substitute_total ?? 0) + days })
        .eq('employee_id', employeeId)
        .eq('year', currentYear)

      setBalances((prev) =>
        prev.map((b) =>
          b.id === employeeId
            ? { ...b, substitute_total: (b.substitute_total ?? 0) + days }
            : b,
        ),
      )
    }

    setSubGrantModal({ open: false, employeeId: '', employeeName: '', days: 1, reason: '' })
  }

  const LEAVE_TYPE_COLOR: Record<string, string> = {
    annual: 'bg-primary-50 text-primary-700',
    half_am: 'bg-purple-50 text-purple-700',
    half_pm: 'bg-purple-50 text-purple-700',
    special: 'bg-teal-50 text-teal-700',
    sick: 'bg-orange-50 text-orange-700',
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">휴가 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">휴가 승인 및 잔여 현황 관리</p>
      </div>

      {/* 탭 */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => setTab('approvals')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'approvals' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          승인 관리
          {requests.filter((r) => r.status === 'pending').length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs bg-warning-500 text-white rounded-full">
              {requests.filter((r) => r.status === 'pending').length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('balances')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'balances' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          직원별 잔여 현황
        </button>
      </div>

      {/* 승인 관리 탭 */}
      {tab === 'approvals' && (
        <div className="space-y-3">
          {requests.map((req) => (
            <div
              key={req.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary-700">
                      {req.employee?.name?.charAt(0) ?? '?'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{req.employee?.name}</span>
                      <span className="text-xs text-gray-400">{req.employee?.department}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEAVE_TYPE_COLOR[req.type]}`}>
                        {LEAVE_TYPE_LABEL[req.type]}
                      </span>
                      <span className="text-xs text-gray-400">
                        {req.start_date}
                        {req.start_date !== req.end_date && ` ~ ${req.end_date}`}
                        <span className="ml-1">({req.days}일)</span>
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">{req.reason}</p>
                  </div>
                </div>
                <StatusBadge status={req.status} />
              </div>

              <div className="flex gap-2 mt-3">
                {req.status === 'pending' && (
                  <>
                    <button
                      onClick={() => handleApprove(req.id)}
                      className="flex-1 py-1.5 text-xs font-semibold bg-success-500 text-white rounded-lg hover:bg-success-600 transition-colors"
                    >
                      승인
                    </button>
                    <button
                      onClick={() => openReject(req.id)}
                      className="flex-1 py-1.5 text-xs font-semibold bg-white text-danger-600 border border-danger-300 rounded-lg hover:bg-danger-50 transition-colors"
                    >
                      반려
                    </button>
                  </>
                )}
                <button
                  onClick={() => setDeleteModal({ open: true, id: req.id, employeeName: req.employee?.name ?? '', days: req.days, status: req.status })}
                  className={`py-1.5 text-xs font-semibold text-danger-600 border border-danger-300 rounded-lg hover:bg-danger-50 transition-colors flex items-center justify-center gap-1 ${req.status === 'pending' ? 'px-3' : 'flex-1'}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  삭제
                </button>
              </div>
            </div>
          ))}
          {requests.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-10">대기 중인 휴가 신청이 없습니다</p>
          )}
        </div>
      )}

      {/* 직원별 잔여 현황 탭 */}
      {tab === 'balances' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
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
                      </td>
                      <td className="px-2 py-3 text-center text-sm text-gray-700">{b.total_days}일</td>
                      <td className="px-2 py-3 text-center text-sm text-warning-600 font-medium">{b.used_days}일</td>
                      <td className="px-2 py-3 text-center text-sm text-primary-600 font-bold">{b.remaining_days}일</td>
                      <td className="px-2 py-3 text-center text-sm text-teal-600 font-bold">
                        {(b.substitute_total ?? 0) - (b.substitute_used ?? 0)}일
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
      )}

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
              <span className="font-semibold">{adjustModal.employeeName}</span>의 잔여 연차를 조정합니다
            </p>

            {/* +/- 입력 */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                type="button"
                onClick={() => setAdjustModal((p) => ({ ...p, delta: p.delta - 1 }))}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <Minus className="w-4 h-4 text-gray-600" />
              </button>
              <div className="text-center">
                <span className={`text-3xl font-black ${adjustModal.delta > 0 ? 'text-primary-600' : adjustModal.delta < 0 ? 'text-danger-600' : 'text-gray-400'}`}>
                  {adjustModal.delta > 0 ? '+' : ''}{adjustModal.delta}
                </span>
                <p className="text-xs text-gray-400 mt-0.5">일</p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModal((p) => ({ ...p, delta: p.delta + 1 }))}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4 text-gray-600" />
              </button>
            </div>

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
                disabled={adjustModal.delta === 0 || !adjustModal.reason.trim()}
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

            {/* 일수 입력 */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({ ...p, days: Math.max(0.5, p.days - 0.5) }))}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <Minus className="w-4 h-4 text-gray-600" />
              </button>
              <div className="text-center">
                <span className="text-3xl font-black text-teal-600">
                  +{subGrantModal.days}
                </span>
                <p className="text-xs text-gray-400 mt-0.5">일</p>
              </div>
              <button
                type="button"
                onClick={() => setSubGrantModal((p) => ({ ...p, days: p.days + 0.5 }))}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4 text-gray-600" />
              </button>
            </div>

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
                disabled={subGrantModal.days <= 0 || !subGrantModal.reason.trim()}
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

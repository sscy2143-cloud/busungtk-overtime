import { useState, useEffect } from 'react'
import { markAsSeen } from '../hooks/useUnseenCounts'
import { useSearchParams } from 'react-router-dom'
import { CheckSquare, X, Clock, History, Banknote, RefreshCw, Users } from 'lucide-react'
import { StatusBadge } from '../components/common/StatusBadge'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { OvertimeRequest, ApprovalHistory, OvertimeType } from '../types'
import { REQUEST_STATUS_LABEL, OVERTIME_TYPE_LABEL } from '../types'


interface RejectModalState {
  open: boolean
  id: string
  reason: string
}

interface TimeEditModalState {
  open: boolean
  id: string
  start: string
  end: string
  reason: string
}

interface RevokeModalState {
  open: boolean
  id: string
  reason: string
}

interface HistoryModalState {
  open: boolean
  requestId: string
  entries: ApprovalHistory[]
}

interface ApproveChoiceModal {
  open: boolean
  id: string
  employeeId: string
  totalHours: number
  compLeaveHours: number
  date: string
  empName: string
}

export function AdminApprovalsPage() {
  const { employee } = useAuth()
  const isAdminRole = employee?.role === 'admin'
  const [searchParams] = useSearchParams()

  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(
    searchParams.get('employee')
  )
  const [overtimes, setOvertimes] = useState<(OvertimeRequest & { weeklyHours: number })[]>([])
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [rejectModal, setRejectModal] = useState<RejectModalState>({ open: false, id: '', reason: '' })
  const [timeEditModal, setTimeEditModal] = useState<TimeEditModalState>({ open: false, id: '', start: '', end: '', reason: '' })
  const [revokeModal, setRevokeModal] = useState<RevokeModalState>({ open: false, id: '', reason: '' })
  const [historyModal, setHistoryModal] = useState<HistoryModalState>({ open: false, requestId: '', entries: [] })
  const [approveChoiceModal, setApproveChoiceModal] = useState<ApproveChoiceModal>({ open: false, id: '', employeeId: '', totalHours: 0, compLeaveHours: 0, date: '', empName: '' })
  const [detailModal, setDetailModal] = useState<string | null>(null)
  const [managerApproveConfirm, setManagerApproveConfirm] = useState<{ open: boolean; id: string }>({ open: false, id: '' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listFilter, setListFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'>('pending')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'danger' } | null>(null)

  function showToast(message: string, type: 'success' | 'danger') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2000)
  }

  useEffect(() => {
    fetchOvertimes()
  }, [])

  async function fetchOvertimes() {
    const { data, error } = await supabase
      .from('overtime_requests')
      .select('*, employee:employees!overtime_requests_employee_id_fkey(id, name, department), approver:employees!overtime_requests_approved_by_fkey(id, name, role)')
      .order('created_at', { ascending: false })

    if (!error && data) {
      const mapped = data.map((r) => ({ ...r, weeklyHours: 0 })) as (OvertimeRequest & { weeklyHours: number })[]
      setOvertimes(mapped)
      const firstPending = mapped.find(r => r.status === 'pending' || r.status === 'manager_approved')
      if (firstPending) {
        setSelectedId(prev => prev ?? firstPending.id)
      }
    }
  }

  // 승인/번복 이력 기록
  async function recordHistory(
    requestId: string,
    requestType: 'overtime' | 'leave',
    fromStatus: string,
    toStatus: string,
    reason: string | null,
  ) {
    await supabase.from('approval_history').insert({
      request_id: requestId,
      request_type: requestType,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: employee?.id ?? '',
      reason,
    })
  }

  // 2단계 승인 (대표 + 인사담당자 모두 승인해야 최종 approved)
  async function handleApprove(id: string) {
    const req = overtimes.find(r => r.id === id)
    if (!req) return

    const now = new Date().toISOString()
    const myRole = employee?.role
    const updateFields: Record<string, unknown> = {}

    if (myRole === 'admin') {
      if (req.approved_at) return
      updateFields.approved_by = employee?.id ?? null
      updateFields.approved_at = now
      updateFields.status = req.manager_approved_at ? 'approved' : 'manager_approved'
    } else {
      if ((req as any).manager_approved_at) return
      updateFields.manager_approved_by = employee?.id ?? null
      updateFields.manager_approved_at = now
      updateFields.status = req.approved_at ? 'approved' : 'manager_approved'
    }

    const { error } = await supabase
      .from('overtime_requests')
      .update(updateFields)
      .eq('id', id)

    if (error) {
      console.error('승인 실패:', error.message)
      alert('승인 처리에 실패했습니다: ' + error.message)
      return
    }

    await recordHistory(id, 'overtime', req.status, updateFields.status as string, null)
    await fetchOvertimes()
    setCheckedIds((prev) => { const s = new Set(prev); s.delete(id); return s })
    showToast(updateFields.status === 'approved' ? '최종 승인 처리되었습니다' : '1차 승인 처리되었습니다', 'success')
  }

  function openApproveChoice(id: string) {
    const req = overtimes.find(r => r.id === id)
    if (!req) return
    const [sh, sm] = req.planned_start.split(':').map(Number)
    const [eh, em] = req.planned_end.split(':').map(Number)
    let mins = (eh * 60 + em) - (sh * 60 + sm)
    if (mins < 0) mins += 24 * 60
    const hours = Math.round(mins / 60 * 10) / 10
    setApproveChoiceModal({
      open: true,
      id,
      employeeId: req.employee_id,
      totalHours: hours,
      compLeaveHours: hours,
      date: req.date,
      empName: (req.employee as any)?.name ?? '',
    })
  }

  async function confirmApproveAsCompLeave() {
    const { id, employeeId, compLeaveHours, date } = approveChoiceModal
    if (compLeaveHours <= 0) return

    const req = overtimes.find(r => r.id === id)
    if (!req) return

    const now = new Date().toISOString()
    const myRole = employee?.role
    const updateFields: Record<string, unknown> = {}

    if (myRole === 'admin') {
      updateFields.approved_by = employee?.id ?? null
      updateFields.approved_at = now
      updateFields.status = (req as any).manager_approved_at ? 'approved' : 'manager_approved'
    } else {
      updateFields.manager_approved_by = employee?.id ?? null
      updateFields.manager_approved_at = now
      updateFields.status = req.approved_at ? 'approved' : 'manager_approved'
    }

    const { error } = await supabase
      .from('overtime_requests')
      .update(updateFields)
      .eq('id', id)

    if (error) {
      console.error('승인 실패:', error.message)
      alert('승인 처리에 실패했습니다: ' + error.message)
      return
    }

    await recordHistory(id, 'overtime', req.status, updateFields.status as string, `대체휴가 ${compLeaveHours}시간 전환`)

    // 둘 다 승인 완료 시에만 대체휴가 부여
    if (updateFields.status === 'approved') {
      const grantedDays = compLeaveHours / 8
      await supabase.from('substitute_history').insert({
        employee_id: employeeId,
        granted_days: grantedDays,
        reason: `야근 대체전환: ${date} (${compLeaveHours}시간)`,
        granted_by: employee?.id ?? '',
        related_request_id: id,
      })

      const year = new Date().getFullYear()
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('substitute_total')
        .eq('employee_id', employeeId)
        .eq('year', year)
        .maybeSingle()

      if (bal) {
        await supabase
          .from('leave_balances')
          .update({ substitute_total: (bal.substitute_total ?? 0) + grantedDays })
          .eq('employee_id', employeeId)
          .eq('year', year)
      } else {
        await supabase
          .from('leave_balances')
          .insert({ employee_id: employeeId, year, substitute_total: grantedDays, total_days: 0, used_days: 0, substitute_used: 0 })
      }
    }

    await fetchOvertimes()
    setCheckedIds(prev => { const s = new Set(prev); s.delete(id); return s })
    setApproveChoiceModal({ open: false, id: '', employeeId: '', totalHours: 0, compLeaveHours: 0, date: '', empName: '' })
    showToast(updateFields.status === 'approved' ? '최종 승인 처리되었습니다' : '1차 승인 처리되었습니다', 'success')
  }

  function openReject(id: string) {
    setRejectModal({ open: true, id, reason: '' })
  }

  async function confirmReject() {
    const { id, reason } = rejectModal
    const req = overtimes.find((r) => r.id === id)
    const fromStatus = req?.status ?? 'pending'

    const { error } = await supabase
      .from('overtime_requests')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', id)

    if (error) {
      void error
      return
    }

    await recordHistory(id, 'overtime', fromStatus as any, 'rejected', reason)
    setOvertimes((prev) => {
      const updated = prev.map((r) => r.id === id ? { ...r, status: 'rejected' as const, rejection_reason: reason } : r)
      const nextPending = updated.find(r => r.id !== id && (r.status === 'pending' || r.status === 'manager_approved'))
      if (nextPending) setSelectedId(nextPending.id)
      return updated
    })
    setCheckedIds((prev) => { const s = new Set(prev); s.delete(id); return s })
    setRejectModal({ open: false, id: '', reason: '' })
    showToast('반려 처리되었습니다', 'danger')
  }

  async function handleBulkApprove() {
    const ids = Array.from(checkedIds)
    const now = new Date().toISOString()
    const myRole = employee?.role

    for (const id of ids) {
      const req = overtimes.find(r => r.id === id)
      if (!req) continue

      const updateFields: Record<string, unknown> = {}
      if (myRole === 'admin') {
        if (req.approved_at) continue
        updateFields.approved_by = employee?.id ?? null
        updateFields.approved_at = now
        updateFields.status = (req as any).manager_approved_at ? 'approved' : 'manager_approved'
      } else {
        if ((req as any).manager_approved_at) continue
        updateFields.manager_approved_by = employee?.id ?? null
        updateFields.manager_approved_at = now
        updateFields.status = req.approved_at ? 'approved' : 'manager_approved'
      }

      await supabase
        .from('overtime_requests')
        .update(updateFields)
        .eq('id', id)
      await recordHistory(id, 'overtime', req.status, updateFields.status as string, null)
    }

    await fetchOvertimes()
    setCheckedIds(new Set())
    showToast('일괄 승인 처리되었습니다', 'success')
  }

  function openTimeEdit(id: string) {
    const req = overtimes.find((r) => r.id === id)
    if (!req) return
    setTimeEditModal({ open: true, id, start: req.planned_start, end: req.planned_end, reason: '' })
  }

  async function confirmTimeEdit() {
    const { id, start, end, reason } = timeEditModal
    const req = overtimes.find(r => r.id === id)
    if (!req) return

    const { error } = await supabase
      .from('overtime_requests')
      .update({
        original_start: req.planned_start,
        original_end: req.planned_end,
        planned_start: start,
        planned_end: end,
        adjusted_by: employee?.id,
        adjusted_at: new Date().toISOString(),
        adjustment_reason: reason,
      })
      .eq('id', id)

    if (error) {
      console.error('시간 조정 실패:', error.message)
      alert('시간 조정에 실패했습니다: ' + error.message)
      return
    }

    await recordHistory(id, 'overtime', req.status, req.status, `시간 조정: ${start} ~ ${end} (사유: ${reason})`)

    setOvertimes((prev) =>
      prev.map((r) => r.id === id ? { ...r, planned_start: start, planned_end: end, adjusted_by: employee?.id, adjusted_at: new Date().toISOString(), adjustment_reason: reason, original_start: req.planned_start, original_end: req.planned_end } : r),
    )
    setTimeEditModal({ open: false, id: '', start: '', end: '', reason: '' })
    showToast('시간 조정이 등록되었습니다. 인사담당자 확인 대기 중', 'success')
  }

  async function confirmAdjustment(id: string) {
    const { error } = await supabase
      .from('overtime_requests')
      .update({
        adjustment_confirmed_by: employee?.id,
        adjustment_confirmed_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      console.error('조정 확인 실패:', error.message)
      alert('조정 확인에 실패했습니다: ' + error.message)
      return
    }

    await recordHistory(id, 'overtime', 'pending', 'pending', '시간 조정 확인 완료')

    setOvertimes((prev) =>
      prev.map((r) => r.id === id ? { ...r, adjustment_confirmed_by: employee?.id, adjustment_confirmed_at: new Date().toISOString() } : r),
    )
    showToast('시간 조정을 확인했습니다', 'success')
  }

  // 승인 취소 (번복)
  function openRevokeModal(id: string) {
    setRevokeModal({ open: true, id, reason: '' })
  }

  async function confirmRevoke() {
    const { id, reason } = revokeModal
    if (!reason.trim()) return

    const { error } = await supabase
      .from('overtime_requests')
      .update({
        status: 'pending',
        approved_by: null,
        approved_at: null,
        rejection_reason: reason,
      })
      .eq('id', id)

    if (error) {
      void error
      return
    }

    await recordHistory(id, 'overtime', 'approved', 'pending', reason)
    setOvertimes((prev) => prev.map((r) =>
      r.id === id ? { ...r, status: 'pending', approved_by: null, approved_at: null, rejection_reason: reason } : r,
    ))
    setRevokeModal({ open: false, id: '', reason: '' })
    showToast('승인이 취소되었습니다', 'danger')
  }

  // 이력 조회
  async function openHistoryModal(id: string) {
    const { data } = await supabase
      .from('approval_history')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true })

    setHistoryModal({
      open: true,
      requestId: id,
      entries: (data ?? []) as ApprovalHistory[],
    })
  }

  const employees = Array.from(
    new Map(overtimes.map(r => [r.employee_id, (r.employee as any)?.name ?? r.employee_id])).entries()
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  const filteredOvertimes = selectedEmployee ? overtimes.filter(r => r.employee_id === selectedEmployee) : overtimes

  const STATUS_COLOR: Record<string, string> = {
    pending: 'text-warning-600',
    approved: 'text-success-600',
    rejected: 'text-danger-600',
    cancelled: 'text-dark-500',
  }

  // list filter counts
  const listFilteredOvertimes = filteredOvertimes.filter((r) => {
    if (listFilter === 'pending') return r.status === 'pending' || r.status === 'manager_approved'
    if (listFilter === 'approved') return r.status === 'approved'
    if (listFilter === 'rejected') return r.status === 'rejected'
    if (listFilter === 'cancelled') return r.status === 'cancelled'
    return true
  })

  const countAll = filteredOvertimes.length
  const countPending = filteredOvertimes.filter(r => r.status === 'pending' || r.status === 'manager_approved').length
  const countApproved = filteredOvertimes.filter(r => r.status === 'approved').length
  const countRejected = filteredOvertimes.filter(r => r.status === 'rejected').length
  const countCancelled = filteredOvertimes.filter(r => r.status === 'cancelled').length

  const selectedReq = selectedId ? overtimes.find(r => r.id === selectedId) ?? null : null

  useEffect(() => {
    if (selectedId && employee?.id) {
      markAsSeen('overtime', employee.id, selectedId)
    }
  }, [selectedId, employee?.id])

  return (
    <div className="flex flex-col h-full min-h-0 space-y-3">
      {/* 승인 대기 배너 */}
      {countPending > 0 && (
        <div className="flex items-center gap-3 bg-warning-50 border border-warning-200 rounded-xl px-4 py-3 shrink-0">
          <span className="text-2xl font-black text-warning-600">{countPending}</span>
          <span className="text-sm font-semibold text-warning-700">건의 야근 신청이 승인 대기 중입니다</span>
        </div>
      )}

      {/* 페이지 헤더 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-dark-900">야근 승인 관리</h1>
          <p className="text-sm text-dark-500 mt-0.5">야근 신청을 검토하고 처리하세요</p>
        </div>
        {/* 일괄 승인 바 (대표만) */}
        {isAdminRole && checkedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-primary-50 border border-primary-200 rounded-xl px-4 py-2">
            <span className="text-sm text-primary-700 font-medium">{checkedIds.size}건 선택됨</span>
            <button
              onClick={handleBulkApprove}
              className="flex items-center gap-1.5 text-sm font-semibold text-white bg-primary-500 px-3 py-1.5 rounded-lg hover:bg-primary-600 transition-colors"
            >
              <CheckSquare className="w-4 h-4" />
              일괄 승인
            </button>
          </div>
        )}
      </div>

      {/* 직원 필터 */}
      {employees.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 shrink-0">
          <button
            onClick={() => setSelectedEmployee(null)}
            className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              selectedEmployee === null
                ? 'bg-dark-800 text-white border-dark-800'
                : 'bg-white text-dark-500 border-dark-200 hover:border-dark-300'
            }`}
          >
            전체
          </button>
          {employees.map(({ id, name }) => (
            <button
              key={id}
              onClick={() => setSelectedEmployee(selectedEmployee === id ? null : id)}
              className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                selectedEmployee === id
                  ? 'bg-primary-500 text-white border-primary-600'
                  : 'bg-white text-dark-500 border-dark-200 hover:border-dark-300'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* KakaoWork-style split panel */}
      <div className="flex flex-col lg:flex-row gap-0 bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden flex-1 min-h-0" style={{ minHeight: '520px' }}>

        {/* ── LEFT PANEL: list ── */}
        <div className={`flex flex-col lg:w-[500px] lg:min-w-[500px] lg:max-w-[500px] border-b lg:border-b-0 lg:border-r border-dark-100 ${selectedId ? 'hidden lg:flex' : 'flex'}`}>

          {/* Tab filter */}
          <div className="px-3 pt-3 pb-2 border-b border-dark-100 shrink-0">
            <div className="flex gap-1.5">
              {(
                [
                  { key: 'all', label: '전체', count: countAll },
                  { key: 'pending', label: '대기중', count: countPending },
                  { key: 'approved', label: '승인', count: countApproved },
                  { key: 'rejected', label: '반려', count: countRejected },
                  { key: 'cancelled', label: '취소', count: countCancelled },
                ] as const
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setListFilter(key)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    listFilter === key
                      ? 'bg-primary-500 text-white border-primary-600'
                      : 'bg-white text-dark-500 border-dark-200 hover:border-dark-300'
                  }`}
                >
                  {label}
                  <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full leading-none ${
                    listFilter === key ? 'bg-white/30 text-white' : 'bg-dark-100 text-dark-500'
                  }`}>{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* List items */}
          <div className="flex-1 overflow-y-auto divide-y divide-dark-50">
            {listFilteredOvertimes.length === 0 ? (
              <p className="text-center text-sm text-dark-400 py-10">해당 건이 없습니다</p>
            ) : (
              listFilteredOvertimes.map((req) => {
                const [sh, sm] = req.planned_start.split(':').map(Number)
                const [eh, em] = req.planned_end.split(':').map(Number)
                let mins = (eh * 60 + em) - (sh * 60 + sm)
                if (mins < 0) mins += 24 * 60
                const hours = (mins / 60).toFixed(1)
                const isSelected = selectedId === req.id
                return (
                  <button
                    key={req.id}
                    onClick={() => setSelectedId(req.id)}
                    className={`w-full text-left px-4 py-3 transition-colors relative ${
                      isSelected
                        ? 'bg-primary-50 border-l-2 border-primary-500'
                        : 'hover:bg-dark-50/60 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-dark-900 truncate">
                          {(req.employee as any)?.name ?? '-'}
                        </p>
                        <p className="text-xs text-dark-500 mt-0.5 truncate">
                          {req.date} · {hours}h · {OVERTIME_TYPE_LABEL[req.type as OvertimeType] ?? req.type}
                        </p>
                        {(req as any).manager_approved_at && (
                          <span className="inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-success-50 text-success-700 border border-success-200">인사확인완료</span>
                        )}
                        {(req as any).adjusted_by && !(req as any).adjustment_confirmed_by && (
                          <span className="inline-block mt-1 text-[10px] font-bold text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">조정대기</span>
                        )}
                      </div>
                      <span className={`text-[11px] font-semibold shrink-0 mt-0.5 ${STATUS_COLOR[req.status] ?? 'text-dark-500'}`}>
                        {REQUEST_STATUS_LABEL[req.status] ?? req.status}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL: detail + actions ── */}
        <div className={`flex-1 flex flex-col min-w-0 ${selectedId ? 'flex' : 'hidden lg:flex'}`}>
          {selectedReq ? (() => {
            const req = selectedReq
            const emp = (req as any).employee
            const [sh, sm] = req.planned_start.split(':').map(Number)
            const [eh, em] = req.planned_end.split(':').map(Number)
            let totalMins = (eh * 60 + em) - (sh * 60 + sm)
            if (totalMins < 0) totalMins += 24 * 60
            const hours = (totalMins / 60).toFixed(1)

            return (
              <div className="flex flex-col h-full">
                {/* Detail header */}
                <div className="px-5 py-4 border-b border-dark-100 flex items-start justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Back button on mobile */}
                    <button
                      onClick={() => setSelectedId(null)}
                      className="lg:hidden shrink-0 p-1.5 rounded-lg hover:bg-dark-100 text-dark-500"
                      aria-label="목록으로"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-base font-bold text-dark-900">{emp?.name ?? '-'}</p>
                        {emp?.department && (
                          <span className="text-xs text-dark-500 bg-dark-100 px-2 py-0.5 rounded-full">{emp.department}</span>
                        )}
                        <StatusBadge status={req.status} />
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => openHistoryModal(req.id)}
                    className="shrink-0 flex items-center gap-1 text-xs text-dark-500 hover:text-dark-700 border border-dark-200 rounded-lg px-2.5 py-1.5 hover:bg-dark-50 transition-colors"
                  >
                    <History className="w-3.5 h-3.5" />
                    이력
                  </button>
                </div>

                {/* Detail fields */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2.5 text-sm">
                    <span className="text-dark-500 font-medium pt-0.5">날짜</span>
                    <span className="text-dark-900 font-semibold">{req.date}</span>

                    <span className="text-dark-500 font-medium pt-0.5">유형</span>
                    <span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-primary-50 text-primary-700">
                        {OVERTIME_TYPE_LABEL[req.type as OvertimeType] ?? req.type}
                      </span>
                    </span>

                    <span className="text-dark-500 font-medium pt-0.5">근무시간</span>
                    <span className="text-dark-900">
                      {req.planned_start} ~ {req.planned_end}
                      <span className="ml-2 text-xs text-primary-600 font-bold bg-primary-50 px-1.5 py-0.5 rounded">{hours}시간</span>
                    </span>

                    <span className="text-dark-500 font-medium pt-0.5">총 시간</span>
                    <span className="text-dark-900 font-bold">{hours}h</span>

                    {(req as any).adjusted_by && (
                      <div className="col-span-2 mt-2 p-2.5 bg-primary-50 rounded-lg border border-primary-100">
                        <p className="text-xs font-semibold text-primary-700 mb-1">근무시간 조정</p>
                        {(req as any).original_start && (
                          <p className="text-xs text-dark-500">변경 전: {(req as any).original_start} ~ {(req as any).original_end}</p>
                        )}
                        <p className="text-xs text-dark-500">변경 후: {req.planned_start} ~ {req.planned_end}</p>
                        <p className="text-xs text-dark-600 mt-1">{(req as any).adjustment_reason}</p>
                        {(req as any).adjustment_confirmed_by ? (
                          <p className="text-xs text-success-600 font-medium mt-1">✓ 인사담당 확인 완료</p>
                        ) : (
                          <p className="text-xs text-warning-600 font-medium mt-1">인사담당 확인 대기</p>
                        )}
                      </div>
                    )}

                    <span className="text-dark-500 font-medium pt-0.5">야간근로 유형</span>
                    <span className="text-dark-800">{req.work_category || '-'}</span>

                    <span className="text-dark-500 font-medium pt-0.5">현장명</span>
                    <span className="text-dark-800">{req.site_name || '-'}</span>

                    <span className="text-dark-500 font-medium pt-0.5">작업내용</span>
                    <span className="text-dark-800 whitespace-pre-wrap">{req.work_details || '-'}</span>

                    {req.reason && (
                      <>
                        <span className="text-dark-500 font-medium pt-0.5">기타</span>
                        <span className="text-dark-800 whitespace-pre-wrap">{req.reason}</span>
                      </>
                    )}

                    {(req.status === 'approved' || req.status === 'manager_approved') && (
                      <>
                        <span className="text-dark-500 font-medium pt-0.5">대표</span>
                        <span className={req.approved_at ? 'text-success-600 font-medium' : 'text-dark-300'}>
                          {req.approved_at ? `승인완료 ${new Date(req.approved_at).toLocaleDateString('ko-KR')}` : '미승인'}
                        </span>
                        <span className="text-dark-500 font-medium pt-0.5">인사담당</span>
                        <span className={(req as any).manager_approved_at ? 'text-success-600 font-medium' : 'text-dark-300'}>
                          {(req as any).manager_approved_at ? `승인완료 ${new Date((req as any).manager_approved_at).toLocaleDateString('ko-KR')}` : '미승인'}
                        </span>
                      </>
                    )}

                    {req.status === 'rejected' && req.rejection_reason && (
                      <>
                        <span className="text-danger-600 font-medium pt-0.5">반려사유</span>
                        <span className="text-danger-600">{req.rejection_reason}</span>
                      </>
                    )}
                  </div>

                  {/* 같은 날짜 신청 비교 (관리자만) */}
                  {(isAdminRole || employee?.role === 'manager') && (() => {
                    const sameDateReqs = overtimes.filter(r => r.id !== req.id && r.date === req.date)
                    if (sameDateReqs.length === 0) return null

                    const calcHours = (start: string, end: string) => {
                      const [sh2, sm2] = start.split(':').map(Number)
                      const [eh2, em2] = end.split(':').map(Number)
                      let mins = (eh2 * 60 + em2) - (sh2 * 60 + sm2)
                      if (mins < 0) mins += 24 * 60
                      return (mins / 60).toFixed(1)
                    }

                    return (
                      <div className="mt-3 p-3 bg-dark-50 rounded-xl border border-dark-100">
                        <p className="text-xs font-bold text-dark-700 mb-2">같은 날짜 신청 비교 ({req.date})</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-dark-200">
                                <th className="text-left py-1.5 pr-2 font-semibold text-dark-600">이름</th>
                                <th className="text-left py-1.5 pr-2 font-semibold text-dark-600">시간</th>
                                <th className="text-right py-1.5 font-semibold text-dark-600">총</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-b border-dark-100 bg-primary-50/50">
                                <td className="py-1.5 pr-2 font-semibold text-primary-700">{emp?.name}</td>
                                <td className="py-1.5 pr-2 text-dark-800">{req.planned_start}~{req.planned_end}</td>
                                <td className="py-1.5 text-right font-bold text-primary-600">{hours}h</td>
                              </tr>
                              {sameDateReqs.map(sr => {
                                const srEmp = (sr as any).employee
                                const srHours = calcHours(sr.planned_start, sr.planned_end)
                                return (
                                  <tr key={sr.id} className="border-b border-dark-100 cursor-pointer hover:bg-dark-100/50" onClick={() => setSelectedId(sr.id)}>
                                    <td className="py-1.5 pr-2 font-medium text-dark-700">{srEmp?.name ?? '-'}</td>
                                    <td className="py-1.5 pr-2 text-dark-800">{sr.planned_start}~{sr.planned_end}</td>
                                    <td className="py-1.5 text-right font-bold text-dark-700">{srHours}h</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* Action buttons */}
                {(isAdminRole || employee?.role === 'manager') && (
                  <div className="px-5 py-4 border-t border-dark-100 flex flex-col gap-2 shrink-0">
                    {(req.status === 'pending' || req.status === 'manager_approved') && (
                      <>
                        <button
                          onClick={() => isAdminRole ? setManagerApproveConfirm({ open: true, id: req.id }) : openApproveChoice(req.id)}
                          className="w-full flex items-center justify-center gap-2 py-3.5 text-base font-bold text-white bg-success-500 rounded-xl hover:bg-success-600 transition-colors"
                        >
                          <CheckSquare className="w-5 h-5" />
                          승인
                        </button>
                        <button
                          onClick={() => openReject(req.id)}
                          className="w-full flex items-center justify-center gap-2 py-3.5 text-base font-bold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors"
                        >
                          <X className="w-5 h-5" />
                          반려
                        </button>
                        {isAdminRole && (
                          <button
                            onClick={() => openTimeEdit(req.id)}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-dark-700 border border-dark-200 rounded-xl hover:bg-dark-50 transition-colors"
                          >
                            <Clock className="w-4 h-4" />
                            근무시간 조정
                          </button>
                        )}
                      </>
                    )}
                    {!isAdminRole && (req as any).adjusted_by && !(req as any).adjustment_confirmed_by && (
                      <button
                        onClick={() => confirmAdjustment(req.id)}
                        className="w-full flex items-center justify-center gap-2 py-3.5 text-base font-bold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
                      >
                        <CheckSquare className="w-5 h-5" />
                        조정 확인
                      </button>
                    )}
                    {req.status === 'approved' && (
                      <>
                        <button
                          onClick={() => openReject(req.id)}
                          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors"
                        >
                          <X className="w-4 h-4" />
                          반려로 변경
                        </button>
                        <button
                          onClick={() => openTimeEdit(req.id)}
                          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-dark-700 border border-dark-200 rounded-xl hover:bg-dark-50 transition-colors"
                        >
                          <Clock className="w-4 h-4" />
                          근무시간 수정
                        </button>
                        {isAdminRole && (
                          <button
                            onClick={() => openRevokeModal(req.id)}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-warning-700 border border-warning-300 bg-warning-50 rounded-xl hover:bg-warning-100 transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                            승인취소 (대기로)
                          </button>
                        )}
                      </>
                    )}
                    <button
                      onClick={() => setDetailModal(req.id)}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50 transition-colors"
                    >
                      상세보기
                    </button>
                  </div>
                )}
              </div>
            )
          })() : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
              <div className="w-12 h-12 rounded-2xl bg-dark-100 flex items-center justify-center mb-3">
                <CheckSquare className="w-6 h-6 text-dark-400" />
              </div>
              <p className="text-sm font-medium text-dark-500">신청 건을 선택하세요</p>
              <p className="text-xs text-dark-400 mt-1">왼쪽 목록에서 항목을 클릭하면 상세 내용이 표시됩니다</p>
            </div>
          )}
        </div>
      </div>

      {/* 반려 사유 모달 */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRejectModal({ open: false, id: '', reason: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">반려 사유 입력</h3>
              <button onClick={() => setRejectModal({ open: false, id: '', reason: '' })}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <textarea
              className="w-full border border-dark-200 rounded-xl px-3 py-2.5 text-sm text-dark-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={3}
              placeholder="반려 사유를 입력하세요 (신청자에게 전달됩니다)"
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRejectModal({ open: false, id: '', reason: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmReject}
                disabled={!rejectModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                반려
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 승인 취소(번복) 모달 */}
      {revokeModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRevokeModal({ open: false, id: '', reason: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">승인 취소</h3>
              <button onClick={() => setRevokeModal({ open: false, id: '', reason: '' })}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-sm text-dark-600 mb-3">
              승인을 취소하면 해당 건이 <span className="font-semibold text-warning-600">대기 상태</span>로 되돌아갑니다.
            </p>
            <textarea
              className="w-full border border-dark-200 rounded-xl px-3 py-2.5 text-sm text-dark-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={3}
              placeholder="승인 취소 사유를 입력하세요 (필수)"
              value={revokeModal.reason}
              onChange={(e) => setRevokeModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRevokeModal({ open: false, id: '', reason: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmRevoke}
                disabled={!revokeModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-warning-500 rounded-xl hover:bg-warning-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                승인 취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 시간 수정 모달 (대표 전용) */}
      {timeEditModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setTimeEditModal({ open: false, id: '', start: '', end: '', reason: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">근무시간 조정</h3>
              <button onClick={() => setTimeEditModal({ open: false, id: '', start: '', end: '', reason: '' })}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-xs text-dark-500 mb-4">제출된 시간을 검토하고 인정 시간을 조정합니다. 인사담당자 확인 후 적용됩니다.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">
                  <Clock className="w-3.5 h-3.5 inline mr-1" />시작 시간
                </label>
                <input
                  type="time"
                  value={timeEditModal.start}
                  onChange={(e) => setTimeEditModal((p) => ({ ...p, start: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">
                  <Clock className="w-3.5 h-3.5 inline mr-1" />종료 시간
                </label>
                <input
                  type="time"
                  value={timeEditModal.end}
                  onChange={(e) => setTimeEditModal((p) => ({ ...p, end: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">조정 사유</label>
                <div className="flex gap-1.5 mb-2">
                  <button
                    type="button"
                    onClick={() => setTimeEditModal((p) => ({ ...p, reason: '근무시간 확인 보정' }))}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${timeEditModal.reason === '근무시간 확인 보정' ? 'bg-primary-500 text-white border-primary-600' : 'bg-white text-dark-500 border-dark-200 hover:border-dark-300'}`}
                  >
                    근무시간 확인 보정
                  </button>
                </div>
                <textarea
                  value={timeEditModal.reason}
                  onChange={(e) => setTimeEditModal((p) => ({ ...p, reason: e.target.value }))}
                  placeholder="조정 사유를 입력하세요"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setTimeEditModal({ open: false, id: '', start: '', end: '', reason: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmTimeEdit}
                disabled={!timeEditModal.start || !timeEditModal.end || !timeEditModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-success-500 rounded-xl hover:bg-success-600 disabled:opacity-40 transition-colors"
              >
                조정 등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 신청 상세 모달 — 공문 스타일 */}
      {detailModal && (() => {
        const req = overtimes.find(r => r.id === detailModal)
        if (!req) return null
        const emp = (req as any).employee
        const approver = (req as any).approver
        const [sh, sm] = req.planned_start.split(':').map(Number)
        const [eh, em] = req.planned_end.split(':').map(Number)
        let totalMins = (eh * 60 + em) - (sh * 60 + sm)
        if (totalMins < 0) totalMins += 24 * 60
        const hours = (totalMins / 60).toFixed(1)
        const TYPE_LABEL: Record<string, string> = { extended: '연장근무', night: '야간근무', holiday: '휴일근무' }
        const dateObj = new Date(req.date)
        const dayNames = ['일', '월', '화', '수', '목', '금', '토']
        const dayOfWeek = dayNames[dateObj.getDay()]
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6
        const createdDate = new Date(req.created_at)

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDetailModal(null)} />
            <div className="relative bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">

              {/* 헤더 — 공문 제목 */}
              <div className="bg-dark-800 px-6 py-5 text-center">
                <p className="text-xs text-dark-300 tracking-widest mb-1">부성티케이</p>
                <h3 className="text-lg font-bold text-white tracking-wide">연장근무 신청서</h3>
                <p className="text-xs text-dark-400 mt-1">
                  문서번호 {req.id.slice(0, 8).toUpperCase()}
                </p>
              </div>

              {/* 본문 */}
              <div className="px-6 py-5 space-y-5">

                {/* 신청자 정보 */}
                <div>
                  <p className="text-[11px] font-bold text-dark-400 tracking-widest uppercase mb-2">신청자 정보</p>
                  <div className="border border-dark-200 rounded-xl overflow-hidden text-sm">
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">성명</div>
                      <div className="px-3 py-2.5 text-dark-900 font-semibold">{emp?.name ?? '-'}</div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">부서</div>
                      <div className="px-3 py-2.5 text-dark-800">{emp?.department ?? '-'}</div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">신청일시</div>
                      <div className="px-3 py-2.5 text-dark-800">
                        {createdDate.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 근무 내용 */}
                <div>
                  <p className="text-[11px] font-bold text-dark-400 tracking-widest uppercase mb-2">근무 내용</p>
                  <div className="border border-dark-200 rounded-xl overflow-hidden text-sm">
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">근무유형</div>
                      <div className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-dark-900 font-semibold">
                          {TYPE_LABEL[req.type] ?? req.type}
                          {isWeekend && <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full font-bold">주말</span>}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">근무일</div>
                      <div className="px-3 py-2.5 text-dark-900 font-semibold">
                        {req.date} <span className="text-dark-400 font-normal">({dayOfWeek})</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">근무시간</div>
                      <div className="px-3 py-2.5 text-dark-900">
                        <span className="font-semibold">{req.planned_start}</span>
                        <span className="text-dark-400 mx-1">~</span>
                        <span className="font-semibold">{req.planned_end}</span>
                        <span className="ml-2 text-xs text-primary-600 font-bold bg-primary-50 px-1.5 py-0.5 rounded">{hours}시간</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">야간근로 유형</div>
                      <div className="px-3 py-2.5 text-dark-800">{req.work_category || '-'}</div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">현장명</div>
                      <div className="px-3 py-2.5 text-dark-800">{req.site_name || '-'}</div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">작업내용</div>
                      <div className="px-3 py-2.5 text-dark-800 whitespace-pre-wrap">{req.work_details || '-'}</div>
                    </div>
                    {req.reason && (
                      <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                        <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">비고</div>
                        <div className="px-3 py-2.5 text-dark-800 whitespace-pre-wrap">{req.reason}</div>
                      </div>
                    )}
                    {req.group_id && (
                      <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                        <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">그룹신청</div>
                        <div className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                            <Users className="w-3 h-3" />
                            그룹 신청 건
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 처리 현황 */}
                <div>
                  <p className="text-[11px] font-bold text-dark-400 tracking-widest uppercase mb-2">처리 현황</p>
                  <div className="border border-dark-200 rounded-xl overflow-hidden text-sm">
                    <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200">
                      <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">상태</div>
                      <div className="px-3 py-2.5">
                        <StatusBadge status={req.status} />
                      </div>
                    </div>
                    {req.status === 'approved' && (
                      <>
                        <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                          <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">승인자</div>
                          <div className="px-3 py-2.5 text-success-700 font-medium">{approver?.name ?? '-'}</div>
                        </div>
                        {req.approved_at && (
                          <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                            <div className="bg-dark-50 px-3 py-2.5 font-medium text-dark-600">승인일시</div>
                            <div className="px-3 py-2.5 text-dark-800">
                              {new Date(req.approved_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {req.status === 'rejected' && req.rejection_reason && (
                      <div className="grid grid-cols-[100px_1fr] divide-x divide-dark-200 border-t border-dark-200">
                        <div className="bg-dark-50 px-3 py-2.5 font-medium text-danger-600">반려사유</div>
                        <div className="px-3 py-2.5 text-danger-600">{req.rejection_reason}</div>
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* 하단 액션 */}
              <div className="px-6 pb-5 flex gap-2">
                <button
                  onClick={() => openHistoryModal(req.id)}
                  className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50 flex items-center justify-center gap-1.5"
                >
                  <History className="w-3.5 h-3.5" />
                  이력
                </button>
                <button
                  onClick={() => setDetailModal(null)}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-dark-700 rounded-xl hover:bg-dark-800"
                >
                  닫기
                </button>
              </div>

            </div>
          </div>
        )
      })()}

      {/* 승인 확인 모달 (대표용) */}
      {managerApproveConfirm.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setManagerApproveConfirm({ open: false, id: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">승인 확인</h3>
              <button onClick={() => setManagerApproveConfirm({ open: false, id: '' })}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-sm text-dark-600 mb-5">이 연장근무 신청을 승인하시겠습니까?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setManagerApproveConfirm({ open: false, id: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={() => {
                  const id = managerApproveConfirm.id
                  setManagerApproveConfirm({ open: false, id: '' })
                  handleApprove(id)
                }}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-success-500 rounded-xl hover:bg-success-600 transition-colors"
              >
                승인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 승인 방식 선택 모달 */}
      {approveChoiceModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setApproveChoiceModal(p => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-dark-900">승인 방식 선택</h3>
              <button onClick={() => setApproveChoiceModal(p => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-xs text-dark-500 mb-4">
              <span className="font-semibold text-dark-700">{approveChoiceModal.empName}</span>
              {' · '}{approveChoiceModal.date}{' · '}{approveChoiceModal.totalHours}시간
            </p>
            <div className="space-y-2 mb-1">
              {/* 수당으로 승인 */}
              <button
                onClick={async () => {
                  setApproveChoiceModal(p => ({ ...p, open: false }))
                  await handleApprove(approveChoiceModal.id)
                }}
                className="w-full text-left px-4 py-3 border-2 border-primary-100 rounded-xl hover:border-blue-400 hover:bg-primary-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                    <Banknote className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-dark-800">수당으로 승인</p>
                    <p className="text-xs text-dark-500 mt-0.5">연장근무수당 계산에 포함됩니다</p>
                  </div>
                </div>
              </button>
              {/* 대체휴가로 승인 */}
              <div className="border-2 border-primary-200 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                    <RefreshCw className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-dark-800">대체휴가로 승인</p>
                    <p className="text-xs text-dark-500 mt-0.5">수당 대신 대체휴가로 부여됩니다</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-xs text-dark-600 shrink-0">부여 시간</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={approveChoiceModal.compLeaveHours}
                    onChange={e => setApproveChoiceModal(p => ({ ...p, compLeaveHours: parseFloat(e.target.value) || 0 }))}
                    className="flex-1 px-2 py-1.5 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 text-right"
                  />
                  <span className="text-xs text-dark-500 shrink-0">시간 = {(approveChoiceModal.compLeaveHours / 8).toFixed(1)}일</span>
                </div>
                <button
                  onClick={confirmApproveAsCompLeave}
                  disabled={approveChoiceModal.compLeaveHours <= 0}
                  className="w-full py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-500 disabled:opacity-40 transition-colors"
                >
                  대체휴가 {approveChoiceModal.compLeaveHours}시간 부여 후 승인
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 메시지 */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold text-white transition-all ${
          toast.type === 'success' ? 'bg-success-500' : 'bg-danger-500'
        }`}>
          {toast.message}
        </div>
      )}

      {/* 이력 조회 모달 */}
      {historyModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryModal({ open: false, requestId: '', entries: [] })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900 flex items-center gap-2">
                <History className="w-4 h-4" />
                승인 이력
              </h3>
              <button onClick={() => setHistoryModal({ open: false, requestId: '', entries: [] })}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>

            {historyModal.entries.length === 0 ? (
              <p className="text-sm text-dark-400 text-center py-6">이력이 없습니다</p>
            ) : (
              <div className="space-y-3">
                {historyModal.entries.map((entry, i) => (
                  <div key={entry.id} className="relative pl-6">
                    {/* 타임라인 라인 */}
                    {i < historyModal.entries.length - 1 && (
                      <div className="absolute left-[7px] top-5 bottom-0 w-px bg-dark-200" />
                    )}
                    {/* 타임라인 도트 */}
                    <div className={`absolute left-0 top-1 w-4 h-4 rounded-full border-2 bg-white ${
                      entry.to_status === 'approved' ? 'border-success-500' :
                      entry.to_status === 'rejected' ? 'border-danger-500' :
                      'border-warning-500'
                    }`} />
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`font-semibold ${STATUS_COLOR[entry.from_status] ?? 'text-dark-600'}`}>
                          {REQUEST_STATUS_LABEL[entry.from_status as keyof typeof REQUEST_STATUS_LABEL] ?? entry.from_status}
                        </span>
                        <span className="text-dark-400">→</span>
                        <span className={`font-semibold ${STATUS_COLOR[entry.to_status] ?? 'text-dark-600'}`}>
                          {REQUEST_STATUS_LABEL[entry.to_status as keyof typeof REQUEST_STATUS_LABEL] ?? entry.to_status}
                        </span>
                      </div>
                      {entry.reason && (
                        <p className="text-xs text-dark-500 mt-0.5">{entry.reason}</p>
                      )}
                      <p className="text-xs text-dark-400 mt-0.5">
                        {new Date(entry.created_at).toLocaleString('ko-KR', {
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setHistoryModal({ open: false, requestId: '', entries: [] })}
              className="w-full mt-4 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

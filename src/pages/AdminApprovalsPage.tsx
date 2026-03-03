import { useState, useEffect } from 'react'
import { CheckSquare, X, Clock, History } from 'lucide-react'
import { ApprovalCard } from '../components/admin/ApprovalCard'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { OvertimeRequest, LeaveRequest, ApprovalHistory } from '../types'
import { REQUEST_STATUS_LABEL } from '../types'


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

export function AdminApprovalsPage() {
  const { employee } = useAuth()
  const isAdminRole = employee?.role === 'admin'

  const [tab, setTab] = useState<'overtime' | 'leave'>('overtime')
  const [overtimes, setOvertimes] = useState<(OvertimeRequest & { weeklyHours: number })[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [rejectModal, setRejectModal] = useState<RejectModalState>({ open: false, id: '', reason: '' })
  const [timeEditModal, setTimeEditModal] = useState<TimeEditModalState>({ open: false, id: '', start: '', end: '' })
  const [revokeModal, setRevokeModal] = useState<RevokeModalState>({ open: false, id: '', reason: '' })
  const [historyModal, setHistoryModal] = useState<HistoryModalState>({ open: false, requestId: '', entries: [] })

  useEffect(() => {
    fetchOvertimes()
    fetchLeaves()
  }, [])

  async function fetchOvertimes() {
    const { data, error } = await supabase
      .from('overtime_requests')
      .select('*, employee:employees!overtime_requests_employee_id_fkey(id, name, department)')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setOvertimes(data.map((r) => ({ ...r, weeklyHours: 0 })) as (OvertimeRequest & { weeklyHours: number })[])
    }
  }

  async function fetchLeaves() {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*, employee:employees!leave_requests_employee_id_fkey(id, name, department)')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setLeaves(data as LeaveRequest[])
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

  async function handleApprove(id: string) {
    const table = tab === 'overtime' ? 'overtime_requests' : 'leave_requests'
    const { error } = await supabase
      .from(table)
      .update({ status: 'approved', approved_by: employee?.id, approved_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      console.error('[Approve] error:', error)
      return
    }

    await recordHistory(id, tab, 'pending', 'approved', null)

    if (tab === 'overtime') {
      setOvertimes((prev) => prev.map((r) => r.id === id ? { ...r, status: 'approved' } : r))
    } else {
      setLeaves((prev) => prev.map((r) => r.id === id ? { ...r, status: 'approved' } : r))
    }
    setCheckedIds((prev) => { const s = new Set(prev); s.delete(id); return s })
  }

  function openReject(id: string) {
    setRejectModal({ open: true, id, reason: '' })
  }

  async function confirmReject() {
    const { id, reason } = rejectModal
    const table = tab === 'overtime' ? 'overtime_requests' : 'leave_requests'
    const { error } = await supabase
      .from(table)
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', id)

    if (error) {
      console.error('[Reject] error:', error)
      return
    }

    await recordHistory(id, tab, 'pending', 'rejected', reason)

    if (tab === 'overtime') {
      setOvertimes((prev) => prev.map((r) => r.id === id ? { ...r, status: 'rejected', rejection_reason: reason } : r))
    } else {
      setLeaves((prev) => prev.map((r) => r.id === id ? { ...r, status: 'rejected', rejection_reason: reason } : r))
    }
    setCheckedIds((prev) => { const s = new Set(prev); s.delete(id); return s })
    setRejectModal({ open: false, id: '', reason: '' })
  }

  function handleCheck(id: string, checked: boolean) {
    setCheckedIds((prev) => {
      const s = new Set(prev)
      if (checked) s.add(id); else s.delete(id)
      return s
    })
  }

  async function handleBulkApprove() {
    const ids = Array.from(checkedIds)
    const table = tab === 'overtime' ? 'overtime_requests' : 'leave_requests'

    for (const id of ids) {
      await supabase
        .from(table)
        .update({ status: 'approved', approved_by: employee?.id, approved_at: new Date().toISOString() })
        .eq('id', id)
      await recordHistory(id, tab, 'pending', 'approved', null)
    }

    if (tab === 'overtime') {
      setOvertimes((prev) => prev.map((r) => checkedIds.has(r.id) ? { ...r, status: 'approved' } : r))
    } else {
      setLeaves((prev) => prev.map((r) => checkedIds.has(r.id) ? { ...r, status: 'approved' } : r))
    }
    setCheckedIds(new Set())
  }

  function openTimeEdit(id: string) {
    const req = overtimes.find((r) => r.id === id)
    if (!req) return
    setTimeEditModal({ open: true, id, start: req.planned_start, end: req.planned_end })
  }

  async function confirmTimeEdit() {
    const { id, start, end } = timeEditModal
    const { error } = await supabase
      .from('overtime_requests')
      .update({ planned_start: start, planned_end: end, status: 'approved', approved_by: employee?.id, approved_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      console.error('[TimeEdit] error:', error)
      return
    }

    await recordHistory(id, 'overtime', 'pending', 'approved', `시간 수정: ${start} ~ ${end}`)

    setOvertimes((prev) =>
      prev.map((r) => r.id === id ? { ...r, planned_start: start, planned_end: end, status: 'approved' } : r),
    )
    setTimeEditModal({ open: false, id: '', start: '', end: '' })
  }

  // 승인 취소 (번복)
  function openRevokeModal(id: string) {
    setRevokeModal({ open: true, id, reason: '' })
  }

  async function confirmRevoke() {
    const { id, reason } = revokeModal
    if (!reason.trim()) return

    const table = tab === 'overtime' ? 'overtime_requests' : 'leave_requests'
    const { error } = await supabase
      .from(table)
      .update({
        status: 'pending',
        approved_by: null,
        approved_at: null,
      })
      .eq('id', id)

    if (error) {
      console.error('[Revoke] error:', error)
      return
    }

    await recordHistory(id, tab, 'approved', 'pending', reason)

    if (tab === 'overtime') {
      setOvertimes((prev) => prev.map((r) =>
        r.id === id ? { ...r, status: 'pending', approved_by: null, approved_at: null } : r,
      ))
    } else {
      setLeaves((prev) => prev.map((r) =>
        r.id === id ? { ...r, status: 'pending', approved_by: null, approved_at: null } : r,
      ))
    }
    setRevokeModal({ open: false, id: '', reason: '' })
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

  const pendingOvertimes = overtimes.filter((r) => r.status === 'pending')
  const pendingLeaves = leaves.filter((r) => r.status === 'pending')

  const STATUS_COLOR: Record<string, string> = {
    pending: 'text-warning-600',
    approved: 'text-success-600',
    rejected: 'text-danger-600',
    cancelled: 'text-gray-500',
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">승인 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">야근·휴가 신청을 검토하고 처리하세요</p>
      </div>

      {/* 탭 */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => { setTab('overtime'); setCheckedIds(new Set()) }}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'overtime' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          야근 승인
          {pendingOvertimes.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs bg-warning-500 text-white rounded-full">
              {pendingOvertimes.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setTab('leave'); setCheckedIds(new Set()) }}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'leave' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          휴가 승인
          {pendingLeaves.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs bg-primary-600 text-white rounded-full">
              {pendingLeaves.length}
            </span>
          )}
        </button>
      </div>

      {/* 일괄 승인 바 (대표만) */}
      {isAdminRole && checkedIds.size > 0 && (
        <div className="flex items-center justify-between bg-primary-50 border border-primary-200 rounded-xl px-4 py-2.5">
          <span className="text-sm text-primary-700 font-medium">{checkedIds.size}건 선택됨</span>
          <button
            onClick={handleBulkApprove}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-primary-600 px-3 py-1.5 rounded-lg hover:bg-primary-700 transition-colors"
          >
            <CheckSquare className="w-4 h-4" />
            일괄 승인
          </button>
        </div>
      )}

      {/* 목록 */}
      <div className="space-y-3">
        {tab === 'overtime' && (
          <>
            {overtimes.map((req) => (
              <ApprovalCard
                key={req.id}
                request={req}
                type="overtime"
                canApprove={isAdminRole}
                onApprove={handleApprove}
                onReject={openReject}
                onEditTime={isAdminRole ? openTimeEdit : undefined}
                onRevokeApproval={isAdminRole ? openRevokeModal : undefined}
                onViewHistory={openHistoryModal}
                checked={checkedIds.has(req.id)}
                onCheck={req.status === 'pending' && isAdminRole ? handleCheck : undefined}
                weeklyHours={req.weeklyHours}
              />
            ))}
            {overtimes.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-10">대기 중인 야근 제출이 없습니다</p>
            )}
          </>
        )}
        {tab === 'leave' && (
          <>
            {leaves.map((req) => (
              <ApprovalCard
                key={req.id}
                request={req}
                type="leave"
                canApprove={isAdminRole}
                onApprove={handleApprove}
                onReject={openReject}
                onRevokeApproval={isAdminRole ? openRevokeModal : undefined}
                onViewHistory={openHistoryModal}
                checked={checkedIds.has(req.id)}
                onCheck={req.status === 'pending' && isAdminRole ? handleCheck : undefined}
              />
            ))}
            {leaves.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-10">대기 중인 휴가 신청이 없습니다</p>
            )}
          </>
        )}
      </div>

      {/* 반려 사유 모달 */}
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
              placeholder="반려 사유를 입력하세요 (신청자에게 전달됩니다)"
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
              <h3 className="text-base font-bold text-gray-900">승인 취소</h3>
              <button onClick={() => setRevokeModal({ open: false, id: '', reason: '' })}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              승인을 취소하면 해당 건이 <span className="font-semibold text-warning-600">대기 상태</span>로 되돌아갑니다.
            </p>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={3}
              placeholder="승인 취소 사유를 입력하세요 (필수)"
              value={revokeModal.reason}
              onChange={(e) => setRevokeModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRevokeModal({ open: false, id: '', reason: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
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
          <div className="absolute inset-0 bg-black/40" onClick={() => setTimeEditModal({ open: false, id: '', start: '', end: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">인정 시간 수정 후 승인</h3>
              <button onClick={() => setTimeEditModal({ open: false, id: '', start: '', end: '' })}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">제출된 시간을 검토하고 인정 시간을 수정한 뒤 승인합니다.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Clock className="w-3.5 h-3.5 inline mr-1" />시작 시간
                </label>
                <input
                  type="time"
                  value={timeEditModal.start}
                  onChange={(e) => setTimeEditModal((p) => ({ ...p, start: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Clock className="w-3.5 h-3.5 inline mr-1" />종료 시간
                </label>
                <input
                  type="time"
                  value={timeEditModal.end}
                  onChange={(e) => setTimeEditModal((p) => ({ ...p, end: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setTimeEditModal({ open: false, id: '', start: '', end: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={confirmTimeEdit}
                disabled={!timeEditModal.start || !timeEditModal.end}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-success-500 rounded-xl hover:bg-success-600 disabled:opacity-40 transition-colors"
              >
                수정 후 승인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이력 조회 모달 */}
      {historyModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryModal({ open: false, requestId: '', entries: [] })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <History className="w-4 h-4" />
                승인 이력
              </h3>
              <button onClick={() => setHistoryModal({ open: false, requestId: '', entries: [] })}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {historyModal.entries.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">이력이 없습니다</p>
            ) : (
              <div className="space-y-3">
                {historyModal.entries.map((entry, i) => (
                  <div key={entry.id} className="relative pl-6">
                    {/* 타임라인 라인 */}
                    {i < historyModal.entries.length - 1 && (
                      <div className="absolute left-[7px] top-5 bottom-0 w-px bg-gray-200" />
                    )}
                    {/* 타임라인 도트 */}
                    <div className={`absolute left-0 top-1 w-4 h-4 rounded-full border-2 bg-white ${
                      entry.to_status === 'approved' ? 'border-success-500' :
                      entry.to_status === 'rejected' ? 'border-danger-500' :
                      'border-warning-500'
                    }`} />
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`font-semibold ${STATUS_COLOR[entry.from_status] ?? 'text-gray-600'}`}>
                          {REQUEST_STATUS_LABEL[entry.from_status as keyof typeof REQUEST_STATUS_LABEL] ?? entry.from_status}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className={`font-semibold ${STATUS_COLOR[entry.to_status] ?? 'text-gray-600'}`}>
                          {REQUEST_STATUS_LABEL[entry.to_status as keyof typeof REQUEST_STATUS_LABEL] ?? entry.to_status}
                        </span>
                      </div>
                      {entry.reason && (
                        <p className="text-xs text-gray-500 mt-0.5">{entry.reason}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">
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
              className="w-full mt-4 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

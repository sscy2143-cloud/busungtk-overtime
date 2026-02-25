import { useState } from 'react'
import { CheckSquare, X } from 'lucide-react'
import { ApprovalCard } from '../components/admin/ApprovalCard'
import type { OvertimeRequest, LeaveRequest } from '../types'

const DEMO_OVERTIME: (OvertimeRequest & { weeklyHours: number })[] = [
  {
    id: 'ot-1',
    employee_id: 'emp-1',
    employee: { id: 'emp-1', name: '김철수', department: '냉동설비팀', role: 'employee', email: 'kim@bstk.kr', employee_type: 'field', hourly_wage: 15000, manager_id: null, is_active: true, created_at: '' },
    type: 'extended',
    date: '2026-02-24',
    planned_start: '18:00',
    planned_end: '21:00',
    reason: '냉동기 긴급 점검 및 부품 교체 작업',
    status: 'pending',
    is_retroactive: false,
    group_id: 'grp-1',
    created_by: 'emp-1',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: '2026-02-24T17:50:00',
    weeklyHours: 53.5,
  },
  {
    id: 'ot-2',
    employee_id: 'emp-2',
    employee: { id: 'emp-2', name: '이영희', department: '냉동설비팀', role: 'employee', email: 'lee@bstk.kr', employee_type: 'field', hourly_wage: 14000, manager_id: null, is_active: true, created_at: '' },
    type: 'holiday',
    date: '2026-02-22',
    planned_start: '09:00',
    planned_end: '18:00',
    reason: '현장 설치 작업 (토요일 고객 요청)',
    status: 'pending',
    is_retroactive: false,
    group_id: 'grp-1',
    created_by: 'emp-2',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: '2026-02-21T16:00:00',
    weeklyHours: 49.0,
  },
  {
    id: 'ot-3',
    employee_id: 'emp-3',
    employee: { id: 'emp-3', name: '박민준', department: '시스템팀', role: 'employee', email: 'park@bstk.kr', employee_type: 'office', hourly_wage: 13000, manager_id: null, is_active: true, created_at: '' },
    type: 'night',
    date: '2026-02-25',
    planned_start: '22:00',
    planned_end: '02:00',
    reason: '서버 마이그레이션 작업',
    status: 'pending',
    is_retroactive: true,
    group_id: null,
    created_by: 'emp-3',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: '2026-02-25T09:00:00',
    weeklyHours: 44.5,
  },
  {
    id: 'ot-4',
    employee_id: 'emp-4',
    employee: { id: 'emp-4', name: '최수진', department: '시스템팀', role: 'employee', email: 'choi@bstk.kr', employee_type: 'office', hourly_wage: 13000, manager_id: null, is_active: true, created_at: '' },
    type: 'extended',
    date: '2026-02-25',
    planned_start: '19:00',
    planned_end: '21:30',
    reason: '월말 정산 업무',
    status: 'pending',
    is_retroactive: false,
    group_id: null,
    created_by: 'emp-4',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: '2026-02-25T10:00:00',
    weeklyHours: 38.0,
  },
]

const DEMO_LEAVE: LeaveRequest[] = [
  {
    id: 'lv-1',
    employee_id: 'emp-3',
    employee: { id: 'emp-3', name: '박민준', department: '시스템팀', role: 'employee', email: 'park@bstk.kr', employee_type: 'office', hourly_wage: 13000, manager_id: null, is_active: true, created_at: '' },
    type: 'annual',
    start_date: '2026-03-03',
    end_date: '2026-03-04',
    days: 2,
    reason: '개인 사유',
    status: 'pending',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: '2026-02-25T08:00:00',
  },
  {
    id: 'lv-2',
    employee_id: 'emp-5',
    employee: { id: 'emp-5', name: '정다은', department: '영업팀', role: 'employee', email: 'jeong@bstk.kr', employee_type: 'office', hourly_wage: 12000, manager_id: null, is_active: true, created_at: '' },
    type: 'half_am',
    start_date: '2026-02-26',
    end_date: '2026-02-26',
    days: 0.5,
    reason: '병원 진료',
    status: 'pending',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: '2026-02-25T11:00:00',
  },
]

interface RejectModalState {
  open: boolean
  id: string
  reason: string
}

export function AdminApprovalsPage() {
  const [tab, setTab] = useState<'overtime' | 'leave'>('overtime')
  const [overtimes, setOvertimes] = useState(DEMO_OVERTIME)
  const [leaves, setLeaves] = useState(DEMO_LEAVE)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [rejectModal, setRejectModal] = useState<RejectModalState>({ open: false, id: '', reason: '' })

  function handleApprove(id: string) {
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

  function confirmReject() {
    const { id } = rejectModal
    if (tab === 'overtime') {
      setOvertimes((prev) => prev.map((r) => r.id === id ? { ...r, status: 'rejected', rejection_reason: rejectModal.reason } : r))
    } else {
      setLeaves((prev) => prev.map((r) => r.id === id ? { ...r, status: 'rejected', rejection_reason: rejectModal.reason } : r))
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

  function handleBulkApprove() {
    if (tab === 'overtime') {
      setOvertimes((prev) => prev.map((r) => checkedIds.has(r.id) ? { ...r, status: 'approved' } : r))
    } else {
      setLeaves((prev) => prev.map((r) => checkedIds.has(r.id) ? { ...r, status: 'approved' } : r))
    }
    setCheckedIds(new Set())
  }

  const pendingOvertimes = overtimes.filter((r) => r.status === 'pending')
  const pendingLeaves = leaves.filter((r) => r.status === 'pending')

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

      {/* 일괄 승인 바 */}
      {checkedIds.size > 0 && (
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
                onApprove={handleApprove}
                onReject={openReject}
                checked={checkedIds.has(req.id)}
                onCheck={req.status === 'pending' ? handleCheck : undefined}
                weeklyHours={req.weeklyHours}
              />
            ))}
            {overtimes.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-10">대기 중인 야근 신청이 없습니다</p>
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
                onApprove={handleApprove}
                onReject={openReject}
                checked={checkedIds.has(req.id)}
                onCheck={req.status === 'pending' ? handleCheck : undefined}
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
    </div>
  )
}

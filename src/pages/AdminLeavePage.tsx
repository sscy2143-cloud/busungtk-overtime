import { useState } from 'react'
import { X, Plus, Minus } from 'lucide-react'
import { StatusBadge } from '../components/common/StatusBadge'
import type { LeaveRequest } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'

interface EmployeeBalance {
  id: string
  name: string
  department: string
  total_days: number
  used_days: number
  remaining_days: number
}

const DEMO_BALANCES: EmployeeBalance[] = [
  { id: 'emp-1', name: '김철수', department: '냉동설비팀', total_days: 15, used_days: 5, remaining_days: 10 },
  { id: 'emp-2', name: '이영희', department: '냉동설비팀', total_days: 15, used_days: 3, remaining_days: 12 },
  { id: 'emp-3', name: '박민준', department: '시스템팀', total_days: 12, used_days: 2, remaining_days: 10 },
  { id: 'emp-4', name: '최수진', department: '시스템팀', total_days: 12, used_days: 0, remaining_days: 12 },
  { id: 'emp-5', name: '정다은', department: '영업팀', total_days: 15, used_days: 7, remaining_days: 8 },
]

const DEMO_PENDING: LeaveRequest[] = [
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

interface AdjustModal {
  open: boolean
  employeeId: string
  employeeName: string
  delta: number
  reason: string
}

export function AdminLeavePage() {
  const [tab, setTab] = useState<'approvals' | 'balances'>('approvals')
  const [requests, setRequests] = useState(DEMO_PENDING)
  const [balances, setBalances] = useState(DEMO_BALANCES)
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: string; reason: string }>({ open: false, id: '', reason: '' })
  const [adjustModal, setAdjustModal] = useState<AdjustModal>({ open: false, employeeId: '', employeeName: '', delta: 0, reason: '' })

  function handleApprove(id: string) {
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: 'approved' } : r))
  }

  function openReject(id: string) {
    setRejectModal({ open: true, id, reason: '' })
  }

  function confirmReject() {
    setRequests((prev) => prev.map((r) => r.id === rejectModal.id ? { ...r, status: 'rejected', rejection_reason: rejectModal.reason } : r))
    setRejectModal({ open: false, id: '', reason: '' })
  }

  function openAdjust(emp: EmployeeBalance) {
    setAdjustModal({ open: true, employeeId: emp.id, employeeName: emp.name, delta: 0, reason: '' })
  }

  function confirmAdjust() {
    const { employeeId, delta } = adjustModal
    setBalances((prev) =>
      prev.map((b) =>
        b.id === employeeId
          ? {
              ...b,
              total_days: b.total_days + delta,
              remaining_days: b.remaining_days + delta,
            }
          : b,
      ),
    )
    setAdjustModal({ open: false, employeeId: '', employeeName: '', delta: 0, reason: '' })
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

              {req.status === 'pending' && (
                <div className="flex gap-2 mt-3">
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
                </div>
              )}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">이름</th>
                <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500">총</th>
                <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500">사용</th>
                <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500">잔여</th>
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
                  <td className="px-2 py-3 text-center">
                    <button
                      onClick={() => openAdjust(b)}
                      className="text-xs text-gray-500 border border-gray-200 px-2 py-1 rounded-lg hover:border-primary-400 hover:text-primary-600 transition-colors"
                    >
                      조정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  )
}

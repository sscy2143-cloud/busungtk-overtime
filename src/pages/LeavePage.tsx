import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, CalendarDays, Pencil, X } from 'lucide-react'
import { StatusBadge } from '../components/common/StatusBadge'
import type { LeaveRequest, LeaveType } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'


const LEAVE_TYPE_COLOR: Record<string, string> = {
  annual: 'bg-primary-50 text-primary-700',
  half_am: 'bg-purple-50 text-purple-700',
  half_pm: 'bg-purple-50 text-purple-700',
  special: 'bg-teal-50 text-teal-700',
  sick: 'bg-orange-50 text-orange-700',
}

export function LeavePage() {
  const navigate = useNavigate()
  const { employee } = useAuth()
  const [balance, setBalance] = useState({ total_days: 0, used_days: 0, remaining_days: 0 })
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [editModal, setEditModal] = useState<{
    open: boolean; id: string; type: LeaveType; start_date: string; end_date: string; reason: string
  }>({ open: false, id: '', type: 'annual', start_date: '', end_date: '', reason: '' })
  const [cancelModal, setCancelModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' })

  useEffect(() => {
    if (!employee?.id) return
    fetchBalance()
    fetchRequests()
  }, [employee?.id])

  async function fetchBalance() {
    const currentYear = new Date().getFullYear()
    const { data } = await supabase
      .from('leave_balances')
      .select('total_days, used_days, remaining_days')
      .eq('employee_id', employee!.id)
      .eq('year', currentYear)
      .single()
    if (data) {
      setBalance({ total_days: data.total_days, used_days: data.used_days, remaining_days: data.remaining_days })
    }
  }

  async function fetchRequests() {
    const { data } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employee!.id)
      .order('created_at', { ascending: false })
    if (data) {
      setRequests(data as LeaveRequest[])
    }
  }

  const { total_days, used_days, remaining_days } = balance
  const usedPct = total_days > 0 ? Math.round((used_days / total_days) * 100) : 0

  function openEditModal(req: LeaveRequest) {
    setEditModal({ open: true, id: req.id, type: req.type, start_date: req.start_date, end_date: req.end_date, reason: req.reason })
  }

  async function handleEdit() {
    const { id, type, start_date, end_date, reason } = editModal
    const days = type.startsWith('half')
      ? 0.5
      : Math.max(1, Math.ceil((new Date(end_date).getTime() - new Date(start_date).getTime()) / 86400000) + 1)
    const { error } = await supabase
      .from('leave_requests')
      .update({ type, start_date, end_date, days, reason })
      .eq('id', id)
    if (!error) {
      setRequests((prev) => prev.map((r) => r.id === id ? { ...r, type, start_date, end_date, days, reason } : r))
    }
    setEditModal({ open: false, id: '', type: 'annual', start_date: '', end_date: '', reason: '' })
  }

  async function handleCancel() {
    const { id } = cancelModal
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: 'cancelled' as const })
      .eq('id', id)
    if (!error) {
      setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: 'cancelled' as const } : r))
    }
    setCancelModal({ open: false, id: '' })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">휴가 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">내 휴가 현황과 신청 내역</p>
        </div>
        <button
          onClick={() => navigate('/leave/request')}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 active:bg-primary-800 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          휴가 신청
        </button>
      </div>

      {/* 잔여 휴가 카드 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="w-5 h-5 text-primary-600" />
          <h2 className="text-sm font-semibold text-gray-700">2026년 잔여 연차</h2>
        </div>

        {/* 큰 숫자 표시 */}
        <div className="flex items-end gap-4">
          <div className="text-center">
            <p className="text-5xl font-black text-primary-600">{remaining_days}</p>
            <p className="text-xs text-gray-400 mt-1">남은 일수</p>
          </div>
          <div className="flex-1 space-y-2 pb-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>사용 {used_days}일</span>
              <span>총 {total_days}일</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full transition-all duration-500"
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 text-right">{usedPct}% 사용</p>
          </div>
        </div>

        {/* 상세 수치 */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
          {[
            { label: '총 부여', value: `${total_days}일`, color: 'text-gray-700' },
            { label: '사용', value: `${used_days}일`, color: 'text-warning-600' },
            { label: '잔여', value: `${remaining_days}일`, color: 'text-primary-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 신청 내역 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">신청 내역</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {requests.map((req) => (
            <div key={req.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEAVE_TYPE_COLOR[req.type]}`}>
                    {LEAVE_TYPE_LABEL[req.type]}
                  </span>
                  <span className="text-xs text-gray-400">
                    {req.start_date}
                    {req.start_date !== req.end_date && ` ~ ${req.end_date}`}
                    <span className="ml-1">({req.days}일)</span>
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{req.reason}</p>
              </div>
              {req.status === 'pending' && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEditModal(req)} className="p-1.5 text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setCancelModal({ open: true, id: req.id })} className="p-1.5 text-danger-600 border border-danger-300 rounded-lg hover:bg-danger-50 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <StatusBadge status={req.status} />
            </div>
          ))}
          {requests.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-gray-400">신청 내역이 없습니다</p>
            </div>
          )}
        </div>
      </div>

      {/* 수정 모달 */}
      {editModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">휴가 신청 수정</h3>
              <button onClick={() => setEditModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">유형</label>
                <select
                  value={editModal.type}
                  onChange={(e) => setEditModal((p) => ({ ...p, type: e.target.value as LeaveType }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  {Object.entries(LEAVE_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">시작일</label>
                  <input
                    type="date"
                    value={editModal.start_date}
                    onChange={(e) => setEditModal((p) => ({ ...p, start_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">종료일</label>
                  <input
                    type="date"
                    value={editModal.end_date}
                    onChange={(e) => setEditModal((p) => ({ ...p, end_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">사유</label>
                <textarea
                  value={editModal.reason}
                  onChange={(e) => setEditModal((p) => ({ ...p, reason: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEditModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleEdit}
                disabled={!editModal.start_date || !editModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 취소 확인 모달 */}
      {cancelModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCancelModal({ open: false, id: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">휴가 신청 취소</h3>
              <button onClick={() => setCancelModal({ open: false, id: '' })}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">이 휴가 신청을 취소하시겠습니까? 취소 후에는 되돌릴 수 없습니다.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setCancelModal({ open: false, id: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                돌아가기
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors"
              >
                취소하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

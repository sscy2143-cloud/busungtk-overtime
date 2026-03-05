import { useState, useEffect } from 'react'
import { Receipt, X, Check, XCircle } from 'lucide-react'
import type { Expense, ExpenseCategory } from '../types'
import { EXPENSE_CATEGORY_LABEL } from '../types'
import { StatusBadge } from '../components/common/StatusBadge'
import { supabase } from '../lib/supabase'

const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  meal: 'bg-orange-50 text-orange-700',
  transport: 'bg-blue-50 text-blue-700',
  supplies: 'bg-green-50 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

interface RejectModal {
  open: boolean
  id: string
  reason: string
}

export function AdminExpensePage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [rejectModal, setRejectModal] = useState<RejectModal>({ open: false, id: '', reason: '' })

  useEffect(() => {
    fetchExpenses()
  }, [])

  async function fetchExpenses() {
    const { data, error } = await supabase
      .from('expenses')
      .select('*, employee:employees!expenses_employee_id_fkey(id, name, department)')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setExpenses(data as Expense[])
    }
  }

  async function approveExpense(id: string) {
    const { error } = await supabase
      .from('expenses')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)

    if (!error) {
      setExpenses((prev) => prev.map((e) => e.id === id ? { ...e, status: 'approved' as const, approved_at: new Date().toISOString() } : e))
    }
  }

  function openRejectExpense(id: string) {
    setRejectModal({ open: true, id, reason: '' })
  }

  async function confirmRejectExpense() {
    const { error } = await supabase
      .from('expenses')
      .update({ status: 'rejected', rejection_reason: rejectModal.reason })
      .eq('id', rejectModal.id)

    if (!error) {
      setExpenses((prev) => prev.map((e) =>
        e.id === rejectModal.id
          ? { ...e, status: 'rejected' as const, rejection_reason: rejectModal.reason }
          : e,
      ))
    }
    setRejectModal({ open: false, id: '', reason: '' })
  }

  function formatWon(amount: number): string {
    return new Intl.NumberFormat('ko-KR').format(amount) + '원'
  }

  const pendingExpenses = expenses.filter((e) => e.status === 'pending')
  const approvedExpenses = expenses.filter((e) => e.status === 'approved')
  const totalPending = pendingExpenses.reduce((s, e) => s + e.amount, 0)
  const totalApproved = approvedExpenses.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">경비 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">경비 승인 및 정산을 관리합니다</p>
      </div>

      {/* 경비 요약 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">승인 대기</p>
          <p className="text-xl font-bold text-warning-600">{formatWon(totalPending)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{pendingExpenses.length}건</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">이번 달 승인</p>
          <p className="text-xl font-bold text-success-600">{formatWon(totalApproved)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{approvedExpenses.length}건</p>
        </div>
      </div>

      {/* 경비 목록 */}
      {expenses.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Receipt className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">제출된 경비가 없습니다</p>
          <p className="text-xs text-gray-400">직원들이 경비를 제출하면 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((exp) => (
            <div key={exp.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary-700">
                      {exp.employee?.name?.charAt(0) ?? '?'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{exp.employee?.name ?? '직원'}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLOR[exp.category]}`}>
                        {EXPENSE_CATEGORY_LABEL[exp.category]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(exp.date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                      <span className="mx-1">·</span>
                      {exp.description}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-900">{formatWon(exp.amount)}</p>
                  <StatusBadge status={exp.status} />
                </div>
              </div>

              {exp.status === 'pending' && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => approveExpense(exp.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold bg-success-500 text-white rounded-lg hover:bg-success-600 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    승인
                  </button>
                  <button
                    onClick={() => openRejectExpense(exp.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold bg-white text-danger-600 border border-danger-300 rounded-lg hover:bg-danger-50 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    반려
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 경비 반려 모달 */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRejectModal({ open: false, id: '', reason: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">경비 반려 사유</h3>
              <button onClick={() => setRejectModal({ open: false, id: '', reason: '' })}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={3}
              placeholder="반려 사유를 입력하세요"
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((p) => ({ ...p, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setRejectModal({ open: false, id: '', reason: '' })} className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">취소</button>
              <button onClick={confirmRejectExpense} disabled={!rejectModal.reason.trim()} className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 disabled:opacity-40 transition-colors">반려</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

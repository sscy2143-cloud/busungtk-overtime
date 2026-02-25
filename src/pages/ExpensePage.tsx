import { useState, useEffect } from 'react'
import { Receipt, Plus, ChevronUp } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { StatusBadge } from '../components/common/StatusBadge'
import type { Expense, ExpenseCategory, RequestStatus } from '../types'
import { EXPENSE_CATEGORY_LABEL, REQUEST_STATUS_LABEL } from '../types'

const CATEGORIES: ExpenseCategory[] = ['meal', 'transport', 'supplies', 'other']

const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  meal: 'bg-orange-50 text-orange-700',
  transport: 'bg-blue-50 text-blue-700',
  supplies: 'bg-green-50 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

const FILTER_TABS: Array<{ key: RequestStatus | 'all'; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: REQUEST_STATUS_LABEL.pending },
  { key: 'approved', label: REQUEST_STATUS_LABEL.approved },
  { key: 'rejected', label: REQUEST_STATUS_LABEL.rejected },
]

export function ExpensePage() {
  const { employee } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [filter, setFilter] = useState<RequestStatus | 'all'>('all')
  const [formOpen, setFormOpen] = useState(false)

  // form state
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [category, setCategory] = useState<ExpenseCategory>('meal')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(false)

  useEffect(() => {
    if (!employee?.id) return
    fetchExpenses()
  }, [employee?.id])

  async function fetchExpenses() {
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('employee_id', employee!.id)
      .order('created_at', { ascending: false })
    if (!error && data) {
      setExpenses(data as Expense[])
    }
  }

  const filtered = filter === 'all'
    ? expenses
    : expenses.filter((e) => e.status === filter)

  const totalPending = expenses
    .filter((e) => e.status === 'pending')
    .reduce((sum, e) => sum + e.amount, 0)

  const totalApproved = expenses
    .filter((e) => e.status === 'approved')
    .reduce((sum, e) => sum + e.amount, 0)

  function formatWon(n: number) {
    return new Intl.NumberFormat('ko-KR').format(n) + '원'
  }

  function resetForm() {
    setDate(new Date().toISOString().split('T')[0])
    setCategory('meal')
    setAmount('')
    setDescription('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !description.trim()) return
    setSubmitting(true)

    const { data, error } = await supabase
      .from('expenses')
      .insert({
        employee_id: employee?.id ?? '',
        date,
        category,
        amount: Number(amount),
        description: description.trim(),
      })
      .select()
      .single()

    if (error) {
      console.error('[ExpensePage] insert error:', error)
      setSubmitting(false)
      return
    }

    if (data) {
      setExpenses((prev) => [data as Expense, ...prev])
    }
    resetForm()
    setFormOpen(false)
    setSubmitting(false)
    setToast(true)
    setTimeout(() => setToast(false), 2500)
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">경비 제출</h1>
          <p className="text-sm text-gray-500 mt-0.5">업무 중 사비로 지출한 경비를 제출합니다</p>
        </div>
        <button
          onClick={() => setFormOpen(!formOpen)}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors"
        >
          <Plus size={16} />
          새 제출
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">승인 대기</p>
          <p className="text-lg font-bold text-warning-600">{formatWon(totalPending)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">승인 완료</p>
          <p className="text-lg font-bold text-success-600">{formatWon(totalApproved)}</p>
        </div>
      </div>

      {/* 제출 폼 (토글) */}
      {formOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800">경비 입력</h2>
            <button type="button" onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-600">
              <ChevronUp size={18} />
            </button>
          </div>

          {/* 날짜 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">지출 날짜</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          {/* 카테고리 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">분류</label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                    category === c
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                  }`}
                >
                  {EXPENSE_CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          {/* 금액 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">금액</label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="0"
                step="100"
                required
                className="w-full px-3 py-2.5 pr-8 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 text-right"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">원</span>
            </div>
          </div>

          {/* 내용 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              지출 내용 <span className="text-danger-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="지출 내용을 입력하세요 (예: 현장 점심 식대 4인분)"
              required
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !amount || !description.trim()}
            className="w-full py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? '제출 중...' : '경비 제출'}
          </button>
        </form>
      )}

      {/* 필터 탭 */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`shrink-0 px-4 py-1.5 text-sm font-medium rounded-full border transition-colors ${
              filter === tab.key
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 경비 목록 */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Receipt className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">경비 내역이 없습니다</p>
          <p className="text-xs text-gray-400">업무 중 사비 지출이 있으면 제출해 주세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((exp) => (
            <div key={exp.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLOR[exp.category]}`}>
                      {EXPENSE_CATEGORY_LABEL[exp.category]}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(exp.date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{formatWon(exp.amount)}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{exp.description}</p>
                </div>
                <StatusBadge status={exp.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5 py-3 rounded-full shadow-lg z-50">
          경비가 제출되었습니다
        </div>
      )}
    </div>
  )
}

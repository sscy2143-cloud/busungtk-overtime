import { useState, useEffect } from 'react'
import { Receipt, X, Check, XCircle, Image, Download, Filter } from 'lucide-react'
import type { Expense, ExpenseCategory, PaymentMethod } from '../types'
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL } from '../types'
import { StatusBadge } from '../components/common/StatusBadge'
import { supabase } from '../lib/supabase'

const PAYMENT_METHOD_COLOR: Record<PaymentMethod, string> = {
  card: 'bg-indigo-50 text-indigo-700',
  transfer: 'bg-teal-50 text-teal-700',
  cash: 'bg-amber-50 text-amber-700',
  other: 'bg-gray-100 text-gray-600',
}

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

interface PayModal {
  open: boolean
  id: string
  expense_amount: number
  paid_at: string
  paid_amount: string
  payout_method: 'cash' | 'transfer' | 'other'
  payment_bank: string
  payment_account: string
  payment_note: string
}

export function AdminExpensePage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [rejectModal, setRejectModal] = useState<RejectModal>({ open: false, id: '', reason: '' })
  const [payModal, setPayModal] = useState<PayModal>({ open: false, id: '', expense_amount: 0, paid_at: new Date().toISOString().slice(0, 10), paid_amount: '', payout_method: 'transfer', payment_bank: '', payment_account: '', payment_note: '' })
  const [detailExp, setDetailExp] = useState<Expense | null>(null)
  const [showExportPreview, setShowExportPreview] = useState(false)
  const [filterDateMode, setFilterDateMode] = useState<'all' | 'this_month' | 'last_month' | '3months' | '6months' | 'custom'>('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterPayment, setFilterPayment] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [filterCategory, setFilterCategory] = useState<ExpenseCategory | 'all'>('all')

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

  async function confirmPay() {
    const { id, paid_at, paid_amount, payout_method, payment_bank, payment_account, payment_note } = payModal
    const paidAmt = paid_amount ? Number(paid_amount) : null
    const { error } = await supabase
      .from('expenses')
      .update({ paid_at: new Date(paid_at).toISOString(), paid_amount: paidAmt, payout_method, payment_bank, payment_account, payment_note })
      .eq('id', id)
    if (!error) {
      setExpenses((prev) => prev.map((e) =>
        e.id === id ? { ...e, paid_at: new Date(paid_at).toISOString(), paid_amount: paidAmt, payout_method, payment_bank, payment_account, payment_note } : e
      ))
      if (detailExp?.id === id) {
        setDetailExp((prev) => prev ? { ...prev, paid_at: new Date(paid_at).toISOString(), paid_amount: paidAmt, payout_method, payment_bank, payment_account, payment_note } : null)
      }
    }
    setPayModal({ open: false, id: '', expense_amount: 0, paid_at: new Date().toISOString().slice(0, 10), paid_amount: '', payout_method: 'transfer', payment_bank: '', payment_account: '', payment_note: '' })
  }

  function formatWon(amount: number): string {
    return new Intl.NumberFormat('ko-KR').format(amount) + '원'
  }

  const pendingExpenses = expenses.filter((e) => e.status === 'pending')
  const approvedExpenses = expenses.filter((e) => e.status === 'approved')
  const totalPending = pendingExpenses.reduce((s, e) => s + e.amount, 0)
  const totalApproved = approvedExpenses.reduce((s, e) => s + e.amount, 0)

  const getDateRange = (): { from: string; to: string } | null => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    if (filterDateMode === 'this_month') {
      return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
    }
    if (filterDateMode === 'last_month') {
      return { from: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) }
    }
    if (filterDateMode === '3months') {
      const from = new Date(now); from.setMonth(from.getMonth() - 3)
      return { from: fmt(from), to: fmt(now) }
    }
    if (filterDateMode === '6months') {
      const from = new Date(now); from.setMonth(from.getMonth() - 6)
      return { from: fmt(from), to: fmt(now) }
    }
    if (filterDateMode === 'custom' && filterDateFrom) {
      return { from: filterDateFrom, to: filterDateTo || fmt(now) }
    }
    return null
  }

  const filteredExpenses = expenses.filter((e) => {
    const range = getDateRange()
    if (range && (e.date < range.from || e.date > range.to)) return false
    if (filterPayment !== 'all' && e.status !== filterPayment) return false
    if (filterCategory !== 'all' && e.category !== filterCategory) return false
    return true
  })

  function downloadCSV() {
    const BOM = '\uFEFF'
    const headers = ['이름', '부서', '날짜', '분류', '결제방법', '금액', '지출내용', '상태', '반려사유', '지급일', '은행', '계좌번호', '지급메모', '제출일']
    const rows = filteredExpenses.map((e) => [
      e.employee?.name ?? '',
      e.employee?.department ?? '',
      e.date,
      EXPENSE_CATEGORY_LABEL[e.category],
      e.payment_method ? PAYMENT_METHOD_LABEL[e.payment_method] : '',
      e.amount,
      `"${(e.description ?? '').replace(/"/g, '""')}"`,
      e.status === 'pending' ? '미지급' : e.status === 'approved' ? '지급완료' : '반려',
      `"${(e.rejection_reason ?? '').replace(/"/g, '""')}"`,
      e.paid_at ? new Date(e.paid_at).toLocaleDateString('ko-KR') : '',
      e.payment_bank ?? '',
      e.payment_account ?? '',
      `"${(e.payment_note ?? '').replace(/"/g, '""')}"`,
      new Date(e.created_at).toLocaleDateString('ko-KR'),
    ])
    const range = getDateRange()
    const label = range ? `${range.from}~${range.to}` : '전체'
    const csv = BOM + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `경비내역_${label}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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

      {/* 필터 + 엑셀 내보내기 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Filter className="w-4 h-4 text-gray-400" />
            필터
          </div>
          <button
            onClick={() => setShowExportPreview(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            엑셀 내보내기
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {/* 날짜 */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">날짜</label>
            <select
              value={filterDateMode}
              onChange={(e) => setFilterDateMode(e.target.value as typeof filterDateMode)}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            >
              <option value="all">전체</option>
              <option value="this_month">이번달</option>
              <option value="last_month">지난달</option>
              <option value="3months">3개월</option>
              <option value="6months">6개월</option>
              <option value="custom">날짜선택</option>
            </select>
          </div>
          {/* 지급여부 */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">지급여부</label>
            <select
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value as typeof filterPayment)}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            >
              <option value="all">전체</option>
              <option value="pending">미지급</option>
              <option value="approved">지급완료</option>
              <option value="rejected">반려</option>
            </select>
          </div>
          {/* 분류 */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">분류</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as typeof filterCategory)}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            >
              <option value="all">전체</option>
              {(['meal', 'transport', 'supplies', 'other'] as ExpenseCategory[]).map((c) => (
                <option key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </div>
        </div>
        {/* 날짜 직접 선택 */}
        {filterDateMode === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">시작일</label>
              <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">종료일</label>
              <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400">
          {filteredExpenses.length}건 · 합계 {formatWon(filteredExpenses.reduce((s, e) => s + e.amount, 0))}
        </p>
      </div>

      {/* 경비 목록 - 표 형식 */}
      <div className="bg-white border border-gray-300 overflow-hidden">
        {/* 표 제목 행 */}
        <div className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-800">경비지출 내역</span>
          <span className="text-xs text-gray-500">총 {filteredExpenses.length}건 · {formatWon(filteredExpenses.reduce((s, e) => s + e.amount, 0))}</span>
        </div>
        {filteredExpenses.length === 0 ? (
          <div className="py-16 text-center">
            <Receipt className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">제출된 경비가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap w-8">번호</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">성명</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">부서</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">지출일</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">분류</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">결제</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">청구금액</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-left">지출내용</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">처리상태</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">지급일</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">지급금액</th>
                  <th className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 text-center whitespace-nowrap">처리</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((exp, idx) => (
                  <tr
                    key={exp.id}
                    onClick={() => setDetailExp(exp)}
                    className={`cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                  >
                    <td className="border border-gray-200 px-2 py-2 text-xs text-gray-400 text-center">{idx + 1}</td>
                    <td className="border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-900 text-center whitespace-nowrap">{exp.employee?.name ?? '-'}</td>
                    <td className="border border-gray-200 px-3 py-2 text-xs text-gray-600 text-center whitespace-nowrap">{exp.employee?.department ?? '-'}</td>
                    <td className="border border-gray-200 px-3 py-2 text-xs text-gray-700 text-center whitespace-nowrap">{exp.date}</td>
                    <td className="border border-gray-200 px-2 py-2 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLOR[exp.category]}`}>{EXPENSE_CATEGORY_LABEL[exp.category]}</span>
                    </td>
                    <td className="border border-gray-200 px-2 py-2 text-xs text-gray-500 text-center whitespace-nowrap">
                      {exp.payment_method ? PAYMENT_METHOD_LABEL[exp.payment_method] : '-'}
                    </td>
                    <td className="border border-gray-200 px-3 py-2 text-xs font-bold text-gray-900 text-right whitespace-nowrap">{formatWon(exp.amount)}</td>
                    <td className="border border-gray-200 px-3 py-2 text-xs text-gray-700 max-w-[160px]">
                      <p className="truncate">{exp.description}</p>
                      {exp.status === 'rejected' && exp.rejection_reason && (
                        <p className="text-danger-500 truncate mt-0.5">반려: {exp.rejection_reason}</p>
                      )}
                    </td>
                    <td className="border border-gray-200 px-2 py-2 text-center whitespace-nowrap">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                        exp.status === 'pending' ? 'bg-warning-50 text-warning-700' :
                        exp.status === 'approved' ? 'bg-success-50 text-success-700' :
                        exp.status === 'manager_approved' ? 'bg-blue-50 text-blue-700' :
                        'bg-danger-50 text-danger-700'
                      }`}>
                        {exp.status === 'pending' ? '검토중' : exp.status === 'approved' ? '승인' : exp.status === 'manager_approved' ? '1차승인' : '반려'}
                      </span>
                    </td>
                    <td className="border border-gray-200 px-2 py-2 text-xs text-gray-600 text-center whitespace-nowrap">
                      {exp.paid_at ? new Date(exp.paid_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '-'}
                    </td>
                    <td className="border border-gray-200 px-2 py-2 text-xs font-medium text-right whitespace-nowrap">
                      {exp.paid_amount != null ? (
                        <span className={exp.paid_amount === exp.amount ? 'text-success-700' : 'text-warning-600'}>
                          {formatWon(exp.paid_amount)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="border border-gray-200 px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      {exp.status === 'pending' && (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => approveExpense(exp.id)} className="px-2 py-1 text-xs bg-success-500 text-white rounded hover:bg-success-600 whitespace-nowrap">승인</button>
                          <button onClick={() => openRejectExpense(exp.id)} className="px-2 py-1 text-xs border border-danger-400 text-danger-600 rounded hover:bg-danger-50 whitespace-nowrap">반려</button>
                        </div>
                      )}
                      {exp.status === 'approved' && !exp.paid_at && (
                        <button
                          onClick={() => setPayModal({ open: true, id: exp.id, expense_amount: exp.amount, paid_at: new Date().toISOString().slice(0, 10), paid_amount: String(exp.amount), payout_method: 'transfer', payment_bank: '', payment_account: '', payment_note: '' })}
                          className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 whitespace-nowrap"
                        >
                          지급처리
                        </button>
                      )}
                      {exp.status === 'approved' && exp.paid_at && (
                        <span className="text-xs text-success-600 font-semibold">완료</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-bold">
                  <td colSpan={6} className="border border-gray-300 px-3 py-2 text-xs text-gray-600 text-right">합 계</td>
                  <td className="border border-gray-300 px-3 py-2 text-xs text-gray-900 text-right whitespace-nowrap">{formatWon(filteredExpenses.reduce((s, e) => s + e.amount, 0))}</td>
                  <td colSpan={3} className="border border-gray-300" />
                  <td className="border border-gray-300 px-3 py-2 text-xs text-success-700 text-right whitespace-nowrap">
                    {formatWon(filteredExpenses.filter(e => e.paid_amount != null).reduce((s, e) => s + (e.paid_amount ?? 0), 0))}
                  </td>
                  <td className="border border-gray-300" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* 경비 상세 팝업 */}
      {detailExp && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailExp(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-gray-900">경비 상세</h3>
                <p className="text-xs text-gray-400 mt-0.5">{detailExp.employee?.name ?? '직원'}</p>
              </div>
              <button onClick={() => setDetailExp(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">상태</span>
                <StatusBadge status={detailExp.status} />
              </div>
              {detailExp.status === 'rejected' && detailExp.rejection_reason && (
                <div className="bg-danger-50 border border-danger-200 rounded-xl px-3 py-2.5">
                  <p className="text-xs font-semibold text-danger-500 mb-1">반려 사유</p>
                  <p className="text-sm text-danger-700">{detailExp.rejection_reason}</p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">지출 날짜</span>
                <span className="text-sm text-gray-800">
                  {new Date(detailExp.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">분류</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLOR[detailExp.category]}`}>
                  {EXPENSE_CATEGORY_LABEL[detailExp.category]}
                </span>
              </div>
              {detailExp.payment_method && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">결제방법</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PAYMENT_METHOD_COLOR[detailExp.payment_method]}`}>
                    {PAYMENT_METHOD_LABEL[detailExp.payment_method]}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">금액</span>
                <span className="text-base font-bold text-gray-900">{formatWon(detailExp.amount)}</span>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">지출 내용</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2">{detailExp.description}</p>
              </div>
              {detailExp.receipt_url && (
                <a
                  href={detailExp.receipt_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2.5 bg-primary-50 border border-primary-100 rounded-xl text-sm text-primary-600 font-medium hover:bg-primary-100 transition-colors"
                >
                  <Image size={16} />
                  증빙자료 보기
                </a>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                <span className="text-xs text-gray-400">제출일</span>
                <span className="text-xs text-gray-500">
                  {new Date(detailExp.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
            </div>
            {/* 지급 정보 */}
            {detailExp.status === 'approved' && (
              <div className="px-5 pb-4">
                {detailExp.paid_at ? (
                  <div className="bg-success-50 border border-success-200 rounded-xl px-4 py-3 space-y-1.5">
                    <p className="text-xs font-semibold text-success-700 mb-2">지급 완료</p>
                    {detailExp.payout_method && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">지급방식</span>
                        <span className="font-medium text-gray-800">
                          {detailExp.payout_method === 'cash' ? '현금' : detailExp.payout_method === 'transfer' ? '계좌이체' : '기타'}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">지급일</span>
                      <span className="text-gray-800 font-medium">{new Date(detailExp.paid_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">청구 금액</span>
                      <span className="text-gray-800">{formatWon(detailExp.amount)}</span>
                    </div>
                    {detailExp.paid_amount != null && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">지급 금액</span>
                        <span className={`font-semibold ${detailExp.paid_amount === detailExp.amount ? 'text-success-700' : 'text-warning-600'}`}>
                          {formatWon(detailExp.paid_amount)}
                          {detailExp.paid_amount !== detailExp.amount && (
                            <span className="ml-1 font-normal text-gray-400">
                              (차액 {formatWon(Math.abs(detailExp.paid_amount - detailExp.amount))})
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    {detailExp.payment_bank && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">은행</span>
                        <span className="text-gray-800">{detailExp.payment_bank}</span>
                      </div>
                    )}
                    {detailExp.payment_account && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">계좌번호</span>
                        <span className="text-gray-800">{detailExp.payment_account}</span>
                      </div>
                    )}
                    {detailExp.payment_note && (
                      <div className="pt-1 border-t border-success-200">
                        <p className="text-xs text-gray-400 mb-0.5">메모</p>
                        <p className="text-xs text-gray-700">{detailExp.payment_note}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => { setDetailExp(null); setPayModal({ open: true, id: detailExp.id, expense_amount: detailExp.amount, paid_at: new Date().toISOString().slice(0, 10), paid_amount: String(detailExp.amount), payment_bank: '', payment_account: '', payment_note: '', payout_method: 'transfer' }) }}
                    className="w-full py-2.5 text-sm font-semibold text-primary-600 border border-primary-300 rounded-xl hover:bg-primary-50 transition-colors"
                  >
                    지급 처리 등록
                  </button>
                )}
              </div>
            )}
            {detailExp.status === 'pending' && (
              <div className="flex gap-2 px-5 pb-5" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => { approveExpense(detailExp.id); setDetailExp(null) }}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 text-sm font-semibold bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors"
                >
                  <Check className="w-4 h-4" /> 승인
                </button>
                <button
                  onClick={() => { setDetailExp(null); openRejectExpense(detailExp.id) }}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 text-sm font-semibold text-danger-600 border border-danger-300 rounded-xl hover:bg-danger-50 transition-colors"
                >
                  <XCircle className="w-4 h-4" /> 반려
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 엑셀 미리보기 모달 */}
      {showExportPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-2">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowExportPreview(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-4xl shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-base font-bold text-gray-900">엑셀 내보내기 미리보기</h3>
                <p className="text-xs text-gray-400 mt-0.5">{filteredExpenses.length}건 · 합계 {formatWon(filteredExpenses.reduce((s, e) => s + e.amount, 0))}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { downloadCSV(); setShowExportPreview(false) }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  다운로드
                </button>
                <button onClick={() => setShowExportPreview(false)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
            </div>
            <div className="overflow-auto flex-1">
              {filteredExpenses.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400">해당 조건의 내역이 없습니다</div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['#', '이름', '부서', '날짜', '분류', '결제방법', '금액', '상태', '지출내용', '반려사유', '지급일', '은행', '계좌번호', '메모'].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredExpenses.map((e, i) => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{e.employee?.name ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{e.employee?.department ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{e.date}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded-full ${CATEGORY_COLOR[e.category]}`}>{EXPENSE_CATEGORY_LABEL[e.category]}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{e.payment_method ? PAYMENT_METHOD_LABEL[e.payment_method] : '-'}</td>
                        <td className="px-3 py-2 font-semibold text-gray-900 whitespace-nowrap text-right">{formatWon(e.amount)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                            e.status === 'pending' ? 'bg-warning-50 text-warning-600' :
                            e.status === 'approved' ? 'bg-success-50 text-success-600' :
                            'bg-danger-50 text-danger-600'
                          }`}>
                            {e.status === 'pending' ? '미지급' : e.status === 'approved' ? '지급완료' : '반려'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600 max-w-[180px] truncate">{e.description}</td>
                        <td className="px-3 py-2 text-danger-500 max-w-[120px] truncate">{e.rejection_reason ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{e.paid_at ? new Date(e.paid_at).toLocaleDateString('ko-KR') : '-'}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{e.payment_bank ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{e.payment_account ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-500 max-w-[100px] truncate">{e.payment_note ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={6} className="px-3 py-2 text-xs font-semibold text-gray-500">합계</td>
                      <td className="px-3 py-2 text-xs font-bold text-gray-900 text-right whitespace-nowrap">
                        {formatWon(filteredExpenses.reduce((s, e) => s + e.amount, 0))}
                      </td>
                      <td colSpan={7} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 지급 처리 모달 */}
      {payModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPayModal(p => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">지급 처리 등록</h3>
              <button onClick={() => setPayModal(p => ({ ...p, open: false }))}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              {/* 금액 정보 */}
              <div className="bg-gray-50 rounded-xl px-4 py-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400 mb-1">지급해야 할 금액</p>
                  <p className="text-sm font-bold text-gray-800">{formatWon(payModal.expense_amount)}</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">지급하는 금액 <span className="text-danger-500">*</span></label>
                  <div className="relative">
                    <input
                      type="number"
                      value={payModal.paid_amount}
                      onChange={(e) => setPayModal(p => ({ ...p, paid_amount: e.target.value }))}
                      className="w-full px-2 py-1 pr-6 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 text-right"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">원</span>
                  </div>
                  {payModal.paid_amount && Number(payModal.paid_amount) !== payModal.expense_amount && (
                    <p className="text-xs text-warning-600 mt-0.5">
                      차액: {formatWon(Math.abs(Number(payModal.paid_amount) - payModal.expense_amount))}
                      {Number(payModal.paid_amount) < payModal.expense_amount ? ' 부족' : ' 초과'}
                    </p>
                  )}
                </div>
              </div>
              {/* 지급방식 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">지급방식 <span className="text-danger-500">*</span></label>
                <div className="grid grid-cols-3 gap-2">
                  {([['cash', '현금'], ['transfer', '계좌이체'], ['other', '기타']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setPayModal(p => ({ ...p, payout_method: val }))}
                      className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                        payModal.payout_method === val
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">지급일 <span className="text-danger-500">*</span></label>
                <input
                  type="date"
                  value={payModal.paid_at}
                  onChange={(e) => setPayModal(p => ({ ...p, paid_at: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              {payModal.payout_method === 'transfer' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">은행명</label>
                    <input
                      type="text"
                      value={payModal.payment_bank}
                      onChange={(e) => setPayModal(p => ({ ...p, payment_bank: e.target.value }))}
                      placeholder="예: 국민은행, 신한은행"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">계좌번호</label>
                    <input
                      type="text"
                      value={payModal.payment_account}
                      onChange={(e) => setPayModal(p => ({ ...p, payment_account: e.target.value }))}
                      placeholder="예: 123-456-789012"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">메모</label>
                <textarea
                  value={payModal.payment_note}
                  onChange={(e) => setPayModal(p => ({ ...p, payment_note: e.target.value }))}
                  rows={2}
                  placeholder="지급 관련 특이사항"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setPayModal(p => ({ ...p, open: false }))} className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">취소</button>
              <button onClick={confirmPay} disabled={!payModal.paid_at || !payModal.paid_amount} className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors">저장</button>
            </div>
          </div>
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

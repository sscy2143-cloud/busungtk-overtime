import { useState, useEffect, useRef } from 'react'
import { Receipt, Plus, ChevronUp, Upload, X, Image } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { StatusBadge } from '../components/common/StatusBadge'
import type { Expense, ExpenseCategory, PaymentMethod, RequestStatus } from '../types'
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, REQUEST_STATUS_LABEL } from '../types'

const CATEGORIES: ExpenseCategory[] = ['meal', 'transport', 'supplies', 'other']
const PAYMENT_METHODS: PaymentMethod[] = ['card', 'transfer', 'cash', 'other']

const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  meal: 'bg-orange-50 text-orange-700',
  transport: 'bg-blue-50 text-blue-700',
  supplies: 'bg-green-50 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

const PAYMENT_METHOD_COLOR: Record<PaymentMethod, string> = {
  card: 'bg-indigo-50 text-indigo-700',
  transfer: 'bg-teal-50 text-teal-700',
  cash: 'bg-amber-50 text-amber-700',
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [otherCategoryNote, setOtherCategoryNote] = useState('')
  const [otherPaymentNote, setOtherPaymentNote] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(false)
  const [detailExp, setDetailExp] = useState<Expense | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setPaymentMethod('card')
    setAmount('')
    setDescription('')
    setOtherCategoryNote('')
    setOtherPaymentNote('')
    setReceiptFile(null)
    setReceiptPreview(null)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setReceiptFile(file)
    // 이미지 미리보기
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onloadend = () => setReceiptPreview(reader.result as string)
      reader.readAsDataURL(file)
    } else {
      setReceiptPreview(null)
    }
  }

  function removeFile() {
    setReceiptFile(null)
    setReceiptPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function uploadReceipt(file: File): Promise<string | null> {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const fileName = `${employee?.id}/${Date.now()}.${ext}`

    const { error } = await supabase.storage
      .from('receipts')
      .upload(fileName, file, { cacheControl: '3600', upsert: false })

    if (error) {
      console.error('[ExpensePage] upload error:', error)
      return null
    }

    const { data: urlData } = supabase.storage
      .from('receipts')
      .getPublicUrl(fileName)

    return urlData?.publicUrl ?? null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !description.trim()) return
    setSubmitting(true)

    let receiptUrl: string | undefined = undefined

    // 파일 업로드
    if (receiptFile) {
      setUploading(true)
      const url = await uploadReceipt(receiptFile)
      setUploading(false)
      if (url) receiptUrl = url
    }

    const categoryPrefix = category === 'other' && otherCategoryNote.trim() ? `[분류: ${otherCategoryNote.trim()}]` : ''
    const paymentPrefix = paymentMethod === 'other' && otherPaymentNote.trim() ? `[결제: ${otherPaymentNote.trim()}]` : ''
    const prefix = [categoryPrefix, paymentPrefix].filter(Boolean).join(' ')
    const finalDescription = prefix ? `${prefix} ${description.trim()}` : description.trim()

    const { data, error } = await supabase
      .from('expenses')
      .insert({
        employee_id: employee?.id ?? '',
        date,
        category,
        payment_method: paymentMethod,
        amount: Number(amount),
        description: finalDescription,
        ...(receiptUrl ? { receipt_url: receiptUrl } : {}),
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
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">경비 제출</h1>
          <p className="text-sm text-gray-500 mt-0.5">업무 중 사비로 지출한 경비를 제출합니다</p>
        </div>
        <button
          onClick={() => setFormOpen(!formOpen)}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus size={16} />
          경비 신청
        </button>
      </div>

      {/* 요약 */}
      <div className="bg-white rounded-xl border border-gray-200 divide-x divide-gray-100 flex overflow-hidden">
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-gray-400 mb-0.5">승인 대기</p>
          <p className="text-lg font-bold text-warning-600">{formatWon(totalPending)}</p>
        </div>
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-gray-400 mb-0.5">승인 완료</p>
          <p className="text-lg font-bold text-success-600">{formatWon(totalApproved)}</p>
        </div>
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-gray-400 mb-0.5">전체 청구</p>
          <p className="text-lg font-bold text-gray-800">{formatWon(expenses.reduce((s, e) => s + e.amount, 0))}</p>
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
                  onClick={() => { setCategory(c); if (c !== 'other') setOtherCategoryNote('') }}
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

          {/* 기타 분류 상세 */}
          {category === 'other' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                기타 분류 <span className="text-danger-500">*</span>
              </label>
              <input
                type="text"
                value={otherCategoryNote}
                onChange={(e) => setOtherCategoryNote(e.target.value)}
                placeholder="구체적으로 입력하세요 (예: 숙박비, 택시비, 공구 구입)"
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          )}

          {/* 결제방법 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">결제방법</label>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setPaymentMethod(m); if (m !== 'other') setOtherPaymentNote('') }}
                  className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                    paymentMethod === m
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                  }`}
                >
                  {PAYMENT_METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {/* 기타 결제방법 상세 */}
          {paymentMethod === 'other' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                기타 결제방법 <span className="text-danger-500">*</span>
              </label>
              <input
                type="text"
                value={otherPaymentNote}
                onChange={(e) => setOtherPaymentNote(e.target.value)}
                placeholder="구체적으로 입력하세요 (예: 개인카드, 상품권)"
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          )}

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

          {/* 증빙자료 업로드 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">증빙자료</label>
            {receiptFile ? (
              <div className="border border-gray-200 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Image size={16} className="text-gray-400 shrink-0" />
                    <span className="text-xs text-gray-700 truncate">{receiptFile.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">
                      ({(receiptFile.size / 1024).toFixed(0)}KB)
                    </span>
                  </div>
                  <button type="button" onClick={removeFile} className="text-gray-400 hover:text-danger-500 shrink-0 ml-2">
                    <X size={16} />
                  </button>
                </div>
                {receiptPreview && (
                  <img
                    src={receiptPreview}
                    alt="증빙 미리보기"
                    className="mt-2 rounded-lg max-h-40 object-contain w-full bg-gray-50"
                  />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-500 hover:border-primary-300 hover:text-primary-600 transition-colors"
              >
                <Upload size={16} />
                영수증/증빙 사진 첨부
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || uploading || !amount || !description.trim() || (category === 'other' && !otherCategoryNote.trim()) || (paymentMethod === 'other' && !otherPaymentNote.trim())}
            className="w-full py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {uploading ? '업로드 중...' : submitting ? '제출 중...' : '경비 제출'}
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
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Receipt className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">경비 내역이 없습니다</p>
          <p className="text-xs text-gray-400">업무 중 사비 지출이 있으면 제출해 주세요</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-400 w-10">번호</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">지출일</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">분류</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">결제방법</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">내용</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">금액</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((exp, idx) => (
                <tr
                  key={exp.id}
                  onClick={() => setDetailExp(exp)}
                  className={`border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${idx % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'} hover:bg-primary-50/40`}
                >
                  <td className="px-3 py-2.5 text-center text-xs font-bold text-gray-300">{idx + 1}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                    {new Date(exp.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${CATEGORY_COLOR[exp.category]}`}>
                      {EXPENSE_CATEGORY_LABEL[exp.category]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 hidden sm:table-cell">
                    {exp.payment_method && (
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${PAYMENT_METHOD_COLOR[exp.payment_method]}`}>
                        {PAYMENT_METHOD_LABEL[exp.payment_method]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 max-w-[140px]">
                    <p className="text-xs text-gray-700 truncate">{exp.description}</p>
                    {exp.status === 'rejected' && exp.rejection_reason && (
                      <p className="text-xs text-danger-500 truncate mt-0.5">↳ {exp.rejection_reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-900 whitespace-nowrap">
                    {formatWon(exp.amount)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <StatusBadge status={exp.status} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td colSpan={5} className="px-3 py-2.5 text-xs font-semibold text-gray-500">
                  총 {filtered.length}건
                </td>
                <td className="px-3 py-2.5 text-right text-sm font-bold text-gray-800">
                  {formatWon(filtered.reduce((s, e) => s + e.amount, 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* 경비 상세 팝업 */}
      {detailExp && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailExp(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-2xl shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">경비 상세</h3>
              <button onClick={() => setDetailExp(null)}><X size={18} className="text-gray-400" /></button>
            </div>

            <div className="grid grid-cols-2 divide-x divide-gray-100">
              {/* 왼쪽: 제출 내용 */}
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">제출 내용</p>
                {/* 상태 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">상태</span>
                  <StatusBadge status={detailExp.status} />
                </div>
                {/* 반려 사유 */}
                {detailExp.status === 'rejected' && detailExp.rejection_reason && (
                  <div className="bg-danger-50 border border-danger-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs font-semibold text-danger-500 mb-1">반려 사유</p>
                    <p className="text-sm text-danger-700">{detailExp.rejection_reason}</p>
                  </div>
                )}
                {/* 날짜 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">지출 날짜</span>
                  <span className="text-sm text-gray-800">
                    {new Date(detailExp.date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                  </span>
                </div>
                {/* 분류 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">분류</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLOR[detailExp.category]}`}>
                    {EXPENSE_CATEGORY_LABEL[detailExp.category]}
                  </span>
                </div>
                {/* 결제방법 */}
                {detailExp.payment_method && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">결제방법</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PAYMENT_METHOD_COLOR[detailExp.payment_method]}`}>
                      {PAYMENT_METHOD_LABEL[detailExp.payment_method]}
                    </span>
                  </div>
                )}
                {/* 금액 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">청구 금액</span>
                  <span className="text-base font-bold text-gray-900">{formatWon(detailExp.amount)}</span>
                </div>
                {/* 내용 */}
                <div>
                  <p className="text-xs text-gray-400 mb-1">지출 내용</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2">{detailExp.description}</p>
                </div>
                {/* 증빙자료 */}
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
                {/* 제출일 */}
                <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                  <span className="text-xs text-gray-400">제출일</span>
                  <span className="text-xs text-gray-500">
                    {new Date(detailExp.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                </div>
              </div>

              {/* 오른쪽: 지급 정보 */}
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">지급 정보</p>
                {detailExp.paid_at ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">지급 상태</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-success-50 text-success-700">지급완료</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">지급일</span>
                      <span className="text-sm text-gray-800">
                        {new Date(detailExp.paid_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                      </span>
                    </div>
                    {detailExp.paid_amount != null && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">지급 금액</span>
                        <span className="text-base font-bold text-success-700">{formatWon(detailExp.paid_amount)}</span>
                      </div>
                    )}
                    {detailExp.paid_amount != null && detailExp.paid_amount !== detailExp.amount && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">차액</span>
                        <span className={`text-sm font-semibold ${detailExp.paid_amount < detailExp.amount ? 'text-danger-500' : 'text-success-600'}`}>
                          {detailExp.paid_amount < detailExp.amount ? '-' : '+'}{formatWon(Math.abs(detailExp.paid_amount - detailExp.amount))}
                        </span>
                      </div>
                    )}
                    {detailExp.payment_bank && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">은행</span>
                        <span className="text-sm text-gray-800">{detailExp.payment_bank}</span>
                      </div>
                    )}
                    {detailExp.payment_account && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">계좌번호</span>
                        <span className="text-sm text-gray-800">{detailExp.payment_account}</span>
                      </div>
                    )}
                    {detailExp.payment_note && (
                      <div>
                        <p className="text-xs text-gray-400 mb-1">메모</p>
                        <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2">{detailExp.payment_note}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">미지급</span>
                    <p className="text-xs text-gray-300">아직 지급 처리가 되지 않았습니다</p>
                  </div>
                )}
              </div>
            </div>
          </div>
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

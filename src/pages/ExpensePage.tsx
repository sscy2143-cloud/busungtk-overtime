import { useState, useEffect, useRef } from 'react'
import { Receipt, Plus, ChevronUp, Upload, X, Image, CheckCircle, AlertTriangle } from 'lucide-react'
import imageCompression from 'browser-image-compression'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { StatusBadge } from '../components/common/StatusBadge'
import type { Expense, ExpenseCategory, PaymentMethod, RequestStatus } from '../types'
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, REQUEST_STATUS_LABEL } from '../types'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 원본 최대 10MB (압축 전)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

async function processFile(file: File, _employeeName: string): Promise<{ file: File; fileName: string } | null> {
  let processed = file

  // HEIC → JPEG 변환
  if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic')) {
    try {
      const heic2any = (await import('heic2any')).default
      const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 }) as Blob
      processed = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' })
    } catch {
      alert('HEIC 파일 변환에 실패했습니다.')
      return null
    }
  }

  // 이미지 압축 (PDF 제외)
  if (processed.type.startsWith('image/')) {
    try {
      processed = await imageCompression(processed, {
        maxSizeMB: 1,
        maxWidthOrHeight: 2048,
        useWebWorker: true,
      })
    } catch {
      // 압축 실패 시 원본 사용
    }
  }

  // 파일명: YYYYMMDD_receipt_랜덤.확장자 (Supabase Storage는 한글 키 불가)
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const ext = processed.name.split('.').pop() ?? 'jpg'
  const rand = Math.random().toString(36).slice(2, 8)
  const fileName = `${dateStr}_receipt_${rand}.${ext}`

  return { file: processed, fileName }
}

const CATEGORIES: ExpenseCategory[] = ['meal', 'transport', 'supplies', 'other']
const PAYMENT_METHODS: PaymentMethod[] = ['card', 'transfer', 'cash', 'other']

const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  meal: 'bg-primary-50 text-primary-700',
  transport: 'bg-dark-100 text-dark-700',
  supplies: 'bg-dark-100 text-dark-700',
  other: 'bg-dark-100 text-dark-600',
}

const PAYMENT_METHOD_COLOR: Record<PaymentMethod, string> = {
  card: 'bg-primary-50 text-primary-700',
  transfer: 'bg-dark-100 text-dark-700',
  cash: 'bg-dark-100 text-dark-700',
  other: 'bg-dark-100 text-dark-600',
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
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null)
  const [cancelModal, setCancelModal] = useState<{ open: boolean; id: string; reason: string }>({ open: false, id: '', reason: '' })
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!employee?.id) return
    fetchExpenses()
  }, [employee?.id])

  useEffect(() => {
    if (!detailExp?.receipt_url) { setReceiptImageUrl(null); return }
    if (detailExp.receipt_url.startsWith('http')) {
      setReceiptImageUrl(detailExp.receipt_url)
    } else {
      supabase.storage.from('receipts').createSignedUrl(detailExp.receipt_url, 600)
        .then(({ data }) => setReceiptImageUrl(data?.signedUrl ?? null))
    }
  }, [detailExp?.receipt_url])

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

  async function confirmReceipt(id: string) {
    const now = new Date().toISOString()
    const ua = navigator.userAgent
    const isMobile = /Mobile|Android|iPhone/i.test(ua)
    const browser = /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : /Edge/.test(ua) ? 'Edge' : 'Other'
    const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : 'Other'
    const deviceInfo = `${os} / ${browser}${isMobile ? ' (모바일)' : ' (PC)'}`

    const { error } = await supabase.rpc('confirm_expense_receipt', {
      p_expense_id: id,
      p_device: deviceInfo,
    })
    if (error) {
      alert('수령 확인에 실패했습니다: ' + error.message)
      return
    }
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, employee_confirmed_at: now, confirmed_device: deviceInfo } : e))
    if (detailExp?.id === id) setDetailExp(prev => prev ? { ...prev, employee_confirmed_at: now, confirmed_device: deviceInfo } : null)
  }

  async function requestCancel() {
    const { id, reason } = cancelModal
    if (!reason.trim()) return
    const now = new Date().toISOString()
    const { error } = await supabase.rpc('request_expense_cancel', {
      p_expense_id: id,
      p_reason: reason.trim(),
    })
    if (error) {
      alert('취소 요청에 실패했습니다: ' + error.message)
      return
    }
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, cancel_requested_at: now, cancel_reason: reason.trim() } : e))
    if (detailExp?.id === id) setDetailExp(prev => prev ? { ...prev, cancel_requested_at: now, cancel_reason: reason.trim() } : null)
    setCancelModal({ open: false, id: '', reason: '' })
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
    // 파일 크기 & 타입 검증
    if (file.size > MAX_FILE_SIZE) {
      alert('파일 크기가 10MB를 초과합니다.')
      return null
    }
    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')
    if (!ALLOWED_TYPES.includes(file.type) && !isHeic) {
      alert('허용되지 않는 파일 형식입니다. (JPG, PNG, WEBP, HEIC, PDF)')
      return null
    }

    // 이미지 처리 (HEIC 변환 + 압축 + 파일명 변경)
    const result = await processFile(file, employee?.name ?? 'unknown')
    if (!result) return null

    const storagePath = `${employee?.id}/${Date.now()}_${result.fileName}`

    const { error } = await supabase.storage
      .from('receipts')
      .upload(storagePath, result.file, { cacheControl: '3600', upsert: false })

    if (error) {
      console.error('증빙자료 업로드 실패:', error.message)
      alert('증빙자료 업로드에 실패했습니다: ' + error.message)
      return null
    }

    // 스토리지 경로를 반환 (서명 URL 대신 경로 저장)
    return storagePath
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !description.trim()) return
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      alert('올바른 금액을 입력하세요.')
      return
    }
    setSubmitting(true)

    let receiptUrl: string | undefined = undefined

    // 파일 업로드 디버그
    console.log('receiptFile:', receiptFile?.name, receiptFile?.size)

    // 파일 업로드
    if (receiptFile) {
      setUploading(true)
      const url = await uploadReceipt(receiptFile)
      setUploading(false)
      if (url) {
        receiptUrl = url
      } else {
        setSubmitting(false)
        return
      }
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
        amount: numericAmount,
        description: finalDescription,
        ...(receiptUrl ? { receipt_url: receiptUrl } : {}),
      })
      .select()
      .single()

    if (error) {
      console.error('경비 등록 실패:', error.message)
      alert('경비 등록에 실패했습니다: ' + error.message)
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
          <h1 className="text-xl font-bold text-dark-900">경비 제출</h1>
          <p className="text-sm text-dark-500 mt-0.5">업무 중 사비로 지출한 경비를 제출합니다</p>
        </div>
        <button
          onClick={() => setFormOpen(!formOpen)}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white text-sm font-semibold rounded-lg hover:bg-primary-500 transition-colors"
        >
          <Plus size={16} />
          경비 신청
        </button>
      </div>

      {/* 요약 */}
      <div data-tour="expense-summary" className="bg-white rounded-xl border border-dark-200 divide-x divide-dark-100 flex overflow-hidden">
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-dark-400 mb-0.5">승인 대기</p>
          <p className="text-lg font-bold text-primary-600">{formatWon(totalPending)}</p>
        </div>
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-dark-400 mb-0.5">승인 완료</p>
          <p className="text-lg font-bold text-dark-700">{formatWon(totalApproved)}</p>
        </div>
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-dark-400 mb-0.5">전체 청구</p>
          <p className="text-lg font-bold text-dark-800">{formatWon(expenses.reduce((s, e) => s + e.amount, 0))}</p>
        </div>
      </div>

      {/* 제출 폼 (토글) */}
      {formOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-dark-800">경비 입력</h2>
            <button type="button" onClick={() => setFormOpen(false)} className="text-dark-400 hover:text-dark-600">
              <ChevronUp size={18} />
            </button>
          </div>

          {/* 날짜 */}
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1">지출 날짜</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          {/* 카테고리 */}
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1.5">분류</label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setCategory(c); if (c !== 'other') setOtherCategoryNote('') }}
                  className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                    category === c
                      ? 'bg-primary-500 text-white border-primary-600'
                      : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
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
              <label className="block text-xs font-medium text-dark-600 mb-1">
                기타 분류 <span className="text-primary-500">*</span>
              </label>
              <input
                type="text"
                value={otherCategoryNote}
                onChange={(e) => setOtherCategoryNote(e.target.value)}
                placeholder="구체적으로 입력하세요 (예: 숙박비, 택시비, 공구 구입)"
                required
                className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          )}

          {/* 결제방법 */}
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1.5">결제방법</label>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setPaymentMethod(m); if (m !== 'other') setOtherPaymentNote('') }}
                  className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                    paymentMethod === m
                      ? 'bg-primary-500 text-white border-primary-600'
                      : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
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
              <label className="block text-xs font-medium text-dark-600 mb-1">
                기타 결제방법 <span className="text-primary-500">*</span>
              </label>
              <input
                type="text"
                value={otherPaymentNote}
                onChange={(e) => setOtherPaymentNote(e.target.value)}
                placeholder="구체적으로 입력하세요 (예: 개인카드, 상품권)"
                required
                className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          )}

          {/* 금액 */}
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1">금액</label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="0"
                step="100"
                required
                className="w-full px-3 py-2.5 pr-8 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 text-right"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dark-400">원</span>
            </div>
          </div>

          {/* 내용 */}
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1">
              지출 내용 <span className="text-primary-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="지출 내용을 입력하세요 (예: 현장 점심 식대 4인분)"
              required
              className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          {/* 증빙자료 업로드 */}
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1">증빙자료 <span className="text-danger-500">*</span></label>
            <p className="text-xs text-dark-400 mb-1.5">1MB 이하 파일만 첨부 가능합니다.</p>
            {receiptFile ? (
              <div className="border border-dark-200 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Image size={16} className="text-dark-400 shrink-0" />
                    <span className="text-xs text-dark-700 truncate">{receiptFile.name}</span>
                    <span className="text-xs text-dark-400 shrink-0">
                      ({(receiptFile.size / 1024).toFixed(0)}KB)
                    </span>
                  </div>
                  <button type="button" onClick={removeFile} className="text-dark-400 hover:text-primary-500 shrink-0 ml-2">
                    <X size={16} />
                  </button>
                </div>
                {receiptPreview && (
                  <img
                    src={receiptPreview}
                    alt="증빙 미리보기"
                    className="mt-2 rounded-lg max-h-40 object-contain w-full bg-dark-50"
                  />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-dark-200 rounded-xl text-xs text-dark-500 hover:border-primary-300 hover:text-primary-600 transition-colors"
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
            disabled={submitting || uploading || !amount || !description.trim() || !receiptFile || (category === 'other' && !otherCategoryNote.trim()) || (paymentMethod === 'other' && !otherPaymentNote.trim())}
            className="w-full py-2.5 bg-primary-500 text-white text-sm font-semibold rounded-xl hover:bg-primary-500 disabled:opacity-50 transition-colors"
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
                ? 'bg-primary-500 text-white border-primary-600'
                : 'bg-white text-dark-500 border-dark-200 hover:border-dark-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 경비 목록 */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-dark-200 p-12 text-center">
          <Receipt className="w-12 h-12 text-dark-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-dark-500 mb-1">경비 내역이 없습니다</p>
          <p className="text-xs text-dark-400">업무 중 사비 지출이 있으면 제출해 주세요</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-dark-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-dark-50 border-b border-dark-200">
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-dark-400 w-10">번호</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500 whitespace-nowrap">지출일</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500">분류</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500 hidden sm:table-cell">결제방법</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500">내용</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-dark-500 whitespace-nowrap">금액</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-dark-500">상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((exp, idx) => (
                <tr
                  key={exp.id}
                  onClick={() => setDetailExp(exp)}
                  className={`border-b border-dark-100 last:border-0 cursor-pointer transition-colors ${idx % 2 === 1 ? 'bg-dark-50/50' : 'bg-white'} hover:bg-primary-50/40`}
                >
                  <td className="px-3 py-2.5 text-center text-xs font-bold text-dark-300">{idx + 1}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-600 whitespace-nowrap">
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
                    <p className="text-xs text-dark-700 truncate">{exp.description}</p>
                    {exp.status === 'rejected' && exp.rejection_reason && (
                      <p className="text-xs text-primary-500 truncate mt-0.5">↳ {exp.rejection_reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm font-semibold text-dark-900 whitespace-nowrap">
                    {formatWon(exp.amount)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <StatusBadge status={exp.status} />
                      {exp.paid_at && !exp.employee_confirmed_at && !exp.cancel_requested_at && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 animate-pulse whitespace-nowrap">
                          수령확인 필요
                        </span>
                      )}
                      {exp.employee_confirmed_at && !exp.cancel_requested_at && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-dark-50 text-dark-700 whitespace-nowrap">
                          수령완료
                        </span>
                      )}
                      {exp.cancel_requested_at && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 whitespace-nowrap">
                          취소요청중
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-dark-200 bg-dark-50">
                <td colSpan={5} className="px-3 py-2.5 text-xs font-semibold text-dark-500">
                  총 {filtered.length}건
                </td>
                <td className="px-3 py-2.5 text-right text-sm font-bold text-dark-800">
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
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDetailExp(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-2xl shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
              <h3 className="text-base font-bold text-dark-900">경비 상세</h3>
              <button onClick={() => setDetailExp(null)}><X size={18} className="text-dark-400" /></button>
            </div>

            <div className="grid grid-cols-2 divide-x divide-dark-100">
              {/* 왼쪽: 제출 내용 */}
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-2">제출 내용</p>
                {/* 상태 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-dark-400">상태</span>
                  <StatusBadge status={detailExp.status} />
                </div>
                {/* 반려 사유 */}
                {detailExp.status === 'rejected' && detailExp.rejection_reason && (
                  <div className="bg-primary-50 border border-primary-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs font-semibold text-primary-500 mb-1">반려 사유</p>
                    <p className="text-sm text-primary-700">{detailExp.rejection_reason}</p>
                  </div>
                )}
                {/* 승인 취소 사유 */}
                {detailExp.status === 'pending' && detailExp.rejection_reason && (
                  <div className="bg-warning-50 border border-warning-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs font-semibold text-warning-600 mb-1">승인 취소 사유</p>
                    <p className="text-sm text-warning-700">{detailExp.rejection_reason}</p>
                    <p className="text-xs text-dark-500 mt-1">관리자가 승인을 취소하여 다시 검토 상태로 변경했습니다.</p>
                  </div>
                )}
                {/* 날짜 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-dark-400">지출 날짜</span>
                  <span className="text-sm text-dark-800">
                    {new Date(detailExp.date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                  </span>
                </div>
                {/* 분류 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-dark-400">분류</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLOR[detailExp.category]}`}>
                    {EXPENSE_CATEGORY_LABEL[detailExp.category]}
                  </span>
                </div>
                {/* 결제방법 */}
                {detailExp.payment_method && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-dark-400">결제방법</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PAYMENT_METHOD_COLOR[detailExp.payment_method]}`}>
                      {PAYMENT_METHOD_LABEL[detailExp.payment_method]}
                    </span>
                  </div>
                )}
                {/* 금액 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-dark-400">청구 금액</span>
                  <span className="text-base font-bold text-dark-900">{formatWon(detailExp.amount)}</span>
                </div>
                {/* 내용 */}
                <div>
                  <p className="text-xs text-dark-400 mb-1">지출 내용</p>
                  <p className="text-sm text-dark-700 bg-dark-50 rounded-xl px-3 py-2">{detailExp.description}</p>
                </div>
                {/* 증빙자료 */}
                {detailExp.receipt_url && (
                  <div>
                    <p className="text-xs text-dark-400 mb-1">증빙자료</p>
                    {receiptImageUrl ? (
                      <img
                        src={receiptImageUrl}
                        alt="증빙자료"
                        className="w-full rounded-xl border border-dark-200 max-h-60 object-contain bg-dark-50 cursor-pointer"
                        onClick={() => window.open(receiptImageUrl, '_blank')}
                      />
                    ) : (
                      <p className="text-xs text-dark-400">로딩 중...</p>
                    )}
                  </div>
                )}
                {/* 제출일 */}
                <div className="flex items-center justify-between pt-1 border-t border-dark-100">
                  <span className="text-xs text-dark-400">제출일</span>
                  <span className="text-xs text-dark-500">
                    {new Date(detailExp.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                </div>
              </div>

              {/* 오른쪽: 지급 정보 */}
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-2">지급 정보</p>
                {detailExp.paid_at ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-dark-400">지급 상태</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-dark-50 text-dark-800">지급완료</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-dark-400">지급일</span>
                      <span className="text-sm text-dark-800">
                        {new Date(detailExp.paid_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                      </span>
                    </div>
                    {detailExp.paid_amount != null && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-dark-400">지급 금액</span>
                        <span className="text-base font-bold text-dark-800">{formatWon(detailExp.paid_amount)}</span>
                      </div>
                    )}
                    {detailExp.paid_amount != null && detailExp.paid_amount !== detailExp.amount && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-dark-400">차액</span>
                        <span className={`text-sm font-semibold ${detailExp.paid_amount < detailExp.amount ? 'text-primary-500' : 'text-dark-700'}`}>
                          {detailExp.paid_amount < detailExp.amount ? '-' : '+'}{formatWon(Math.abs(detailExp.paid_amount - detailExp.amount))}
                        </span>
                      </div>
                    )}
                    {detailExp.payment_bank && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-dark-400">은행</span>
                        <span className="text-sm text-dark-800">{detailExp.payment_bank}</span>
                      </div>
                    )}
                    {detailExp.payment_account && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-dark-400">계좌번호</span>
                        <span className="text-sm text-dark-800">{detailExp.payment_account}</span>
                      </div>
                    )}
                    {detailExp.payment_note && (
                      <div>
                        <p className="text-xs text-dark-400 mb-1">메모</p>
                        <p className="text-sm text-dark-700 bg-dark-50 rounded-xl px-3 py-2">{detailExp.payment_note}</p>
                      </div>
                    )}

                    {/* 수령확인 / 취소요청 */}
                    <div className="pt-3 border-t border-dark-100 space-y-2">
                      {detailExp.cancel_requested_at ? (
                        <div className="bg-primary-50 border border-primary-200 rounded-xl px-3 py-2.5">
                          <p className="text-xs font-semibold text-primary-700 mb-1">취소 요청중</p>
                          <p className="text-xs text-primary-600">{detailExp.cancel_reason}</p>
                          <p className="text-xs text-dark-400 mt-1">담당자 승인 대기중입니다.</p>
                        </div>
                      ) : detailExp.employee_confirmed_at ? (
                        <>
                          <div className="flex items-center gap-2 text-dark-800 bg-dark-50 rounded-xl px-3 py-2.5">
                            <CheckCircle size={16} />
                            <div>
                              <p className="text-xs font-semibold">수령 확인 완료</p>
                              <p className="text-xs text-dark-700">
                                {new Date(detailExp.employee_confirmed_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => setCancelModal({ open: true, id: detailExp.id, reason: '' })}
                            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-primary-700 border border-primary-200 rounded-xl hover:bg-primary-50 transition-colors"
                          >
                            <AlertTriangle size={14} />
                            취소 요청
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => confirmReceipt(detailExp.id)}
                          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-white bg-dark-900 rounded-xl hover:bg-dark-800 transition-colors"
                        >
                          <CheckCircle size={16} />
                          수령 확인
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-dark-100 text-dark-400">미지급</span>
                    <p className="text-xs text-dark-300">아직 지급 처리가 되지 않았습니다</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 취소 요청 모달 */}
      {cancelModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setCancelModal({ open: false, id: '', reason: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">취소 요청</h3>
              <button onClick={() => setCancelModal({ open: false, id: '', reason: '' })}><X size={18} className="text-dark-400" /></button>
            </div>
            <p className="text-xs text-dark-500 mb-3">
              취소 사유를 입력해주세요. 담당자 승인 후 처리됩니다.
            </p>
            <textarea
              className="w-full border border-dark-200 rounded-xl px-3 py-2.5 text-sm text-dark-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={3}
              placeholder="취소 사유를 입력하세요"
              value={cancelModal.reason}
              onChange={(e) => setCancelModal(p => ({ ...p, reason: e.target.value }))}
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setCancelModal({ open: false, id: '', reason: '' })} className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50">닫기</button>
              <button onClick={requestCancel} disabled={!cancelModal.reason.trim()} className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-500 disabled:opacity-40 transition-colors">요청</button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-dark-900 text-white text-sm px-5 py-3 rounded-full shadow-lg z-50">
          경비가 제출되었습니다
        </div>
      )}
    </div>
  )
}

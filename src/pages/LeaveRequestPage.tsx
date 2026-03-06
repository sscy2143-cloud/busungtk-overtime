import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, AlertTriangle, CalendarDays } from 'lucide-react'
import type { LeaveType } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'


const LEAVE_TYPES: LeaveType[] = ['annual', 'half_am', 'half_pm', 'sick', 'special']

const HALF_DAY_TYPES: LeaveType[] = ['half_am', 'half_pm']

const OTHER_SUBTYPES: { label: string; days: number }[] = [
  { label: '본인/배우자의 조부모·외조부모·형제자매 사망', days: 2 },
  { label: '본인/배우자의 부모·배우자 사망', days: 3 },
  { label: '본인 결혼', days: 5 },
  { label: '건강검진', days: 0.5 },
  { label: '예비군/민방위 훈련', days: 1 },
  { label: '배우자 출산', days: 3 },
]

function countWeekdays(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start)
  const e = new Date(end)
  if (s > e) return 0
  let count = 0
  const cur = new Date(s)
  while (cur <= e) {
    const day = cur.getDay()
    if (day !== 0 && day !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

export function LeaveRequestPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { employee } = useAuth()
  const [remainingDays, setRemainingDays] = useState(0)

  useEffect(() => {
    if (!employee?.id) return
    async function fetchBalance() {
      const currentYear = new Date().getFullYear()
      const { data } = await supabase
        .from('leave_balances')
        .select('remaining_days')
        .eq('employee_id', employee!.id)
        .eq('year', currentYear)
        .single()
      if (data) setRemainingDays(data.remaining_days)
    }
    fetchBalance()
  }, [employee?.id])

  const [leaveType, setLeaveType] = useState<LeaveType>((searchParams.get('type') as LeaveType) || 'annual')
  const [otherSubType, setOtherSubType] = useState(OTHER_SUBTYPES[0].label)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isHalfDay = HALF_DAY_TYPES.includes(leaveType)
  const isOther = leaveType === 'special'
  const otherSubInfo = OTHER_SUBTYPES.find((s) => s.label === otherSubType) ?? OTHER_SUBTYPES[0]

  const calculatedDays = useMemo(() => {
    if (isHalfDay) return 0.5
    if (isOther) return otherSubInfo.days
    if (!startDate) return 0
    const end = endDate || startDate
    return countWeekdays(startDate, end)
  }, [isHalfDay, isOther, otherSubInfo, startDate, endDate])

  const isOverLimit = !isOther && calculatedDays > remainingDays
  const canSubmit = startDate && calculatedDays > 0 && !isOverLimit && (isOther || reason.trim().length > 0)

  function handleLeaveTypeChange(type: LeaveType) {
    setLeaveType(type)
    if (HALF_DAY_TYPES.includes(type)) {
      setEndDate('')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)

    const finalReason = isOther ? otherSubType + (reason.trim() ? ` / ${reason.trim()}` : '') : reason.trim()
    const finalEnd = isHalfDay ? startDate : (endDate || startDate)

    // DB에 휴가 신청 저장
    const { error } = await supabase.from('leave_requests').insert({
      employee_id: employee?.id ?? '',
      type: leaveType,
      start_date: startDate,
      end_date: finalEnd,
      days: calculatedDays,
      reason: finalReason,
    })

    if (error) {
      console.error('[LeaveRequest] insert error:', error)
      setSubmitting(false)
      return
    }

    // 사장님에게 SMS 알림 발송
    try {
      await fetch('/api/notify-leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName: employee?.name ?? '직원',
          leaveType: isOther ? otherSubType : LEAVE_TYPE_LABEL[leaveType],
          startDate,
          endDate: finalEnd,
          days: calculatedDays,
          reason: finalReason,
        }),
      })
    } catch (err) {
      console.error('SMS 알림 발송 실패:', err)
    }

    setSubmitting(false)
    navigate('/leave')
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">휴가 신청</h1>
          <p className="text-xs text-gray-400">잔여 연차 {remainingDays}일</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 유형 선택 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <label className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-primary-600" />
            휴가 유형
          </label>
          <select
            value={leaveType}
            onChange={(e) => handleLeaveTypeChange(e.target.value as LeaveType)}
            className="w-full mt-2 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
          >
            {LEAVE_TYPES.map((type) => (
              <option key={type} value={type}>
                {LEAVE_TYPE_LABEL[type]}{HALF_DAY_TYPES.includes(type) ? ' (0.5일)' : ''}
              </option>
            ))}
          </select>

          {/* 기타 세부 유형 */}
          {isOther && (
            <div className="mt-3">
              <label className="text-xs text-gray-500 mb-1 block">세부 유형</label>
              <select
                value={otherSubType}
                onChange={(e) => setOtherSubType(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
              >
                {OTHER_SUBTYPES.map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label} ({s.days}일)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 날짜 선택 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">날짜 선택</p>

          {(isHalfDay || isOther) ? (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                required
              />
              {isHalfDay && <p className="text-xs text-gray-400 mt-1.5">반차는 0.5일 차감됩니다</p>}
              {isOther && <p className="text-xs text-gray-400 mt-1.5">일수는 {otherSubInfo.days}일 자동 적용됩니다</p>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">시작일</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    if (endDate && e.target.value > endDate) setEndDate(e.target.value)
                  }}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">종료일</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
          )}

          {/* 일수 계산 결과 */}
          {calculatedDays > 0 && (
            <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${
              isOverLimit ? 'bg-danger-50 border border-danger-200' : 'bg-primary-50'
            }`}>
              <span className="text-xs text-gray-600">신청 일수 (주말 제외)</span>
              <span className={`text-sm font-bold ${isOverLimit ? 'text-danger-600' : 'text-primary-700'}`}>
                {calculatedDays}일
              </span>
            </div>
          )}

          {/* 잔여 초과 경고 */}
          {isOverLimit && (
            <div className="flex items-center gap-2 bg-danger-50 border border-danger-200 rounded-xl px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-danger-500 shrink-0" />
              <p className="text-xs text-danger-600">
                잔여 연차({remainingDays}일)를 초과합니다. 신청 일수를 줄여주세요.
              </p>
            </div>
          )}
        </div>

        {/* 사유 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <label className="text-sm font-semibold text-gray-700 mb-2 block">
            사유 {!isOther && <span className="text-danger-500">*</span>}
            {isOther && <span className="text-gray-400 text-xs font-normal ml-1">(선택)</span>}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="휴가 사유를 입력하세요"
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
            required
          />
          <p className="text-xs text-gray-400 mt-1">{reason.length}자</p>
        </div>

        {/* 잔여 일수 요약 */}
        <div className="bg-gray-50 rounded-xl px-4 py-3 flex justify-between items-center">
          <span className="text-xs text-gray-500">신청 후 잔여 연차</span>
          <span className={`text-sm font-bold ${isOverLimit ? 'text-danger-600' : 'text-gray-800'}`}>
            {remainingDays - calculatedDays}일
          </span>
        </div>

        {/* 제출 */}
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="w-full py-3.5 text-sm font-bold text-white bg-primary-600 rounded-2xl hover:bg-primary-700 active:bg-primary-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {submitting ? '신청 중...' : '휴가 신청하기'}
        </button>
      </form>
    </div>
  )
}

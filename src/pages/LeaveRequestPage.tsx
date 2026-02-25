import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, AlertTriangle, CalendarDays } from 'lucide-react'
import type { LeaveType } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'
import { useAuth } from '../contexts/AuthContext'

const REMAINING_DAYS = 12

const LEAVE_TYPES: LeaveType[] = ['annual', 'half_am', 'half_pm', 'special', 'sick']

const HALF_DAY_TYPES: LeaveType[] = ['half_am', 'half_pm']

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
  const { employee } = useAuth()
  const [leaveType, setLeaveType] = useState<LeaveType>('annual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isHalfDay = HALF_DAY_TYPES.includes(leaveType)

  const calculatedDays = useMemo(() => {
    if (isHalfDay) return 0.5
    if (!startDate) return 0
    const end = endDate || startDate
    return countWeekdays(startDate, end)
  }, [isHalfDay, startDate, endDate])

  const isOverLimit = calculatedDays > REMAINING_DAYS
  const canSubmit = reason.trim().length > 0 && startDate && calculatedDays > 0 && !isOverLimit

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

    const leaveData = {
      type: leaveType,
      start_date: startDate,
      end_date: isHalfDay ? startDate : (endDate || startDate),
      days: calculatedDays,
      reason,
    }
    console.log('휴가 신청:', leaveData)

    // 사장님에게 SMS 알림 발송
    try {
      await fetch('/api/notify-leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName: employee?.name ?? '직원',
          leaveType: LEAVE_TYPE_LABEL[leaveType],
          startDate,
          endDate: isHalfDay ? startDate : (endDate || startDate),
          days: calculatedDays,
          reason,
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
          <p className="text-xs text-gray-400">잔여 연차 {REMAINING_DAYS}일</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 유형 선택 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <label className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-primary-600" />
            휴가 유형
          </label>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {LEAVE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleLeaveTypeChange(type)}
                className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-colors ${
                  leaveType === type
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300 hover:text-primary-600'
                }`}
              >
                {LEAVE_TYPE_LABEL[type]}
                {HALF_DAY_TYPES.includes(type) && (
                  <span className="ml-1 text-xs opacity-70">(0.5일)</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 날짜 선택 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">날짜 선택</p>

          {isHalfDay ? (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">날짜</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                required
              />
              <p className="text-xs text-gray-400 mt-1.5">반차는 0.5일 차감됩니다</p>
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
                잔여 연차({REMAINING_DAYS}일)를 초과합니다. 신청 일수를 줄여주세요.
              </p>
            </div>
          )}
        </div>

        {/* 사유 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <label className="text-sm font-semibold text-gray-700 mb-2 block">
            사유 <span className="text-danger-500">*</span>
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
            {REMAINING_DAYS - calculatedDays}일
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

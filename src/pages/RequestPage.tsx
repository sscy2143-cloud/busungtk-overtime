import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Users, Calendar, Clock, Info } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { OVERTIME_TYPE_LABEL } from '../types'
import { GroupMemberSelect } from '../components/overtime/GroupMemberSelect'
import { WeeklyGauge } from '../components/overtime/WeeklyGauge'
import {
  calculateOvertimeBreakdown,
  isHolidayDate,
  getHolidayName,
  formatMinutes,
} from '../utils/overtime-calc'

export function RequestPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  const currentWeeklyHours = 0 // TODO: fetch from Supabase

  const [date, setDate] = useState(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [reason, setReason] = useState('')
  const [forceHoliday, setForceHoliday] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(false)

  // 자동 판정
  const autoHoliday = date ? isHolidayDate(date) : false
  const holidayName = date ? getHolidayName(date) : null
  const effectiveHoliday = autoHoliday || forceHoliday

  // 실시간 분류 계산
  const breakdown = useMemo(() => {
    if (!date || !startTime || !endTime) return null
    return calculateOvertimeBreakdown(date, startTime, endTime, forceHoliday)
  }, [date, startTime, endTime, forceHoliday])

  const isOverWeekly = currentWeeklyHours >= 48

  function showToast() {
    setToast(true)
    setTimeout(() => setToast(false), 2500)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !startTime || !endTime || !reason.trim() || !breakdown) return
    setSubmitting(true)

    const payload = {
      employee_id: employee?.id ?? '',
      type: breakdown.primaryType,
      date,
      planned_start: startTime,
      planned_end: endTime,
      reason: reason.trim(),
      is_retroactive: true, // 사후 제출이므로 항상 true
      group_member_ids: groupIds,
    }
    console.log('[RequestPage] submit payload:', payload)

    // TODO: Supabase insert
    await new Promise((r) => setTimeout(r, 600))

    setSubmitting(false)
    showToast()
    setTimeout(() => navigate('/requests'), 800)
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-24">
      <h1 className="text-xl font-bold text-gray-900 mb-6">야근 제출</h1>

      {/* 주간 게이지 */}
      <div className="mb-6">
        <WeeklyGauge currentHours={currentWeeklyHours} />
      </div>

      {/* 48h 초과 경고 */}
      {isOverWeekly && (
        <div className="flex items-start gap-2 bg-warning-50 border border-warning-400 rounded-xl px-4 py-3 mb-6 text-sm text-warning-500">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>이번 주 누적 근무시간이 <strong>48시간</strong>을 초과했습니다. 추가 승인이 필요할 수 있습니다.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 날짜 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Calendar size={15} />
              근무 날짜
            </span>
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setForceHoliday(false)
            }}
            required
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
          />

          {/* 휴일 자동 감지 배지 */}
          {date && (autoHoliday || forceHoliday) && (
            <div className="flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg">
              <span className="text-xs font-medium text-orange-700">
                {holidayName ? `${holidayName} (휴일근로 적용)` : '휴일근로 적용'}
              </span>
            </div>
          )}

          {/* 공휴일 수동 지정 (자동 감지 안 된 경우만) */}
          {date && !autoHoliday && (
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={forceHoliday}
                onChange={(e) => setForceHoliday(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-400"
              />
              <span className="text-xs text-gray-500">공휴일/임시공휴일로 지정</span>
            </label>
          )}
        </div>

        {/* 시간 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Clock size={15} />
              근무 시간
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">시작</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">종료</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">종료가 시작보다 이르면 익일로 계산됩니다</p>
        </div>

        {/* 자동 분류 결과 */}
        {breakdown && breakdown.totalMinutes > 0 && (
          <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <Info size={14} className="text-primary-600" />
              <span className="text-sm font-semibold text-gray-700">자동 분류 결과</span>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <span>총 {formatMinutes(breakdown.totalMinutes)}</span>
              <span className="text-gray-300">|</span>
              <span className={`font-medium px-2 py-0.5 rounded-full ${
                effectiveHoliday ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {effectiveHoliday ? '휴일' : '평일'}
              </span>
              <span className="font-medium text-gray-600">
                {OVERTIME_TYPE_LABEL[breakdown.primaryType]}
              </span>
            </div>

            {/* 수당 항목별 표시 */}
            <div className="space-y-1.5">
              {breakdown.payItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-gray-100"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      item.multiplier >= 2.5 ? 'bg-danger-500' :
                      item.multiplier >= 2.0 ? 'bg-warning-500' :
                      'bg-primary-500'
                    }`} />
                    <span className="text-sm text-gray-700">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">
                      {formatMinutes(item.minutes)}
                    </span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      item.multiplier >= 2.5 ? 'bg-danger-50 text-danger-700' :
                      item.multiplier >= 2.0 ? 'bg-warning-50 text-warning-700' :
                      'bg-primary-50 text-primary-700'
                    }`}>
                      x{item.multiplier}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 사유 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            사유 <span className="text-danger-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="야근 내용을 입력하세요 (업무 내용, 시간 등)"
            required
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
          />
        </div>

        {/* 그룹 제출 */}
        <div>
          <button
            type="button"
            onClick={() => setGroupOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-primary-600"
          >
            <Users size={16} />
            함께 근무한 직원 추가
            {groupIds.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary-100 text-primary-700 text-xs rounded-full">
                {groupIds.length}명
              </span>
            )}
          </button>

          {groupOpen && (
            <div className="mt-3">
              <GroupMemberSelect
                selectedIds={groupIds}
                onSelect={setGroupIds}
              />
            </div>
          )}
        </div>

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={submitting || !breakdown || breakdown.totalMinutes <= 0}
          className="w-full py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors mt-2"
        >
          {submitting ? '제출 중...' : '제출하기'}
        </button>
      </form>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5 py-3 rounded-full shadow-lg z-50">
          제출이 완료되었습니다
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import type { OvertimeType } from '../types'
import { OVERTIME_TYPE_LABEL } from '../types'
import { GroupMemberSelect } from '../components/overtime/GroupMemberSelect'
import { WeeklyGauge } from '../components/overtime/WeeklyGauge'

const OVERTIME_TYPES: OvertimeType[] = ['extended', 'night', 'holiday']

// 데모: 이번 주 누적 시간
const DEMO_WEEKLY_HOURS = 46.5

export function RequestPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  const [type, setType] = useState<OvertimeType>('extended')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [reason, setReason] = useState('')
  const [groupOpen, setGroupOpen] = useState(false)
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const isRetroactive = date !== '' && date < today
  const isOverWeekly = DEMO_WEEKLY_HOURS >= 48

  function showToast() {
    setToast(true)
    setTimeout(() => setToast(false), 2500)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !startTime || !endTime || !reason.trim()) return
    setSubmitting(true)

    const payload = {
      employee_id: employee?.id ?? 'demo',
      type,
      date,
      planned_start: startTime,
      planned_end: endTime,
      reason: reason.trim(),
      is_retroactive: isRetroactive,
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
      {/* 헤더 */}
      <h1 className="text-xl font-bold text-gray-900 mb-6">야근 신청</h1>

      {/* 주간 게이지 */}
      <div className="mb-6">
        <WeeklyGauge currentHours={DEMO_WEEKLY_HOURS} />
      </div>

      {/* 48h 초과 경고 */}
      {isOverWeekly && (
        <div className="flex items-start gap-2 bg-warning-50 border border-warning-400 rounded-xl px-4 py-3 mb-6 text-sm text-warning-500">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>이번 주 누적 근무시간이 <strong>48시간</strong>을 초과했습니다. 추가 승인이 필요할 수 있습니다.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 근무 유형 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">근무 유형</label>
          <div className="grid grid-cols-3 gap-2">
            {OVERTIME_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                  type === t
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                }`}
              >
                {OVERTIME_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        {/* 날짜 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          {/* 소급 신청 경고 */}
          {isRetroactive && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-warning-500">
              <AlertTriangle size={13} />
              <span>과거 날짜입니다. <strong>소급 신청</strong>으로 처리됩니다.</span>
            </div>
          )}
        </div>

        {/* 시간 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">시작 시간</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">종료 시간</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
        </div>

        {/* 사유 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            사유 <span className="text-danger-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="야근 사유를 입력하세요"
            required
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
          />
        </div>

        {/* 그룹 신청 */}
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
          disabled={submitting}
          className="w-full py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors mt-2"
        >
          {submitting ? '제출 중...' : '신청하기'}
        </button>
      </form>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5 py-3 rounded-full shadow-lg z-50">
          신청이 완료되었습니다
        </div>
      )}
    </div>
  )
}

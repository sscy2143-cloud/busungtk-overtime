import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, CalendarDays } from 'lucide-react'
import { StatusBadge } from '../components/common/StatusBadge'
import type { LeaveRequest } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'


const LEAVE_TYPE_COLOR: Record<string, string> = {
  annual: 'bg-primary-50 text-primary-700',
  half_am: 'bg-purple-50 text-purple-700',
  half_pm: 'bg-purple-50 text-purple-700',
  special: 'bg-teal-50 text-teal-700',
  sick: 'bg-orange-50 text-orange-700',
}

export function LeavePage() {
  const navigate = useNavigate()
  const [balance] = useState({ total_days: 0, used_days: 0, remaining_days: 0 })
  const [requests] = useState<LeaveRequest[]>([])
  const { total_days, used_days, remaining_days } = balance
  const usedPct = total_days > 0 ? Math.round((used_days / total_days) * 100) : 0

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
              <StatusBadge status={req.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

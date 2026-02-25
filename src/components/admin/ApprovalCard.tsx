import { Users, Clock, AlertTriangle } from 'lucide-react'
import { StatusBadge } from '../common/StatusBadge'
import type { OvertimeRequest, LeaveRequest } from '../../types'
import { OVERTIME_TYPE_LABEL, LEAVE_TYPE_LABEL } from '../../types'

interface ApprovalCardProps {
  request: OvertimeRequest | LeaveRequest
  type: 'overtime' | 'leave'
  onApprove: (id: string) => void
  onReject: (id: string) => void
  checked?: boolean
  onCheck?: (id: string, checked: boolean) => void
  weeklyHours?: number
}

function isOvertimeRequest(r: OvertimeRequest | LeaveRequest): r is OvertimeRequest {
  return 'planned_start' in r
}

export function ApprovalCard({
  request,
  type,
  onApprove,
  onReject,
  checked = false,
  onCheck,
  weeklyHours,
}: ApprovalCardProps) {
  const isOvertime = type === 'overtime'
  const overtime = isOvertimeRequest(request) ? request : null
  const leave = !isOvertimeRequest(request) ? request : null
  const isExceeding = weeklyHours !== undefined && weeklyHours >= 52

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 ${isExceeding ? 'border-danger-300' : 'border-gray-100'}`}>
      {/* 상단: 체크박스 + 신청자 + 배지 */}
      <div className="flex items-start gap-3">
        {onCheck && (
          <input
            type="checkbox"
            className="mt-1 w-4 h-4 accent-primary-600 shrink-0 cursor-pointer"
            checked={checked}
            onChange={(e) => onCheck(request.id, e.target.checked)}
          />
        )}

        {/* 아바타 */}
        <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-primary-700">
            {request.employee?.name?.charAt(0) ?? '?'}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">
              {request.employee?.name ?? '알 수 없음'}
            </span>
            <span className="text-xs text-gray-400">{request.employee?.department}</span>
            <StatusBadge status={request.status} />
          </div>

          {/* 유형 태그 */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium">
              {isOvertime
                ? OVERTIME_TYPE_LABEL[(overtime!.type)]
                : LEAVE_TYPE_LABEL[(leave!.type)]}
            </span>

            {/* 그룹 신청 태그 */}
            {overtime?.group_id && (
              <span className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                <Users className="w-3 h-3" />
                그룹 신청
              </span>
            )}

            {/* 52시간 초과 경고 */}
            {isExceeding && (
              <span className="flex items-center gap-1 text-xs bg-danger-50 text-danger-600 px-2 py-0.5 rounded-full font-medium">
                <AlertTriangle className="w-3 h-3" />
                52h 초과
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 상세 정보 */}
      <div className="mt-3 ml-12 space-y-1">
        {isOvertime && overtime && (
          <>
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              <span>{overtime.date}</span>
              <span className="text-gray-400">|</span>
              <span>{overtime.planned_start} ~ {overtime.planned_end}</span>
            </div>
            {weeklyHours !== undefined && (
              <p className="text-xs text-gray-500">
                주간 누적:{' '}
                <span className={`font-semibold ${isExceeding ? 'text-danger-600' : 'text-gray-700'}`}>
                  {weeklyHours.toFixed(1)}h
                </span>
              </p>
            )}
          </>
        )}
        {!isOvertime && leave && (
          <div className="text-xs text-gray-600">
            <span>{leave.start_date}</span>
            {leave.start_date !== leave.end_date && (
              <span> ~ {leave.end_date}</span>
            )}
            <span className="ml-1 text-gray-400">({leave.days}일)</span>
          </div>
        )}

        {/* 사유 */}
        <p className="text-xs text-gray-500 line-clamp-2">{request.reason}</p>
      </div>

      {/* 액션 버튼 */}
      {request.status === 'pending' && (
        <div className="flex gap-2 mt-3 ml-12">
          <button
            onClick={() => onApprove(request.id)}
            className="flex-1 py-1.5 text-xs font-semibold bg-success-500 text-white rounded-lg hover:bg-success-600 active:bg-success-700 transition-colors"
          >
            승인
          </button>
          <button
            onClick={() => onReject(request.id)}
            className="flex-1 py-1.5 text-xs font-semibold bg-white text-danger-600 border border-danger-300 rounded-lg hover:bg-danger-50 active:bg-danger-100 transition-colors"
          >
            반려
          </button>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar, Clock, ChevronRight } from 'lucide-react'
import type { OvertimeRequest, RequestStatus } from '../types'
import { OVERTIME_TYPE_LABEL, REQUEST_STATUS_LABEL } from '../types'
import { StatusBadge } from '../components/common/StatusBadge'


const FILTER_TABS: Array<{ key: RequestStatus | 'all'; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: REQUEST_STATUS_LABEL.pending },
  { key: 'approved', label: REQUEST_STATUS_LABEL.approved },
  { key: 'rejected', label: REQUEST_STATUS_LABEL.rejected },
]

const TYPE_COLOR: Record<string, string> = {
  extended: 'bg-blue-100 text-blue-700',
  night: 'bg-indigo-100 text-indigo-700',
  holiday: 'bg-orange-100 text-orange-700',
}

export function RequestListPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<RequestStatus | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [requests] = useState<OvertimeRequest[]>([])

  const filtered =
    filter === 'all'
      ? requests
      : requests.filter((r) => r.status === filter)

  function formatDate(d: string) {
    const dt = new Date(d)
    return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${['일','월','화','수','목','금','토'][dt.getDay()]})`
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-24">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">내 제출 목록</h1>
        <button
          onClick={() => navigate('/request')}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors"
        >
          <Plus size={16} />
          새 제출
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
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
            {tab.key !== 'all' && (
              <span className="ml-1 text-xs opacity-70">
                {requests.filter((r) => r.status === tab.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 카드 리스트 */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">신청 내역이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => {
            const isExpanded = expandedId === req.id
            const memberCount = 0
            return (
              <div
                key={req.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <button
                  className="w-full text-left px-4 py-4"
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* 날짜 + 뱃지 */}
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <Calendar size={12} />
                          {formatDate(req.date)}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                          {OVERTIME_TYPE_LABEL[req.type]}
                        </span>
                        {req.is_retroactive && (
                          <span className="text-xs text-warning-500 font-medium">소급</span>
                        )}
                      </div>
                      {/* 시간 */}
                      <div className="flex items-center gap-1 text-sm font-semibold text-gray-800 mb-1">
                        <Clock size={14} className="text-gray-400" />
                        {req.planned_start} ~ {req.planned_end}
                        {memberCount > 0 && (
                          <span className="ml-1 text-xs text-gray-400 font-normal">외 {memberCount}명</span>
                        )}
                      </div>
                      {/* 사유 */}
                      <p className="text-xs text-gray-500 truncate">{req.reason}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={req.status} />
                      <ChevronRight
                        size={16}
                        className={`text-gray-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      />
                    </div>
                  </div>
                </button>

                {/* 확장 상세 */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-gray-50 space-y-2">
                    <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <span className="text-gray-400 w-16 shrink-0">사유</span>
                        <span className="text-gray-700">{req.reason}</span>
                      </div>
                      {req.rejection_reason && (
                        <div className="flex gap-2">
                          <span className="text-danger-400 w-16 shrink-0">반려 사유</span>
                          <span className="text-danger-600">{req.rejection_reason}</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <span className="text-gray-400 w-16 shrink-0">신청일</span>
                        <span className="text-gray-600 text-xs">
                          {new Date(req.created_at).toLocaleString('ko-KR')}
                        </span>
                      </div>
                      {req.approved_at && (
                        <div className="flex gap-2">
                          <span className="text-gray-400 w-16 shrink-0">승인일</span>
                          <span className="text-gray-600 text-xs">
                            {new Date(req.approved_at).toLocaleString('ko-KR')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

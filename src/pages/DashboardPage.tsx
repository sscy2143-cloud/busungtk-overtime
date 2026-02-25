import { useNavigate } from 'react-router-dom'
import { FilePlus, CalendarPlus, AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { StatusBadge } from '../components/common/StatusBadge'
import type { RequestStatus, OvertimeType } from '../types'
import { OVERTIME_TYPE_LABEL } from '../types'

// ── 목업 데이터 ──────────────────────────────────────────
const MOCK_WEEKLY_HOURS = 38.5
const MOCK_MAX_HOURS = 52
const MOCK_PENDING_APPROVALS = 3

interface MockRequest {
  id: string
  type: OvertimeType
  date: string
  status: RequestStatus
}

const MOCK_REQUESTS: MockRequest[] = [
  { id: '1', type: 'extended', date: '2026-02-24', status: 'approved' },
  { id: '2', type: 'night', date: '2026-02-21', status: 'pending' },
  { id: '3', type: 'holiday', date: '2026-02-17', status: 'rejected' },
]

const MOCK_LEAVE = { total: 15, used: 3, remaining: 12 }
// ────────────────────────────────────────────────────────

// 주간 근무시간 게이지 (인라인 컴포넌트)
function WeeklyGauge({ hours, max }: { hours: number; max: number }) {
  const pct = Math.min((hours / max) * 100, 100)

  // 구간별 색상
  const barColor =
    hours <= 40 ? 'bg-success-500' :
    hours <= 48 ? 'bg-warning-500' :
    hours <= 52 ? 'bg-danger-400' :
    'bg-danger-600'

  const labelColor =
    hours <= 40 ? 'text-success-600' :
    hours <= 48 ? 'text-warning-500' :
    'text-danger-600'

  // 구간 마커 위치 (%)
  const markers = [
    { pct: (40 / max) * 100, label: '40h' },
    { pct: (48 / max) * 100, label: '48h' },
  ]

  return (
    <div>
      <div className="flex items-baseline gap-1 mb-3">
        <span className={`text-4xl font-bold tabular-nums ${labelColor}`}>
          {hours.toFixed(1)}
        </span>
        <span className="text-sm text-gray-400 font-medium">/ {max}시간</span>
      </div>

      {/* 바 */}
      <div className="relative h-3 bg-gray-100 rounded-full overflow-visible">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
        {/* 마커 */}
        {markers.map((m) => (
          <div
            key={m.label}
            className="absolute top-0 bottom-0 w-px bg-gray-300"
            style={{ left: `${m.pct}%` }}
          />
        ))}
      </div>

      {/* 구간 레이블 */}
      <div className="flex justify-between mt-1.5 text-xs text-gray-400">
        <span>0h</span>
        <span>40h</span>
        <span>48h</span>
        <span>{max}h</span>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const isAdmin = employee?.role === 'manager' || employee?.role === 'admin'

  return (
    <div className="space-y-4">
      {/* 인사 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          안녕하세요, <span className="text-primary-600">{employee?.name ?? '사용자'}님</span>
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </div>

      {/* 관리자 승인 대기 배너 */}
      {isAdmin && MOCK_PENDING_APPROVALS > 0 && (
        <div
          className="flex items-center gap-3 bg-warning-50 border border-warning-400 rounded-xl px-4 py-3 cursor-pointer hover:bg-yellow-100 transition-colors"
          onClick={() => navigate('/admin/approvals')}
        >
          <AlertCircle size={18} className="text-warning-500 flex-shrink-0" />
          <span className="text-sm font-medium text-yellow-800">
            승인 대기 중인 신청이 <strong>{MOCK_PENDING_APPROVALS}건</strong> 있습니다
          </span>
          <span className="ml-auto text-xs text-yellow-600">확인 →</span>
        </div>
      )}

      {/* 카드 그리드 (모바일: 1열, md: 2열) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 카드 1: 금주 근무시간 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">금주 근무시간</h2>
          <WeeklyGauge hours={MOCK_WEEKLY_HOURS} max={MOCK_MAX_HOURS} />
          <p className="text-xs text-gray-400 mt-3">
            {MOCK_WEEKLY_HOURS <= 40 && '정상 근무 중입니다.'}
            {MOCK_WEEKLY_HOURS > 40 && MOCK_WEEKLY_HOURS <= 48 && '연장근무 주의 구간입니다.'}
            {MOCK_WEEKLY_HOURS > 48 && MOCK_WEEKLY_HOURS <= 52 && '야간근무 경고 구간입니다.'}
            {MOCK_WEEKLY_HOURS > 52 && '최대 근무시간을 초과했습니다.'}
          </p>
        </div>

        {/* 카드 3: 잔여 휴가 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">잔여 연차</h2>
          <div className="flex items-baseline gap-1 mb-3">
            <span className="text-4xl font-bold text-primary-600 tabular-nums">
              {MOCK_LEAVE.remaining}
            </span>
            <span className="text-sm text-gray-400">/ {MOCK_LEAVE.total}일</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-400 rounded-full"
              style={{ width: `${(MOCK_LEAVE.remaining / MOCK_LEAVE.total) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1.5">
            <span>사용 {MOCK_LEAVE.used}일</span>
            <span>잔여 {MOCK_LEAVE.remaining}일</span>
          </div>
        </div>
      </div>

      {/* 카드 2: 최근 신청 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-500">최근 신청</h2>
          <button
            className="text-xs text-primary-600 hover:underline"
            onClick={() => navigate('/requests')}
          >
            전체 보기 →
          </button>
        </div>

        {MOCK_REQUESTS.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">신청 내역이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {MOCK_REQUESTS.map((req) => (
              <li
                key={req.id}
                className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {OVERTIME_TYPE_LABEL[req.type]}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(req.date).toLocaleDateString('ko-KR', {
                      month: 'long', day: 'numeric', weekday: 'short'
                    })}
                  </p>
                </div>
                <StatusBadge status={req.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 빠른 액션 */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => navigate('/request')}
          className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white font-semibold text-sm py-3.5 rounded-xl transition-colors shadow-sm"
        >
          <FilePlus size={18} />
          야근 신청
        </button>
        <button
          onClick={() => navigate('/leave/request')}
          className="flex items-center justify-center gap-2 bg-white hover:bg-gray-50 active:bg-gray-100 text-primary-600 font-semibold text-sm py-3.5 rounded-xl border border-primary-200 transition-colors shadow-sm"
        >
          <CalendarPlus size={18} />
          휴가 신청
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, AlertTriangle, CalendarOff, ChevronRight } from 'lucide-react'
import { TeamGaugeList } from '../components/admin/TeamGaugeList'
import type { WarningLevel } from '../types'

interface DemoMember {
  name: string
  department: string
  totalHours: number
  warningLevel: WarningLevel
}

const THIS_WEEK: DemoMember[] = [
  { name: '김철수', department: '냉동설비팀', totalHours: 53.5, warningLevel: 'exceeded' },
  { name: '이영희', department: '냉동설비팀', totalHours: 49.0, warningLevel: 'warning' },
  { name: '박민준', department: '시스템팀', totalHours: 44.5, warningLevel: 'caution' },
  { name: '최수진', department: '시스템팀', totalHours: 38.0, warningLevel: 'normal' },
  { name: '정다은', department: '영업팀', totalHours: 40.0, warningLevel: 'normal' },
]

const LAST_WEEK: DemoMember[] = [
  { name: '김철수', department: '냉동설비팀', totalHours: 48.0, warningLevel: 'warning' },
  { name: '이영희', department: '냉동설비팀', totalHours: 45.5, warningLevel: 'caution' },
  { name: '박민준', department: '시스템팀', totalHours: 41.0, warningLevel: 'caution' },
  { name: '최수진', department: '시스템팀', totalHours: 36.5, warningLevel: 'normal' },
  { name: '정다은', department: '영업팀', totalHours: 39.0, warningLevel: 'normal' },
]

export function AdminDashboardPage() {
  const navigate = useNavigate()
  const [week, setWeek] = useState<'this' | 'last'>('this')
  const members = week === 'this' ? THIS_WEEK : LAST_WEEK

  const pendingOvertimeCount = 4
  const approaching52Count = members.filter(
    (m) => m.warningLevel === 'warning' || m.warningLevel === 'exceeded',
  ).length
  const pendingLeaveCount = 2

  return (
    <div className="space-y-6">
      {/* 페이지 제목 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">관리자 대시보드</h1>
        <p className="text-sm text-gray-500 mt-0.5">팀 근태 현황을 한눈에 확인하세요</p>
      </div>

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-3 gap-3">
        {/* 승인 대기 */}
        <button
          onClick={() => navigate('/admin/approvals')}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 bg-warning-50 rounded-xl flex items-center justify-center">
              <Clock className="w-5 h-5 text-warning-500" />
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{pendingOvertimeCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">야근 승인 대기</p>
        </button>

        {/* 52시간 임박 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="w-9 h-9 bg-danger-50 rounded-xl flex items-center justify-center mb-2">
            <AlertTriangle className="w-5 h-5 text-danger-500" />
          </div>
          <p className="text-2xl font-bold text-danger-600">{approaching52Count}</p>
          <p className="text-xs text-gray-500 mt-0.5">52h 임박·초과</p>
        </div>

        {/* 휴가 신청 대기 */}
        <button
          onClick={() => navigate('/admin/leave')}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 bg-primary-50 rounded-xl flex items-center justify-center">
              <CalendarOff className="w-5 h-5 text-primary-600" />
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{pendingLeaveCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">휴가 신청 대기</p>
        </button>
      </div>

      {/* 팀원별 주간 근무시간 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* 헤더 + 주차 토글 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">팀원별 주간 근무시간</h2>
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setWeek('this')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                week === 'this'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              금주
            </button>
            <button
              onClick={() => setWeek('last')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                week === 'last'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              지난주
            </button>
          </div>
        </div>

        {/* 게이지 범례 */}
        <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
          {[
            { color: 'bg-success-500', label: '정상 (~40h)' },
            { color: 'bg-warning-500', label: '주의 (40~48h)' },
            { color: 'bg-orange-400', label: '경고 (48~52h)' },
            { color: 'bg-danger-600', label: '초과 (52h+)' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
          ))}
        </div>

        <TeamGaugeList members={members} />
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, AlertTriangle, CalendarOff, ChevronRight } from 'lucide-react'
import { TeamGaugeList } from '../components/admin/TeamGaugeList'
import { supabase } from '../lib/supabase'
import type { WarningLevel } from '../types'

interface TeamMember {
  name: string
  department: string
  totalHours: number
  warningLevel: WarningLevel
}

function getWeekRange(weekOffset: number): { start: string; end: string } {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 1=Mon...
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + weekOffset * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  }
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return mins / 60
}

function getWarningLevel(hours: number): WarningLevel {
  if (hours > 52) return 'exceeded'
  if (hours > 48) return 'warning'
  if (hours > 40) return 'caution'
  return 'normal'
}

export function AdminDashboardPage() {
  const navigate = useNavigate()
  const [week, setWeek] = useState<'this' | 'last'>('this')
  const [thisWeek, setThisWeek] = useState<TeamMember[]>([])
  const [lastWeek, setLastWeek] = useState<TeamMember[]>([])
  const members = week === 'this' ? thisWeek : lastWeek

  const [pendingOvertimeCount, setPendingOvertimeCount] = useState(0)
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0)

  async function fetchWeeklyData() {
    const thisRange = getWeekRange(0)
    const lastRange = getWeekRange(-1)

    const [thisRes, lastRes] = await Promise.all([
      supabase
        .from('overtime_requests')
        .select('planned_start, planned_end, employee:employees!overtime_requests_employee_id_fkey(name, department)')
        .eq('status', 'approved')
        .gte('date', thisRange.start)
        .lte('date', thisRange.end),
      supabase
        .from('overtime_requests')
        .select('planned_start, planned_end, employee:employees!overtime_requests_employee_id_fkey(name, department)')
        .eq('status', 'approved')
        .gte('date', lastRange.start)
        .lte('date', lastRange.end),
    ])

    function groupByEmployee(data: any[]): TeamMember[] {
      const map = new Map<string, { name: string; department: string; totalHours: number }>()
      for (const row of data) {
        const name = row.employee?.name ?? '알 수 없음'
        const dept = row.employee?.department ?? ''
        const hours = calcHours(row.planned_start, row.planned_end)
        const existing = map.get(name)
        if (existing) {
          existing.totalHours += hours
        } else {
          map.set(name, { name, department: dept, totalHours: hours })
        }
      }
      return Array.from(map.values())
        .map((m) => ({ ...m, warningLevel: getWarningLevel(m.totalHours) }))
        .sort((a, b) => b.totalHours - a.totalHours)
    }

    if (thisRes.data) setThisWeek(groupByEmployee(thisRes.data))
    if (lastRes.data) setLastWeek(groupByEmployee(lastRes.data))
  }

  useEffect(() => {
    async function fetchCounts() {
      const [otRes, leaveRes] = await Promise.all([
        supabase.from('overtime_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      setPendingOvertimeCount(otRes.count ?? 0)
      setPendingLeaveCount(leaveRes.count ?? 0)
    }
    fetchCounts()
    fetchWeeklyData()
  }, [])

  const approaching52Count = members.filter(
    (m) => m.warningLevel === 'warning' || m.warningLevel === 'exceeded',
  ).length

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
        {members.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-gray-400">해당 기간 승인된 야근 데이터가 없습니다</p>
          </div>
        )}
      </div>
    </div>
  )
}

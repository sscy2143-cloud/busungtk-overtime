import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, AlertTriangle, CalendarOff, ChevronRight, ChevronLeft } from 'lucide-react'
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

function getMonthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return mins / 60
}

function getWarningLevel(hours: number): WarningLevel {
  if (hours >= 12) return 'exceeded'   // 법정 주 연장근무 한도 초과
  if (hours >= 10) return 'warning'
  if (hours >= 8) return 'caution'
  return 'normal'
}

export function AdminDashboardPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'this' | 'month'>('this')
  const [thisWeek, setThisWeek] = useState<TeamMember[]>([])
  const [monthData, setMonthData] = useState<TeamMember[]>([])
  const [weeklyBreakdown, setWeeklyBreakdown] = useState<{ label: string; hours: number }[]>([])

  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)

  const members = mode === 'this' ? thisWeek : monthData

  const [pendingOvertimeCount, setPendingOvertimeCount] = useState(0)
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0)

  function groupByEmployee(data: any[], monthly = false): TeamMember[] {
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
      .map((m) => ({ ...m, warningLevel: monthly ? 'normal' as const : getWarningLevel(m.totalHours) }))
      .sort((a, b) => b.totalHours - a.totalHours)
  }

  async function fetchWeeklyData() {
    const thisRange = getWeekRange(0)
    const { data } = await supabase
      .from('overtime_requests')
      .select('planned_start, planned_end, employee:employees!overtime_requests_employee_id_fkey(name, department)')
      .eq('status', 'approved')
      .gte('date', thisRange.start)
      .lte('date', thisRange.end)
    if (data) setThisWeek(groupByEmployee(data))
  }

  async function fetchMonthData(year: number, month: number) {
    const range = getMonthRange(year, month)
    const { data } = await supabase
      .from('overtime_requests')
      .select('date, planned_start, planned_end, employee:employees!overtime_requests_employee_id_fkey(name, department)')
      .eq('status', 'approved')
      .gte('date', range.start)
      .lte('date', range.end)
    if (data) {
      setMonthData(groupByEmployee(data, true))

      // 주차별 합계 (1일~7일=1주차, 8~14=2주차, ...)
      const weekMap = new Map<number, number>()
      for (const row of data) {
        const day = parseInt(row.date.split('-')[2], 10)
        const week = Math.ceil(day / 7)
        const hours = calcHours(row.planned_start, row.planned_end)
        weekMap.set(week, (weekMap.get(week) ?? 0) + hours)
      }
      const lastDay = new Date(year, month, 0).getDate()
      const totalWeeks = Math.ceil(lastDay / 7)
      const breakdown = Array.from({ length: totalWeeks }, (_, i) => ({
        label: `${i + 1}주차`,
        hours: weekMap.get(i + 1) ?? 0,
      }))
      setWeeklyBreakdown(breakdown)
    }
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

  useEffect(() => {
    if (mode === 'month') fetchMonthData(selectedYear, selectedMonth)
  }, [mode, selectedYear, selectedMonth])

  function prevMonth() {
    if (selectedMonth === 1) { setSelectedYear(y => y - 1); setSelectedMonth(12) }
    else setSelectedMonth(m => m - 1)
  }
  function nextMonth() {
    const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1
    if (isCurrentMonth) return
    if (selectedMonth === 12) { setSelectedYear(y => y + 1); setSelectedMonth(1) }
    else setSelectedMonth(m => m + 1)
  }

  const approaching52Count = thisWeek.filter(
    (m) => m.warningLevel === 'warning' || m.warningLevel === 'exceeded',
  ).length

  return (
    <div className="space-y-6">
      {/* 페이지 제목 */}
      <div>
        <h1 className="text-xl font-bold text-dark-900">관리자 대시보드</h1>
        <p className="text-sm text-dark-500 mt-0.5">팀 근태 현황을 한눈에 확인하세요</p>
      </div>

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-3 gap-3">
        {/* 승인 대기 */}
        <button
          onClick={() => navigate('/admin/approvals')}
          className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-left hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 bg-warning-50 rounded-xl flex items-center justify-center">
              <Clock className="w-5 h-5 text-warning-500" />
            </div>
            <ChevronRight className="w-4 h-4 text-dark-300" />
          </div>
          <p className="text-2xl font-bold text-dark-900">{pendingOvertimeCount}</p>
          <p className="text-xs text-dark-500 mt-0.5">야근 승인 대기</p>
        </button>

        {/* 52시간 임박 */}
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
          <div className="w-9 h-9 bg-danger-50 rounded-xl flex items-center justify-center mb-2">
            <AlertTriangle className="w-5 h-5 text-danger-500" />
          </div>
          <p className="text-2xl font-bold text-danger-600">{approaching52Count}</p>
          <p className="text-xs text-dark-500 mt-0.5">52h 임박·초과</p>
        </div>

        {/* 휴가 신청 대기 */}
        <button
          onClick={() => navigate('/admin/leave')}
          className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-left hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 bg-primary-50 rounded-xl flex items-center justify-center">
              <CalendarOff className="w-5 h-5 text-primary-600" />
            </div>
            <ChevronRight className="w-4 h-4 text-dark-300" />
          </div>
          <p className="text-2xl font-bold text-dark-900">{pendingLeaveCount}</p>
          <p className="text-xs text-dark-500 mt-0.5">휴가 신청 대기</p>
        </button>
      </div>

      {/* 팀원별 근무시간 */}
      <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        {/* 헤더 + 탭 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-100">
          <h2 className="text-sm font-semibold text-dark-900">
            {mode === 'month' ? '팀원별 월간 연장근무' : '팀원별 금주 연장근무'}
          </h2>
          <div className="flex bg-dark-100 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setMode('this')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === 'this' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
              }`}
            >
              금주
            </button>
            <button
              onClick={() => setMode('month')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === 'month' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
              }`}
            >
              월별
            </button>
          </div>
        </div>

        {/* 월 선택 네비게이션 (월별 모드일 때만) */}
        {mode === 'month' && (
          <div className="flex items-center justify-center gap-4 px-4 py-2 bg-dark-50 border-b border-dark-100">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-dark-200 transition-colors">
              <ChevronLeft className="w-4 h-4 text-dark-600" />
            </button>
            <span className="text-sm font-medium text-dark-700 min-w-[90px] text-center">
              {selectedYear}년 {selectedMonth}월
            </span>
            <button
              onClick={nextMonth}
              disabled={selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1}
              className="p-1 rounded hover:bg-dark-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4 text-dark-600" />
            </button>
          </div>
        )}

        {/* 게이지 범례 (주간 모드만) */}
        {mode !== 'month' && (
          <div className="flex items-center gap-3 px-4 py-2 bg-dark-50 border-b border-dark-100">
            {[
              { color: 'bg-success-500', label: '정상 (~8h)' },
              { color: 'bg-warning-500', label: '주의 (8~10h)' },
              { color: 'bg-primary-400', label: '경고 (10~12h)' },
              { color: 'bg-danger-600', label: '초과 (12h+)' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                <span className="text-xs text-dark-500">{label}</span>
              </div>
            ))}
          </div>
        )}

        <TeamGaugeList members={members} />
        {members.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-dark-400">해당 기간 승인된 야근 데이터가 없습니다</p>
          </div>
        )}

        {/* 주차별 시간 분포 (월별 모드만) */}
        {mode === 'month' && weeklyBreakdown.length > 0 && (
          <div className="px-4 py-4 border-t border-dark-100">
            <p className="text-xs font-semibold text-dark-500 mb-3">주차별 야근 합계</p>
            <div className="space-y-2">
              {weeklyBreakdown.map(({ label, hours }) => {
                const maxHours = Math.max(...weeklyBreakdown.map((w) => w.hours), 1)
                const pct = (hours / maxHours) * 100
                return (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-xs text-dark-500 w-10 shrink-0">{label}</span>
                    <div className="flex-1 bg-dark-100 rounded-full h-2">
                      <div
                        className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-dark-700 w-12 text-right shrink-0">
                      {hours.toFixed(1)}h
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

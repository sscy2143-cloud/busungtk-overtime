import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock, CheckSquare, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { StatusBadge } from '../components/common/StatusBadge'
import { calculateOvertimeBreakdown } from '../utils/overtime-calc'
import type { OvertimeRequest } from '../types'
import { OVERTIME_TYPE_LABEL } from '../types'

function getWeekRange() {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: monday.toISOString().split('T')[0], end: sunday.toISOString().split('T')[0] }
}

function fmtH(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0 && m === 0) return '-'
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const TYPE_COLOR: Record<string, string> = {
  extended: 'bg-blue-100 text-blue-700',
  night: 'bg-indigo-100 text-indigo-700',
  holiday: 'bg-orange-100 text-orange-700',
}

export function AdminOvertimeDashboardPage() {
  const navigate = useNavigate()
  const { employee } = useAuth()
  const isAdmin = employee?.role === 'admin'

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)

  const [allRequests, setAllRequests] = useState<(OvertimeRequest & { employee: any })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('overtime_requests')
      .select('*, employee:employees!overtime_requests_employee_id_fkey(id, name, department)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setAllRequests(data as any)
        setLoading(false)
      })
  }, [])

  // ── 이번주 승인 데이터 ──────────────────────────────
  const weekRange = getWeekRange()
  const weeklyApproved = allRequests.filter(
    r => r.status === 'approved' && r.date >= weekRange.start && r.date <= weekRange.end
  )

  // 직원별 이번주 누적시간
  const weeklyByEmployee = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of weeklyApproved) {
      const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
      const prev = map.get(r.employee_id) ?? 0
      map.set(r.employee_id, prev + bd.totalMinutes)
    }
    return map
  }, [weeklyApproved])

  const totalWeeklyHours = Array.from(weeklyByEmployee.values()).reduce((s, m) => s + m, 0) / 60
  const danger52Count = Array.from(weeklyByEmployee.values()).filter(m => m >= 48 * 60).length

  // 대기중
  const pending = allRequests.filter(r => r.status === 'pending')

  // 이번달 승인 건수
  const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const thisMonthApproved = allRequests.filter(r => r.status === 'approved' && r.date.startsWith(thisMonthPrefix)).length

  // ── 월별 직원별 분류표 ──────────────────────────────
  const monthPrefix = `${calYear}-${String(calMonth).padStart(2, '0')}`
  const monthApproved = allRequests.filter(r => r.status === 'approved' && r.date.startsWith(monthPrefix))

  const monthlyTable = useMemo(() => {
    const map = new Map<string, {
      empId: string; name: string; department: string
      extended: number; night: number
      holiday: number; holidayNight: number; total: number
    }>()
    for (const r of monthApproved) {
      const empId = r.employee_id
      const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
      const existing = map.get(empId)
      const holidayNight = bd.holidayNightMinutes + bd.holidayOvertimeNightMinutes
      if (existing) {
        existing.extended += bd.extendedMinutes
        existing.night += bd.nightMinutes
        existing.holiday += bd.holidayMinutes + bd.holidayOvertimeMinutes
        existing.holidayNight += holidayNight
        existing.total += bd.totalMinutes
      } else {
        map.set(empId, {
          empId,
          name: r.employee?.name ?? '알 수 없음',
          department: r.employee?.department ?? '',
          extended: bd.extendedMinutes,
          night: bd.nightMinutes,
          holiday: bd.holidayMinutes + bd.holidayOvertimeMinutes,
          holidayNight,
          total: bd.totalMinutes,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [monthApproved])

  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calYear === now.getFullYear() && calMonth === now.getMonth() + 1) return
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1) }
    else setCalMonth(m => m + 1)
  }

  async function handleQuickApprove(id: string) {
    await supabase
      .from('overtime_requests')
      .update({ status: 'approved', approved_by: employee?.id, approved_at: new Date().toISOString() })
      .eq('id', id)
    setAllRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r))
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-gray-400">불러오는 중...</p></div>

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">야근 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">팀 연장근무 현황을 한눈에 파악하세요</p>
        </div>
        <button
          onClick={() => navigate('/admin/approvals')}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors"
        >
          <CheckSquare className="w-4 h-4" />
          승인 관리
        </button>
      </div>

      {/* 상단 2칸: KPI 카드 + 대기 목록 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 좌: HR 주요 지표 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">이번주 현황</h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-warning-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-warning-500" />
                <span className="text-xs text-warning-600 font-medium">승인 대기</span>
              </div>
              <p className="text-2xl font-bold text-warning-700">{pending.length}<span className="text-sm ml-1">건</span></p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-blue-600 font-medium">이번주 연장</span>
              </div>
              <p className="text-2xl font-bold text-blue-700">{totalWeeklyHours.toFixed(1)}<span className="text-sm ml-1">h</span></p>
            </div>
            <div className={`rounded-xl p-3 ${danger52Count > 0 ? 'bg-danger-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className={`w-4 h-4 ${danger52Count > 0 ? 'text-danger-500' : 'text-gray-400'}`} />
                <span className={`text-xs font-medium ${danger52Count > 0 ? 'text-danger-600' : 'text-gray-500'}`}>48h 이상</span>
              </div>
              <p className={`text-2xl font-bold ${danger52Count > 0 ? 'text-danger-700' : 'text-gray-400'}`}>
                {danger52Count}<span className="text-sm ml-1">명</span>
              </p>
            </div>
            <div className="bg-success-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <CheckSquare className="w-4 h-4 text-success-500" />
                <span className="text-xs text-success-600 font-medium">이번달 승인</span>
              </div>
              <p className="text-2xl font-bold text-success-700">{thisMonthApproved}<span className="text-sm ml-1">건</span></p>
            </div>
          </div>

          {/* 48h 이상 직원 목록 */}
          {danger52Count > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-danger-600 mb-2">⚠ 48h 이상 직원</p>
              <div className="space-y-1">
                {Array.from(weeklyByEmployee.entries())
                  .filter(([, m]) => m >= 48 * 60)
                  .map(([empId, minutes]) => {
                    const req = weeklyApproved.find(r => r.employee_id === empId)
                    const name = req?.employee?.name ?? empId
                    return (
                      <div key={empId} className="flex items-center justify-between text-xs bg-danger-50 rounded-lg px-3 py-1.5">
                        <span className="text-gray-700 font-medium">{name}</span>
                        <span className={`font-bold ${minutes >= 52 * 60 ? 'text-danger-700' : 'text-warning-600'}`}>
                          {(minutes / 60).toFixed(1)}h
                          {minutes >= 52 * 60 && <span className="ml-1 text-danger-600">초과</span>}
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}
        </div>

        {/* 우: 승인 대기 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold text-gray-900">승인 대기중</h2>
            <button onClick={() => navigate('/admin/approvals')} className="text-xs text-primary-600 hover:underline">
              전체 보기
            </button>
          </div>
          {pending.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10">
              <p className="text-sm text-gray-400">대기중인 건이 없습니다</p>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 max-h-[320px] divide-y divide-gray-50">
              {pending.map(req => (
                <div key={req.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-gray-800">{req.employee?.name ?? '-'}</span>
                      <span className="text-xs text-gray-400">{req.employee?.department}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">{req.date}</span>
                      <span className="text-xs text-gray-500">{req.planned_start}~{req.planned_end}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                        {OVERTIME_TYPE_LABEL[req.type]}
                      </span>
                    </div>
                    {req.site_name && <p className="text-xs text-gray-400 truncate mt-0.5">{req.site_name}</p>}
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => handleQuickApprove(req.id)}
                      className="shrink-0 px-3 py-1.5 text-xs font-semibold text-white bg-success-500 rounded-lg hover:bg-success-600 transition-colors"
                    >
                      승인
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 월별 직원별 분류표 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">직원별 월간 연장근무 분류</h2>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100">
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[80px] text-center">
              {calYear}년 {calMonth}월
            </span>
            <button
              onClick={nextMonth}
              disabled={calYear === now.getFullYear() && calMonth === now.getMonth() + 1}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {monthlyTable.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-400">해당 월 승인된 야근 데이터가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">직원</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">부서</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-blue-600">연장근무</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-indigo-600">야간근무</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-orange-600">휴일근로</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-red-600">휴일+야간</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {monthlyTable.map((row, i) => (
                  <tr
                    key={i}
                    className="hover:bg-primary-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/admin/approvals?employee=${row.empId}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">{row.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{row.department}</td>
                    <td className="px-4 py-3 text-right text-blue-600 font-medium">{fmtH(row.extended)}</td>
                    <td className="px-4 py-3 text-right text-indigo-600 font-medium">{fmtH(row.night)}</td>
                    <td className="px-4 py-3 text-right text-orange-600 font-medium">{fmtH(row.holiday)}</td>
                    <td className="px-4 py-3 text-right text-red-600 font-medium">{fmtH(row.holidayNight)}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800">{fmtH(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-700" colSpan={2}>합계</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-600">
                    {fmtH(monthlyTable.reduce((s, r) => s + r.extended, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-indigo-600">
                    {fmtH(monthlyTable.reduce((s, r) => s + r.night, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-orange-600">
                    {fmtH(monthlyTable.reduce((s, r) => s + r.holiday, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-red-600">
                    {fmtH(monthlyTable.reduce((s, r) => s + r.holidayNight, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-800">
                    {fmtH(monthlyTable.reduce((s, r) => s + r.total, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

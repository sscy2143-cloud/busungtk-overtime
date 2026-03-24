import { useState, useEffect, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock, CheckSquare, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
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
  extended: 'bg-primary-100 text-primary-700',
  night: 'bg-dark-100 text-dark-700',
  holiday: 'bg-primary-100 text-primary-700',
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
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null)

  function monthBadge(totalMinutes: number) {
    if (totalMinutes >= 48 * 60) return { label: '초과', cls: 'bg-danger-100 text-danger-700 border border-danger-200' }
    if (totalMinutes >= 32 * 60) return { label: '위험', cls: 'bg-warning-100 text-warning-700 border border-warning-200' }
    return { label: '양호', cls: 'bg-success-100 text-success-700 border border-success-200' }
  }

  function weekBadge(totalMinutes: number) {
    if (totalMinutes >= 12 * 60) return { label: '초과', cls: 'bg-danger-100 text-danger-700 border border-danger-200' }
    if (totalMinutes >= 10 * 60) return { label: '위험', cls: 'bg-warning-100 text-warning-700 border border-warning-200' }
    if (totalMinutes >= 8 * 60) return { label: '주의', cls: 'bg-primary-50 text-primary-700 border border-primary-100' }
    return { label: '양호', cls: 'bg-success-100 text-success-700 border border-success-200' }
  }

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

  const weeklyByEmployee = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of weeklyApproved) {
      const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
      map.set(r.employee_id, (map.get(r.employee_id) ?? 0) + bd.totalMinutes)
    }
    return map
  }, [weeklyApproved])

  const totalWeeklyHours = Array.from(weeklyByEmployee.values()).reduce((s, m) => s + m, 0) / 60
  const danger12Count = Array.from(weeklyByEmployee.values()).filter(m => m >= 12 * 60).length

  const pending = allRequests.filter(r => r.status === 'pending')

  const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const thisMonthApproved = allRequests.filter(r => r.status === 'approved' && r.date.startsWith(thisMonthPrefix)).length

  // ── 월별 직원별 분류표 ──────────────────────────────
  const monthPrefix = `${calYear}-${String(calMonth).padStart(2, '0')}`
  const monthApproved = allRequests.filter(r => r.status === 'approved' && r.date.startsWith(monthPrefix))

  const monthlyTable = useMemo(() => {
    type WeekDetail = { week: number; extended: number; night: number; holiday: number; holidayNight: number; total: number }
    const map = new Map<string, {
      empId: string; name: string; department: string
      extended: number; night: number
      holiday: number; holidayNight: number; total: number
      weeks: Map<number, WeekDetail>
    }>()
    for (const r of monthApproved) {
      const empId = r.employee_id
      const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
      const holidayNight = bd.holidayNightMinutes + bd.holidayOvertimeNightMinutes
      const dayNum = parseInt(r.date.split('-')[2], 10)
      const week = Math.ceil(dayNum / 7)
      let entry = map.get(empId)
      if (!entry) {
        entry = {
          empId,
          name: r.employee?.name ?? '알 수 없음',
          department: r.employee?.department ?? '',
          extended: 0, night: 0, holiday: 0, holidayNight: 0, total: 0,
          weeks: new Map(),
        }
        map.set(empId, entry)
      }
      entry.extended += bd.extendedMinutes
      entry.night += bd.nightMinutes
      entry.holiday += bd.holidayMinutes + bd.holidayOvertimeMinutes
      entry.holidayNight += holidayNight
      entry.total += bd.totalMinutes
      let wk = entry.weeks.get(week)
      if (!wk) {
        wk = { week, extended: 0, night: 0, holiday: 0, holidayNight: 0, total: 0 }
        entry.weeks.set(week, wk)
      }
      wk.extended += bd.extendedMinutes
      wk.night += bd.nightMinutes
      wk.holiday += bd.holidayMinutes + bd.holidayOvertimeMinutes
      wk.holidayNight += holidayNight
      wk.total += bd.totalMinutes
    }
    return Array.from(map.values())
      .map(e => ({ ...e, weeklyDetails: Array.from(e.weeks.values()).sort((a, b) => a.week - b.week) }))
      .sort((a, b) => b.total - a.total)
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

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-dark-400">불러오는 중...</p></div>

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark-900">야근 관리</h1>
          <p className="text-sm text-dark-500 mt-0.5">팀 연장근무 현황을 한눈에 파악하세요</p>
        </div>
        <button
          onClick={() => navigate('/admin/approvals')}
          className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white text-sm font-semibold rounded-xl hover:bg-primary-600 transition-colors"
        >
          <CheckSquare className="w-4 h-4" />
          승인 관리
        </button>
      </div>

      {/* 상단 2칸: KPI 카드 + 대기 목록 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 좌: KPI */}
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-dark-700">이번주 현황</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-warning-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-warning-500" />
                <span className="text-xs text-warning-600 font-medium">승인 대기</span>
              </div>
              <p className="text-2xl font-bold text-warning-700">{pending.length}<span className="text-sm ml-1">건</span></p>
            </div>
            <div className="bg-primary-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-primary-500" />
                <span className="text-xs text-primary-600 font-medium">이번주 연장</span>
              </div>
              <p className="text-2xl font-bold text-primary-700">{totalWeeklyHours.toFixed(1)}<span className="text-sm ml-1">h</span></p>
            </div>
            <div className={`rounded-xl p-3 ${danger12Count > 0 ? 'bg-danger-50' : 'bg-dark-50'}`}>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className={`w-4 h-4 ${danger12Count > 0 ? 'text-danger-500' : 'text-dark-400'}`} />
                <span className={`text-xs font-medium ${danger12Count > 0 ? 'text-danger-600' : 'text-dark-500'}`}>주 12h 초과</span>
              </div>
              <p className={`text-2xl font-bold ${danger12Count > 0 ? 'text-danger-700' : 'text-dark-400'}`}>
                {danger12Count}<span className="text-sm ml-1">명</span>
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
          {danger12Count > 0 && (
            <div className="border-t border-dark-100 pt-3">
              <p className="text-xs font-semibold text-danger-600 mb-2">⚠ 주 12h 초과 직원</p>
              <div className="space-y-1">
                {Array.from(weeklyByEmployee.entries())
                  .filter(([, m]) => m >= 12 * 60)
                  .map(([empId, minutes]) => {
                    const req = weeklyApproved.find(r => r.employee_id === empId)
                    const name = req?.employee?.name ?? empId
                    return (
                      <div key={empId} className="flex items-center justify-between text-xs bg-danger-50 rounded-lg px-3 py-1.5">
                        <span className="text-dark-700 font-medium">{name}</span>
                        <span className="font-bold text-danger-700">{(minutes / 60).toFixed(1)}h</span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}
        </div>

        {/* 우: 승인 대기 목록 */}
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-dark-100 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold text-dark-900">승인 대기중</h2>
            <button onClick={() => navigate('/admin/approvals')} className="text-xs text-primary-600 hover:underline">
              전체 보기
            </button>
          </div>
          {pending.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10">
              <p className="text-sm text-dark-400">대기중인 건이 없습니다</p>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 max-h-[320px] divide-y divide-dark-50">
              {pending.map(req => (
                <div key={req.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-dark-800">{req.employee?.name ?? '-'}</span>
                      <span className="text-xs text-dark-400">{req.employee?.department}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-dark-500">{req.date}</span>
                      <span className="text-xs text-dark-500">{req.planned_start}~{req.planned_end}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                        {OVERTIME_TYPE_LABEL[req.type]}
                      </span>
                    </div>
                    {req.site_name && <p className="text-xs text-dark-400 truncate mt-0.5">{req.site_name}</p>}
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
      <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-dark-900">직원별 월간 연장근무 분류</h2>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-dark-100">
              <ChevronLeft className="w-4 h-4 text-dark-500" />
            </button>
            <span className="text-sm font-medium text-dark-700 min-w-[80px] text-center">
              {calYear}년 {calMonth}월
            </span>
            <button
              onClick={nextMonth}
              disabled={calYear === now.getFullYear() && calMonth === now.getMonth() + 1}
              className="p-1 rounded hover:bg-dark-100 disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4 text-dark-500" />
            </button>
          </div>
        </div>

        {/* 기준 레전드 */}
        <div className="px-4 py-2 bg-dark-50 border-b border-dark-100 flex items-center gap-2 flex-wrap text-xs text-dark-500">
          <span className="font-medium text-dark-600">초과여부 기준 (월간):</span>
          <span className="px-2 py-0.5 rounded-full bg-success-100 text-success-700 border border-success-200">양호 ~32h</span>
          <span className="px-2 py-0.5 rounded-full bg-warning-100 text-warning-700 border border-warning-200">위험 32~48h</span>
          <span className="px-2 py-0.5 rounded-full bg-danger-100 text-danger-700 border border-danger-200">초과 48h+</span>
          <span className="text-dark-400 ml-1">(주 8/12h 기준)</span>
        </div>

        {monthlyTable.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-dark-400">해당 월 승인된 야근 데이터가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-100 bg-dark-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">직원</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">부서</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-primary-600 whitespace-nowrap">연장근무</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-dark-700 whitespace-nowrap">야간근무</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-primary-600 whitespace-nowrap">휴일근로</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-primary-600 whitespace-nowrap">휴일+야간</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-dark-600 whitespace-nowrap">초과여부</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-dark-700 whitespace-nowrap">합계</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-dark-500 whitespace-nowrap">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-50">
                {monthlyTable.map((row) => {
                  const badge = monthBadge(row.total)
                  const isExpanded = expandedEmpId === row.empId
                  return (
                    <Fragment key={row.empId}>
                      <tr
                        className="hover:bg-primary-50 cursor-pointer transition-colors"
                        onClick={() => navigate(`/admin/approvals?employee=${row.empId}`)}
                      >
                        <td className="px-4 py-3 font-medium text-dark-800">{row.name}</td>
                        <td className="px-4 py-3 text-dark-500 text-xs">{row.department}</td>
                        <td className="px-4 py-3 text-right text-primary-600 font-medium">{fmtH(row.extended)}</td>
                        <td className="px-4 py-3 text-right text-dark-700 font-medium">{fmtH(row.night)}</td>
                        <td className="px-4 py-3 text-right text-primary-600 font-medium">{fmtH(row.holiday)}</td>
                        <td className="px-4 py-3 text-right text-primary-600 font-medium">{fmtH(row.holidayNight)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-dark-800">{fmtH(row.total)}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedEmpId(isExpanded ? null : row.empId) }}
                            className="text-xs text-primary-600 font-semibold hover:underline whitespace-nowrap"
                          >
                            상세 {isExpanded ? '∧' : '∨'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && row.weeklyDetails.map((w) => {
                        const wb = weekBadge(w.total)
                        return (
                          <tr key={w.week} className="bg-primary-50/40">
                            <td className="pl-6 pr-4 py-2 text-xs text-dark-500 font-medium">{w.week}주차</td>
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2 text-right text-xs text-primary-500">{fmtH(w.extended)}</td>
                            <td className="px-4 py-2 text-right text-xs text-dark-600">{fmtH(w.night)}</td>
                            <td className="px-4 py-2 text-right text-xs text-primary-500">{fmtH(w.holiday)}</td>
                            <td className="px-4 py-2 text-right text-xs text-primary-500">{fmtH(w.holidayNight)}</td>
                            <td className="px-4 py-2 text-center">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${wb.cls}`}>{wb.label}</span>
                            </td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-dark-700">{fmtH(w.total)}</td>
                            <td />
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-dark-200 bg-dark-50">
                  <td className="px-4 py-3 font-semibold text-dark-700" colSpan={2}>합계</td>
                  <td className="px-4 py-3 text-right font-bold text-primary-600">{fmtH(monthlyTable.reduce((s, r) => s + r.extended, 0))}</td>
                  <td className="px-4 py-3 text-right font-bold text-dark-700">{fmtH(monthlyTable.reduce((s, r) => s + r.night, 0))}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary-600">{fmtH(monthlyTable.reduce((s, r) => s + r.holiday, 0))}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary-600">{fmtH(monthlyTable.reduce((s, r) => s + r.holidayNight, 0))}</td>
                  <td />
                  <td className="px-4 py-3 text-right font-bold text-dark-800">{fmtH(monthlyTable.reduce((s, r) => s + r.total, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

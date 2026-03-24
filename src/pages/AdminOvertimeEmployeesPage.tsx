import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LayoutGrid, CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { calculateOvertimeBreakdown } from '../utils/overtime-calc'
import type { OvertimeRequest } from '../types'

function fmtH(minutes: number) {
  if (minutes === 0) return '-'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function fmtHCompact(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `+${h}h`
  return `+${h}h${m}m`
}

const EMPLOYEE_COLORS = [
  'bg-primary-100 text-primary-700',
  'bg-purple-100 text-purple-700',
  'bg-dark-100 text-dark-700',
  'bg-primary-100 text-primary-700',
  'bg-pink-100 text-pink-700',
  'bg-primary-50 text-dark-700',
  'bg-dark-100 text-dark-700',
  'bg-primary-100 text-primary-700',
]

const DOW_LABELS = ['월', '화', '수', '목', '금', '토', '일']

function buildCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const startDow = firstDay.getDay() // 0=Sun
  const startOffset = startDow === 0 ? 6 : startDow - 1

  const days: Array<{ dateStr: string | null; day: number; dow: number }> = []

  for (let i = 0; i < startOffset; i++) {
    days.push({ dateStr: null, day: 0, dow: i })
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dow = new Date(year, month - 1, d).getDay()
    days.push({ dateStr, day: d, dow })
  }
  while (days.length % 7 !== 0) {
    days.push({ dateStr: null, day: 0, dow: days.length % 7 })
  }
  return days
}

export function AdminOvertimeEmployeesPage() {
  const navigate = useNavigate()
  const now = new Date()
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table')
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [allRequests, setAllRequests] = useState<(OvertimeRequest & { employee: any })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('overtime_requests')
      .select('*, employee:employees!overtime_requests_employee_id_fkey(id, name, department)')
      .eq('status', 'approved')
      .gte('date', `${selectedYear}-01-01`)
      .lte('date', `${selectedYear}-12-31`)
      .then(({ data }) => {
        if (data) setAllRequests(data as any)
        setLoading(false)
      })
  }, [selectedYear])

  // ── 테이블 뷰 데이터 ─────────────────────────────
  const tableData = useMemo(() => {
    const map = new Map<string, { empId: string; name: string; department: string; months: number[] }>()
    for (const r of allRequests) {
      const empId = r.employee_id
      const month = parseInt(r.date.split('-')[1], 10)
      const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
      let entry = map.get(empId)
      if (!entry) {
        entry = {
          empId,
          name: r.employee?.name ?? '알 수 없음',
          department: r.employee?.department ?? '',
          months: Array(12).fill(0),
        }
        map.set(empId, entry)
      }
      entry.months[month - 1] += bd.totalMinutes
    }
    return Array.from(map.values()).sort((a, b) => {
      return b.months.reduce((s, v) => s + v, 0) - a.months.reduce((s, v) => s + v, 0)
    })
  }, [allRequests])

  // 직원별 고정 색상 인덱스
  const empColorMap = useMemo(() => {
    const map = new Map<string, number>()
    tableData.forEach((row, i) => map.set(row.empId, i % EMPLOYEE_COLORS.length))
    return map
  }, [tableData])

  // ── 캘린더 뷰 데이터 ─────────────────────────────
  const calendarData = useMemo(() => {
    const monthStr = `${selectedYear}-${String(calMonth).padStart(2, '0')}`
    const map = new Map<string, Array<{ empId: string; name: string; minutes: number }>>()
    for (const r of allRequests) {
      if (!r.date.startsWith(monthStr)) continue
      const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
      if (bd.totalMinutes === 0) continue
      const entries = map.get(r.date) ?? []
      entries.push({
        empId: r.employee_id,
        name: r.employee?.name ?? '?',
        minutes: bd.totalMinutes,
      })
      map.set(r.date, entries)
    }
    return map
  }, [allRequests, selectedYear, calMonth])

  const calendarDays = useMemo(() => buildCalendarDays(selectedYear, calMonth), [selectedYear, calMonth])

  const todayStr = now.toISOString().split('T')[0]
  const currentMonth = now.getMonth()

  function prevCalMonth() {
    if (calMonth === 1) { setSelectedYear(y => y - 1); setCalMonth(12) }
    else setCalMonth(m => m - 1)
  }
  function nextCalMonth() {
    if (calMonth === 12) { setSelectedYear(y => y + 1); setCalMonth(1) }
    else setCalMonth(m => m + 1)
  }

  const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <p className="text-sm text-dark-400">불러오는 중...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-dark-900">직원별 연장근무현황</h1>
        <p className="text-sm text-dark-500 mt-0.5">연장근무 현황을 테이블 또는 캘린더로 확인하세요</p>
      </div>

      {/* 상단 컨트롤 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* 뷰 토글 */}
        <div className="flex bg-dark-100 rounded-xl p-1 gap-1">
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              viewMode === 'table' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
            }`}
          >
            <LayoutGrid size={14} />
            테이블
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              viewMode === 'calendar' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
            }`}
          >
            <CalendarDays size={14} />
            캘린더
          </button>
        </div>

        {/* 네비게이션 */}
        {viewMode === 'table' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedYear(y => y - 1)}
              className="p-1.5 rounded-lg hover:bg-dark-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-dark-600" />
            </button>
            <span className="text-sm font-semibold text-dark-700 min-w-[60px] text-center">{selectedYear}년</span>
            <button
              onClick={() => setSelectedYear(y => y + 1)}
              disabled={selectedYear >= now.getFullYear()}
              className="p-1.5 rounded-lg hover:bg-dark-100 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-dark-600" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={prevCalMonth} className="p-1.5 rounded-lg hover:bg-dark-100 transition-colors">
              <ChevronLeft className="w-4 h-4 text-dark-600" />
            </button>
            <span className="text-sm font-semibold text-dark-700 min-w-[80px] text-center">
              {selectedYear}년 {calMonth}월
            </span>
            <button onClick={nextCalMonth} className="p-1.5 rounded-lg hover:bg-dark-100 transition-colors">
              <ChevronRight className="w-4 h-4 text-dark-600" />
            </button>
          </div>
        )}
      </div>

      {/* ── 테이블 뷰 ── */}
      {viewMode === 'table' && (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          {tableData.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-dark-400">해당 연도 승인된 야근 데이터가 없습니다</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dark-100 bg-dark-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500 whitespace-nowrap sticky left-0 bg-dark-50">직원</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400 whitespace-nowrap">부서</th>
                    {MONTHS.map((m, i) => (
                      <th
                        key={i}
                        className={`px-2 py-3 text-center text-xs font-semibold whitespace-nowrap ${
                          selectedYear === now.getFullYear() && i === currentMonth
                            ? 'text-primary-600 bg-primary-50'
                            : 'text-dark-500'
                        }`}
                      >
                        {m}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-700 whitespace-nowrap">연간합계</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-50">
                  {tableData.map((row) => {
                    const total = row.months.reduce((s, v) => s + v, 0)
                    return (
                      <tr key={row.empId} className="hover:bg-dark-50 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-dark-800 whitespace-nowrap sticky left-0 bg-white">{row.name}</td>
                        <td className="px-3 py-3 text-xs text-dark-400 whitespace-nowrap">{row.department}</td>
                        {row.months.map((minutes, i) => (
                          <td
                            key={i}
                            className={`px-2 py-3 text-center text-xs whitespace-nowrap cursor-pointer transition-colors ${
                              minutes === 0
                                ? 'text-dark-200'
                                : 'text-dark-700 font-medium hover:text-primary-700 hover:bg-primary-50'
                            } ${
                              selectedYear === now.getFullYear() && i === currentMonth
                                ? 'bg-primary-50/40'
                                : ''
                            }`}
                            onClick={() => {
                              if (minutes === 0) return
                              const monthStr = String(i + 1).padStart(2, '0')
                              navigate(`/admin/overtime?month=${selectedYear}-${monthStr}&emp=${row.empId}`)
                            }}
                          >
                            {fmtH(minutes)}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right text-xs font-bold text-dark-800 whitespace-nowrap">{fmtH(total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-dark-200 bg-dark-50">
                    <td className="px-4 py-3 text-xs font-semibold text-dark-700 sticky left-0 bg-dark-50" colSpan={2}>팀 합계</td>
                    {Array.from({ length: 12 }, (_, i) => {
                      const total = tableData.reduce((s, r) => s + r.months[i], 0)
                      return (
                        <td key={i} className={`px-2 py-3 text-center text-xs font-bold ${
                          selectedYear === now.getFullYear() && i === currentMonth ? 'bg-primary-50/40' : ''
                        } ${total > 0 ? 'text-dark-700' : 'text-dark-200'}`}>
                          {fmtH(total)}
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-right text-xs font-bold text-dark-800">
                      {fmtH(tableData.reduce((s, r) => s + r.months.reduce((ss, v) => ss + v, 0), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 캘린더 뷰 ── */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-dark-100">
            {DOW_LABELS.map((d, i) => (
              <div
                key={d}
                className={`py-2 text-center text-xs font-semibold ${
                  i === 5 ? 'text-primary-500' : i === 6 ? 'text-primary-500' : 'text-dark-500'
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7">
            {calendarDays.map((cell, idx) => {
              const entries = cell.dateStr ? (calendarData.get(cell.dateStr) ?? []) : []
              const isToday = cell.dateStr === todayStr
              const isSat = cell.dow === 6
              const isSun = cell.dow === 0

              return (
                <div
                  key={idx}
                  className={`min-h-[80px] p-1.5 border-b border-r border-dark-50 ${
                    !cell.dateStr ? 'bg-dark-50/50' : ''
                  } ${idx % 7 === 6 ? 'border-r-0' : ''}`}
                >
                  {cell.dateStr && (
                    <>
                      {/* 날짜 숫자 */}
                      <div className="mb-1">
                        <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full ${
                          isToday
                            ? 'bg-primary-500 text-white'
                            : isSun
                              ? 'text-primary-500'
                              : isSat
                                ? 'text-primary-500'
                                : 'text-dark-600'
                        }`}>
                          {cell.day}
                        </span>
                      </div>

                      {/* 직원 야근 항목 */}
                      <div className="space-y-0.5">
                        {entries.map((entry, i) => {
                          const colorIdx = empColorMap.get(entry.empId) ?? i % EMPLOYEE_COLORS.length
                          return (
                            <div
                              key={i}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium leading-tight ${EMPLOYEE_COLORS[colorIdx]}`}
                            >
                              <span className="truncate">{entry.name}</span>
                              <span className="shrink-0 opacity-80">{fmtHCompact(entry.minutes)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* 하단 범례 */}
          {tableData.length > 0 && (
            <div className="px-4 py-3 border-t border-dark-100 flex items-center gap-3 flex-wrap">
              {tableData.map((row) => {
                const colorIdx = empColorMap.get(row.empId) ?? 0
                return (
                  <div key={row.empId} className="flex items-center gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-sm ${EMPLOYEE_COLORS[colorIdx].split(' ')[0]}`} />
                    <span className="text-xs text-dark-600">{row.name}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

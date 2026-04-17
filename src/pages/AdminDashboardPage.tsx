import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, AlertTriangle, CalendarOff, ChevronRight, ChevronLeft, X, Banknote, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { TeamGaugeList } from '../components/admin/TeamGaugeList'
import { supabase } from '../lib/supabase'
import type { WarningLevel, OvertimeRequest, Expense, OvertimeType } from '../types'
import { OVERTIME_TYPE_LABEL, EXPENSE_CATEGORY_LABEL } from '../types'

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

const OVERTIME_MULTIPLIER: Record<OvertimeType, number> = {
  extended: 1.5,
  night: 2.0,
  holiday: 1.5,
}

interface PayrollRow {
  employeeId: string
  name: string
  department: string
  hourlyWage: number
  extendedHours: number
  extendedPay: number
  nightHours: number
  nightPay: number
  holidayHours: number
  holidayPay: number
  totalPay: number
  expenses: number
  total: number
  overtimeRequests: OvertimeRequest[]
  expenseItems: Expense[]
}

type DrillTarget = { type: 'extended' | 'night' | 'holiday' | 'expenses'; row: PayrollRow }
type DetailTarget = { type: 'overtime'; item: OvertimeRequest } | { type: 'expense'; item: Expense }

export function AdminDashboardPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'this' | 'month'>('this')
  const [thisWeek, setThisWeek] = useState<TeamMember[]>([])
  const [monthData, setMonthData] = useState<TeamMember[]>([])
  const [weeklyBreakdown, setWeeklyBreakdown] = useState<{ label: string; hours: number }[]>([])

  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)

  // Payroll state
  const [payrollYear, setPayrollYear] = useState(now.getFullYear())
  const [payrollMonth, setPayrollMonth] = useState(now.getMonth() + 1)
  const [payrollRows, setPayrollRows] = useState<PayrollRow[]>([])
  const [payrollLoading, setPayrollLoading] = useState(false)
  const [drillTarget, setDrillTarget] = useState<DrillTarget | null>(null)
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null)

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
        supabase.from('overtime_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'manager_approved']),
        supabase.from('leave_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'manager_approved']),
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

  async function fetchPayrollData(year: number, month: number) {
    setPayrollLoading(true)
    // Overtime: fetch (month-1) approved requests
    let otYear = year
    let otMonth = month - 1
    if (otMonth === 0) { otMonth = 12; otYear = year - 1 }
    const otRange = getMonthRange(otYear, otMonth)
    const expRange = getMonthRange(year, month)

    const [otRes, expRes] = await Promise.all([
      supabase
        .from('overtime_requests')
        .select('*, employee:employees!overtime_requests_employee_id_fkey(*)')
        .eq('status', 'approved')
        .gte('date', otRange.start)
        .lte('date', otRange.end),
      supabase
        .from('expenses')
        .select('*, employee:employees!expenses_employee_id_fkey(*)')
        .eq('status', 'approved')
        .gte('date', expRange.start)
        .lte('date', expRange.end),
    ])

    const rowMap = new Map<string, PayrollRow>()

    function getOrCreate(req: OvertimeRequest | Expense): PayrollRow {
      const emp = req.employee
      const id = emp?.id ?? req.employee_id
      if (!rowMap.has(id)) {
        rowMap.set(id, {
          employeeId: id,
          name: emp?.name ?? '알 수 없음',
          department: emp?.department ?? '',
          hourlyWage: emp?.hourly_wage ?? 0,
          extendedHours: 0, extendedPay: 0,
          nightHours: 0, nightPay: 0,
          holidayHours: 0, holidayPay: 0,
          totalPay: 0,
          expenses: 0,
          total: 0,
          overtimeRequests: [],
          expenseItems: [],
        })
      }
      return rowMap.get(id)!
    }

    for (const ot of (otRes.data ?? []) as OvertimeRequest[]) {
      const row = getOrCreate(ot)
      const hours = calcHours(ot.planned_start, ot.planned_end)
      const multiplier = OVERTIME_MULTIPLIER[ot.type]
      const wage = ot.employee?.hourly_wage ?? 0
      const pay = hours * multiplier * wage
      if (ot.type === 'extended') { row.extendedHours += hours; row.extendedPay += pay }
      else if (ot.type === 'night') { row.nightHours += hours; row.nightPay += pay }
      else if (ot.type === 'holiday') { row.holidayHours += hours; row.holidayPay += pay }
      row.overtimeRequests.push(ot)
    }

    for (const exp of (expRes.data ?? []) as Expense[]) {
      const row = getOrCreate(exp)
      row.expenses += exp.amount
      row.expenseItems.push(exp)
    }

    for (const row of rowMap.values()) {
      row.totalPay = row.extendedPay + row.nightPay + row.holidayPay
      row.total = row.totalPay + row.expenses
    }

    setPayrollRows(Array.from(rowMap.values()).sort((a, b) => b.total - a.total))
    setPayrollLoading(false)
  }

  function prevPayrollMonth() {
    if (payrollMonth === 1) { setPayrollYear(y => y - 1); setPayrollMonth(12) }
    else setPayrollMonth(m => m - 1)
  }
  function nextPayrollMonth() {
    const isCurrentMonth = payrollYear === now.getFullYear() && payrollMonth === now.getMonth() + 1
    if (isCurrentMonth) return
    if (payrollMonth === 12) { setPayrollYear(y => y + 1); setPayrollMonth(1) }
    else setPayrollMonth(m => m + 1)
  }

  function exportPayrollExcel() {
    if (payrollRows.length === 0) return
    let otYear = payrollYear
    let otMonth = payrollMonth - 1
    if (otMonth === 0) { otMonth = 12; otYear = payrollYear - 1 }

    // === 시트1: 급여 정산표 ===
    // A:직원명 B:부서 C:기본급(입력) D:시급 E:연장시간 F:연장수당 G:야간시간 H:야간수당 I:휴일시간 J:휴일수당 K:수당소계 L:경비 M:총지급액
    const h1 = ['직원명', '부서', '기본급(원)', '시급(원)', '연장시간(h)', '연장수당(원)', '야간시간(h)', '야간수당(원)', '휴일시간(h)', '휴일수당(원)', '수당소계(원)', '경비(원)', '총지급액(원)']
    const ws1 = XLSX.utils.aoa_to_sheet([h1])

    payrollRows.forEach((r, i) => {
      const row = i + 2
      XLSX.utils.sheet_add_aoa(ws1, [[
        r.name,
        r.department,
        null, // 기본급 — 직접 입력
        r.hourlyWage || null, // DB 시급 (없으면 빈칸)
        Number(r.extendedHours.toFixed(1)),
        null, null, null, null, null, null,
        r.expenses,
        null,
      ]], { origin: `A${row}` })
      ws1[`F${row}`] = { t: 'n', f: `E${row}*D${row}*1.5` }       // 연장수당
      ws1[`H${row}`] = { t: 'n', f: `G${row}*D${row}*2` }         // 야간수당
      ws1[`J${row}`] = { t: 'n', f: `I${row}*D${row}*1.5` }       // 휴일수당
      ws1[`K${row}`] = { t: 'n', f: `F${row}+H${row}+J${row}` }   // 수당소계
      ws1[`M${row}`] = { t: 'n', f: `C${row}+K${row}+L${row}` }   // 총지급액
      // 시간 데이터 채우기 (야간/휴일)
      ws1[`G${row}`] = { t: 'n', v: Number(r.nightHours.toFixed(1)) }
      ws1[`I${row}`] = { t: 'n', v: Number(r.holidayHours.toFixed(1)) }
    })

    const totalRow = payrollRows.length + 2
    const last = totalRow - 1
    XLSX.utils.sheet_add_aoa(ws1, [['합계']], { origin: `A${totalRow}` })
    for (const col of ['C','D','E','F','G','H','I','J','K','L','M']) {
      ws1[`${col}${totalRow}`] = { t: 'n', f: `SUM(${col}2:${col}${last})` }
    }

    ws1['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
    ]
    ws1['!ref'] = `A1:M${totalRow}`

    // === 시트2: 연장근무 상세 ===
    const otHeaders = ['직원명', '부서', '날짜', '유형', '시작', '종료', '시간(h)', '시급(원)', '배율', '수당(원)']
    const otRows: (string | number)[][] = []
    for (const r of payrollRows) {
      for (const ot of r.overtimeRequests) {
        const hrs = calcHours(ot.planned_start, ot.planned_end)
        const mult = OVERTIME_MULTIPLIER[ot.type]
        const wage = ot.employee?.hourly_wage ?? 0
        otRows.push([
          r.name, r.department, ot.date,
          OVERTIME_TYPE_LABEL[ot.type],
          ot.planned_start, ot.planned_end,
          Number(hrs.toFixed(1)), wage, mult,
          Math.round(hrs * wage * mult),
        ])
      }
    }
    const ws2 = XLSX.utils.aoa_to_sheet([otHeaders, ...otRows])
    ws2['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 6 }, { wch: 12 },
    ]

    // === 시트3: 경비 상세 ===
    const expHeaders = ['직원명', '부서', '날짜', '분류', '결제수단', '내용', '금액(원)']
    const expRows: (string | number)[][] = []
    for (const r of payrollRows) {
      for (const exp of r.expenseItems) {
        expRows.push([
          r.name, r.department, exp.date,
          EXPENSE_CATEGORY_LABEL[exp.category],
          exp.payment_method ? ({'card':'카드','transfer':'이체','cash':'현금','other':'기타'}[exp.payment_method] ?? exp.payment_method) : '',
          exp.description, exp.amount,
        ])
      }
    }
    const ws3 = XLSX.utils.aoa_to_sheet([expHeaders, ...expRows])
    ws3['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 10 }, { wch: 30 }, { wch: 12 },
    ]

    // === 워크북 생성 ===
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws1, '급여 정산표')
    XLSX.utils.book_append_sheet(wb, ws2, '연장근무 상세')
    XLSX.utils.book_append_sheet(wb, ws3, '경비 상세')
    XLSX.writeFile(wb, `${payrollYear}년_${payrollMonth}월_급여정산(${otYear}년${otMonth}월근무분).xlsx`)
  }

  useEffect(() => {
    fetchPayrollData(payrollYear, payrollMonth)
  }, [payrollYear, payrollMonth])

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              className={`px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-md transition-colors ${
                mode === 'this' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
              }`}
            >
              금주
            </button>
            <button
              onClick={() => setMode('month')}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-md transition-colors ${
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
            <button onClick={prevMonth} className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-dark-200 transition-colors">
              <ChevronLeft className="w-4 h-4 text-dark-600" />
            </button>
            <span className="text-sm font-medium text-dark-700 min-w-[90px] text-center">
              {selectedYear}년 {selectedMonth}월
            </span>
            <button
              onClick={nextMonth}
              disabled={selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-dark-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4 text-dark-600" />
            </button>
          </div>
        )}

        {/* 게이지 범례 (주간 모드만) */}
        {mode !== 'month' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 bg-dark-50 border-b border-dark-100">
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

      {/* 월 정산 요약 */}
      <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-100">
          <div className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-primary-500" />
            <h2 className="text-sm font-semibold text-dark-900">월 정산 요약</h2>
          </div>
          {payrollRows.length > 0 && (
            <button
              onClick={exportPayrollExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              엑셀 다운로드
            </button>
          )}
        </div>

        {/* 월 선택 네비게이션 */}
        <div className="flex items-center justify-center gap-4 px-4 py-2 bg-dark-50 border-b border-dark-100">
          <button
            onClick={prevPayrollMonth}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-dark-200 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-dark-600" />
          </button>
          <div className="text-center min-w-[160px]">
            <span className="text-sm font-medium text-dark-700">
              {payrollYear}년 {payrollMonth}월
            </span>
            <p className="text-xs text-dark-400 mt-0.5">
              {payrollMonth}월 급여 ({payrollMonth}/15 지급)
            </p>
          </div>
          <button
            onClick={nextPayrollMonth}
            disabled={payrollYear === now.getFullYear() && payrollMonth === now.getMonth() + 1}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-dark-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4 text-dark-600" />
          </button>
        </div>

        {/* 테이블 */}
        {payrollLoading ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-dark-400">불러오는 중...</p>
          </div>
        ) : payrollRows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-dark-400">해당 월 정산 데이터가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-100 bg-dark-50">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500">직원명</th>
                  <th className="px-2 py-2.5 text-right text-xs font-semibold text-dark-500">연장</th>
                  <th className="px-2 py-2.5 text-right text-xs font-semibold text-dark-500">야간</th>
                  <th className="px-2 py-2.5 text-right text-xs font-semibold text-dark-500">휴일</th>
                  <th className="px-2 py-2.5 text-right text-xs font-semibold text-dark-500">수당소계</th>
                  <th className="px-2 py-2.5 text-right text-xs font-semibold text-dark-500">경비</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-dark-500">합계</th>
                </tr>
              </thead>
              <tbody>
                {payrollRows.map((row) => (
                  <tr key={row.employeeId} className="border-b border-dark-100 hover:bg-dark-50 transition-colors">
                    <td className="px-3 py-3">
                      <p className="text-sm font-medium text-dark-900">{row.name}</p>
                      {row.department && <p className="text-xs text-dark-400">{row.department}</p>}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {row.extendedHours > 0 ? (
                        <button
                          onClick={() => setDrillTarget({ type: 'extended', row })}
                          className="text-xs text-primary-500 cursor-pointer hover:text-primary-700 font-medium"
                        >
                          <span>{row.extendedHours.toFixed(1)}h</span>
                          <br />
                          <span className="text-dark-500">{row.extendedPay.toLocaleString()}원</span>
                        </button>
                      ) : <span className="text-xs text-dark-400">-</span>}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {row.nightHours > 0 ? (
                        <button
                          onClick={() => setDrillTarget({ type: 'night', row })}
                          className="text-xs text-primary-500 cursor-pointer hover:text-primary-700 font-medium"
                        >
                          <span>{row.nightHours.toFixed(1)}h</span>
                          <br />
                          <span className="text-dark-500">{row.nightPay.toLocaleString()}원</span>
                        </button>
                      ) : <span className="text-xs text-dark-400">-</span>}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {row.holidayHours > 0 ? (
                        <button
                          onClick={() => setDrillTarget({ type: 'holiday', row })}
                          className="text-xs text-primary-500 cursor-pointer hover:text-primary-700 font-medium"
                        >
                          <span>{row.holidayHours.toFixed(1)}h</span>
                          <br />
                          <span className="text-dark-500">{row.holidayPay.toLocaleString()}원</span>
                        </button>
                      ) : <span className="text-xs text-dark-400">-</span>}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <span className="text-xs font-semibold text-dark-700">{row.totalPay.toLocaleString()}원</span>
                    </td>
                    <td className="px-2 py-3 text-right">
                      {row.expenses > 0 ? (
                        <button
                          onClick={() => setDrillTarget({ type: 'expenses', row })}
                          className="text-xs text-primary-500 cursor-pointer hover:text-primary-700 font-medium"
                        >
                          {row.expenses.toLocaleString()}원
                        </button>
                      ) : <span className="text-xs text-dark-400">-</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-sm font-bold text-dark-900">{row.total.toLocaleString()}원</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-dark-50">
                  <td className="px-3 py-3 text-xs font-bold text-dark-700">합계</td>
                  <td className="px-2 py-3 text-right text-xs font-bold text-dark-700">
                    {payrollRows.reduce((s, r) => s + r.extendedHours, 0).toFixed(1)}h
                    <br /><span className="font-normal">{payrollRows.reduce((s, r) => s + r.extendedPay, 0).toLocaleString()}원</span>
                  </td>
                  <td className="px-2 py-3 text-right text-xs font-bold text-dark-700">
                    {payrollRows.reduce((s, r) => s + r.nightHours, 0).toFixed(1)}h
                    <br /><span className="font-normal">{payrollRows.reduce((s, r) => s + r.nightPay, 0).toLocaleString()}원</span>
                  </td>
                  <td className="px-2 py-3 text-right text-xs font-bold text-dark-700">
                    {payrollRows.reduce((s, r) => s + r.holidayHours, 0).toFixed(1)}h
                    <br /><span className="font-normal">{payrollRows.reduce((s, r) => s + r.holidayPay, 0).toLocaleString()}원</span>
                  </td>
                  <td className="px-2 py-3 text-right text-xs font-bold text-dark-700">
                    {payrollRows.reduce((s, r) => s + r.totalPay, 0).toLocaleString()}원
                  </td>
                  <td className="px-2 py-3 text-right text-xs font-bold text-dark-700">
                    {payrollRows.reduce((s, r) => s + r.expenses, 0).toLocaleString()}원
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-bold text-dark-900">
                    {payrollRows.reduce((s, r) => s + r.total, 0).toLocaleString()}원
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Level 1 드릴다운 모달 */}
      {drillTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setDrillTarget(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
              <div>
                <h3 className="text-sm font-bold text-dark-900">{drillTarget.row.name}</h3>
                <p className="text-xs text-dark-400 mt-0.5">
                  {drillTarget.type === 'expenses' ? '승인 경비 내역'
                    : drillTarget.type === 'extended' ? '연장근무 내역 (×1.5)'
                    : drillTarget.type === 'night' ? '야간근무 내역 (×2.0)'
                    : '휴일근무 내역 (×1.5)'}
                </p>
              </div>
              <button
                onClick={() => setDrillTarget(null)}
                className="p-2 rounded-lg hover:bg-dark-100 transition-colors"
              >
                <X className="w-4 h-4 text-dark-500" />
              </button>
            </div>

            {/* 모달 내용 */}
            <div className="overflow-y-auto flex-1 divide-y divide-dark-100">
              {drillTarget.type === 'expenses'
                ? drillTarget.row.expenseItems.map((exp) => (
                      <button
                        key={exp.id}
                        onClick={() => setDetailTarget({ type: 'expense', item: exp })}
                        className="w-full px-5 py-3.5 text-left hover:bg-dark-50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-dark-900">{exp.date}</p>
                            <p className="text-xs text-dark-500 mt-0.5">
                              {EXPENSE_CATEGORY_LABEL[exp.category]} · {exp.description}
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-primary-600">
                            {exp.amount.toLocaleString()}원
                          </span>
                        </div>
                      </button>
                  ))
                : drillTarget.row.overtimeRequests
                    .filter((ot) => ot.type === drillTarget.type)
                    .map((ot) => {
                    const hrs = calcHours(ot.planned_start, ot.planned_end)
                    const pay = hrs * OVERTIME_MULTIPLIER[ot.type] * (ot.employee?.hourly_wage ?? 0)
                    return (
                      <button
                        key={ot.id}
                        onClick={() => setDetailTarget({ type: 'overtime', item: ot })}
                        className="w-full px-5 py-3.5 text-left hover:bg-dark-50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-dark-900">{ot.date}</p>
                            <p className="text-xs text-dark-500 mt-0.5">
                              {ot.planned_start}~{ot.planned_end} · {hrs.toFixed(1)}h
                            </p>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <span className="text-sm font-semibold text-primary-600">
                              {pay.toLocaleString()}원
                            </span>
                            <p className="text-xs text-dark-400">{hrs.toFixed(1)}h × {OVERTIME_MULTIPLIER[ot.type]}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
            </div>
          </div>
        </div>
      )}

      {/* Level 2 상세 모달 */}
      {detailTarget && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setDetailTarget(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
              <h3 className="text-sm font-bold text-dark-900">
                {detailTarget.type === 'overtime' ? '연장근무 상세' : '경비 상세'}
              </h3>
              <button
                onClick={() => setDetailTarget(null)}
                className="p-2 rounded-lg hover:bg-dark-100 transition-colors"
              >
                <X className="w-4 h-4 text-dark-500" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {detailTarget.type === 'overtime' ? (
                <>
                  {[
                    { label: '날짜', value: detailTarget.item.date },
                    { label: '유형', value: OVERTIME_TYPE_LABEL[detailTarget.item.type] },
                    { label: '시간', value: `${detailTarget.item.planned_start} ~ ${detailTarget.item.planned_end}` },
                    { label: '근무시간', value: `${calcHours(detailTarget.item.planned_start, detailTarget.item.planned_end).toFixed(1)}h` },
                    { label: '수당', value: `${(calcHours(detailTarget.item.planned_start, detailTarget.item.planned_end) * OVERTIME_MULTIPLIER[detailTarget.item.type] * (detailTarget.item.employee?.hourly_wage ?? 0)).toLocaleString()}원` },
                    { label: '사유', value: detailTarget.item.reason },
                    ...(detailTarget.item.site_name ? [{ label: '현장명', value: detailTarget.item.site_name }] : []),
                    ...(detailTarget.item.work_details ? [{ label: '작업 내용', value: detailTarget.item.work_details }] : []),
                    { label: '상태', value: detailTarget.item.status },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-3">
                      <span className="text-xs text-dark-400 w-20 shrink-0 pt-0.5">{label}</span>
                      <span className="text-xs text-dark-900 flex-1">{value}</span>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {[
                    { label: '날짜', value: detailTarget.item.date },
                    { label: '분류', value: EXPENSE_CATEGORY_LABEL[detailTarget.item.category] },
                    { label: '금액', value: `${detailTarget.item.amount.toLocaleString()}원` },
                    { label: '내용', value: detailTarget.item.description },
                    ...(detailTarget.item.payment_method ? [{ label: '결제수단', value: detailTarget.item.payment_method }] : []),
                    { label: '상태', value: detailTarget.item.status },
                    ...(detailTarget.item.admin_note ? [{ label: '관리자 메모', value: detailTarget.item.admin_note }] : []),
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-3">
                      <span className="text-xs text-dark-400 w-20 shrink-0 pt-0.5">{label}</span>
                      <span className="text-xs text-dark-900 flex-1">{value}</span>
                    </div>
                  ))}
                  {detailTarget.item.receipt_url && (
                    <div className="flex gap-3">
                      <span className="text-xs text-dark-400 w-20 shrink-0 pt-0.5">영수증</span>
                      <a
                        href={detailTarget.item.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary-500 hover:underline"
                      >
                        보기
                      </a>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

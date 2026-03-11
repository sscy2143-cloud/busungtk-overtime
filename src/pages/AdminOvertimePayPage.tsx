import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Edit2, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { calculateOvertimeBreakdown } from '../utils/overtime-calc'
import type { OvertimeRequest } from '../types'

function fmtWon(amount: number) {
  return `${Math.round(amount).toLocaleString('ko-KR')}원`
}

function fmtH(minutes: number) {
  if (minutes === 0) return '-'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function AdminOvertimePayPage() {
  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [allRequests, setAllRequests] = useState<(OvertimeRequest & { employee: any })[]>([])
  const [loading, setLoading] = useState(true)
  // 시급 로컬 오버라이드 (DB 반영 전 즉시 UI 반영용)
  const [wageOverrides, setWageOverrides] = useState<Record<string, number>>({})
  const [compLeaveRequestIds, setCompLeaveRequestIds] = useState<Set<string>>(new Set())
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const monthPrefix = `${calYear}-${String(calMonth).padStart(2, '0')}`

  useEffect(() => {
    supabase
      .from('substitute_history')
      .select('related_request_id')
      .not('related_request_id', 'is', null)
      .then(({ data }) => {
        if (data) setCompLeaveRequestIds(new Set(data.map((r: any) => r.related_request_id as string)))
      })
  }, [])

  useEffect(() => {
    setLoading(true)
    supabase
      .from('overtime_requests')
      .select('*, employee:employees!overtime_requests_employee_id_fkey(id, name, department, hourly_wage)')
      .eq('status', 'approved')
      .gte('date', `${monthPrefix}-01`)
      .lte('date', `${monthPrefix}-31`)
      .then(({ data }) => {
        if (data) setAllRequests(data as any)
        setLoading(false)
      })
  }, [monthPrefix])

  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calYear === now.getFullYear() && calMonth === now.getMonth() + 1) return
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1) }
    else setCalMonth(m => m + 1)
  }

  const payTable = useMemo(() => {
    const map = new Map<string, {
      empId: string; name: string; department: string
      dbWage: number
      extended: number; night: number
      holiday: number; holidayOvertime: number
      holidayNight: number; holidayOvertimeNight: number
      totalMinutes: number
    }>()
    for (const r of allRequests.filter(r => !compLeaveRequestIds.has(r.id))) {
      const empId = r.employee_id
      const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
      let entry = map.get(empId)
      if (!entry) {
        entry = {
          empId,
          name: r.employee?.name ?? '알 수 없음',
          department: r.employee?.department ?? '',
          dbWage: r.employee?.hourly_wage ?? 0,
          extended: 0, night: 0, holiday: 0, holidayOvertime: 0,
          holidayNight: 0, holidayOvertimeNight: 0, totalMinutes: 0,
        }
        map.set(empId, entry)
      }
      entry.extended += bd.extendedMinutes
      entry.night += bd.nightMinutes
      entry.holiday += bd.holidayMinutes
      entry.holidayOvertime += bd.holidayOvertimeMinutes
      entry.holidayNight += bd.holidayNightMinutes
      entry.holidayOvertimeNight += bd.holidayOvertimeNightMinutes
      entry.totalMinutes += bd.totalMinutes
    }
    return Array.from(map.values()).sort((a, b) => b.totalMinutes - a.totalMinutes)
  }, [allRequests, compLeaveRequestIds])

  function getWage(empId: string, dbWage: number): number {
    return wageOverrides[empId] ?? dbWage
  }

  function calcPay(row: typeof payTable[0], hourlyWage: number) {
    return (
      (row.extended / 60) * hourlyWage * 1.5 +
      (row.night / 60) * hourlyWage * 2.0 +
      (row.holiday / 60) * hourlyWage * 1.5 +
      (row.holidayOvertime / 60) * hourlyWage * 2.0 +
      (row.holidayNight / 60) * hourlyWage * 2.0 +
      (row.holidayOvertimeNight / 60) * hourlyWage * 2.5
    )
  }

  function startEdit(empId: string, currentWage: number) {
    setEditingEmpId(empId)
    setEditingValue(currentWage > 0 ? String(currentWage) : '')
  }

  async function confirmEdit(empId: string) {
    const parsed = parseInt(editingValue.replace(/,/g, ''), 10)
    const wage = isNaN(parsed) ? 0 : parsed
    // DB 저장
    await supabase.from('employees').update({ hourly_wage: wage }).eq('id', empId)
    // 로컬 즉시 반영
    setWageOverrides(prev => ({ ...prev, [empId]: wage }))
    setEditingEmpId(null)
  }

  function cancelEdit() {
    setEditingEmpId(null)
  }

  const totalPay = payTable.reduce((s, row) => s + calcPay(row, getWage(row.empId, row.dbWage)), 0)
  const wageFilledCount = payTable.filter(r => getWage(r.empId, r.dbWage) > 0).length
  const compLeaveExcludedCount = allRequests.filter(r => compLeaveRequestIds.has(r.id)).length

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <p className="text-sm text-gray-400">불러오는 중...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">연장근무수당</h1>
        <p className="text-sm text-gray-500 mt-0.5">시급을 입력하면 수당을 자동으로 계산합니다</p>
      </div>

      {/* 계산 기준 안내 */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 space-y-2">
        <p className="text-xs font-semibold text-blue-700">수당 계산 기준 (근로기준법)</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-blue-600">
          <span>연장근로 × 1.5배</span>
          <span>야간근로(연장+야간) × 2.0배</span>
          <span>휴일근로(8h 이내) × 1.5배</span>
          <span>휴일근로(8h 초과) × 2.0배</span>
          <span>휴일+야간 × 2.0배</span>
          <span>휴일초과+야간 × 2.5배</span>
        </div>
        <p className="text-xs text-blue-400">* 시급은 사원현황에서 설정하거나 여기서 직접 수정할 수 있습니다</p>
      </div>

      {/* 대체휴가 제외 안내 */}
      {compLeaveExcludedCount > 0 && (
        <div className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 text-xs text-teal-700">
          <span>대체휴가로 처리된 야근 <span className="font-semibold">{compLeaveExcludedCount}건</span>은 수당 계산에서 제외됩니다</span>
        </div>
      )}

      {/* 월 선택 */}
      <div className="flex items-center gap-2 justify-end">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
        <span className="text-sm font-semibold text-gray-700 min-w-[80px] text-center">{calYear}년 {calMonth}월</span>
        <button
          onClick={nextMonth}
          disabled={calYear === now.getFullYear() && calMonth === now.getMonth() + 1}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-gray-600" />
        </button>
      </div>

      {payTable.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <p className="text-sm text-gray-400">해당 월 승인된 야근 데이터가 없습니다</p>
        </div>
      ) : (
        <>
          {wageFilledCount < payTable.length && (
            <div className="flex items-center gap-2 bg-warning-50 border border-warning-200 rounded-xl px-4 py-2.5 text-xs text-warning-700">
              <span>시급이 설정되지 않은 직원이 {payTable.length - wageFilledCount}명 있습니다. 편집 버튼으로 시급을 입력해 주세요.</span>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">직원</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">부서</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 whitespace-nowrap">시급</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">총 근무</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-blue-600 whitespace-nowrap">연장수당</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-indigo-600 whitespace-nowrap">야간수당</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-orange-600 whitespace-nowrap">휴일수당</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">수당 합계</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {payTable.map((row) => {
                    const wage = getWage(row.empId, row.dbWage)
                    const extendedPay = (row.extended / 60) * wage * 1.5
                    const nightPay = (row.night / 60) * wage * 2.0
                    const holidayPay =
                      (row.holiday / 60) * wage * 1.5 +
                      (row.holidayOvertime / 60) * wage * 2.0 +
                      (row.holidayNight / 60) * wage * 2.0 +
                      (row.holidayOvertimeNight / 60) * wage * 2.5
                    const total = extendedPay + nightPay + holidayPay
                    const isEditing = editingEmpId === row.empId

                    return (
                      <tr key={row.empId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{row.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{row.department}</td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <div className="flex items-center gap-1 justify-center">
                              <input
                                type="number"
                                value={editingValue}
                                onChange={e => setEditingValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') confirmEdit(row.empId)
                                  if (e.key === 'Escape') cancelEdit()
                                }}
                                className="w-24 px-2 py-1 text-xs border border-primary-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400 text-right"
                                placeholder="시급 입력"
                                autoFocus
                              />
                              <button onClick={() => confirmEdit(row.empId)} className="p-1 text-success-600 hover:text-success-700">
                                <Check size={14} />
                              </button>
                              <button onClick={cancelEdit} className="p-1 text-gray-400 hover:text-gray-600">
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(row.empId, wage)}
                              className="flex items-center gap-1.5 mx-auto text-xs font-medium text-gray-700 hover:text-primary-700 group"
                            >
                              {wage > 0
                                ? <span>{wage.toLocaleString('ko-KR')}원</span>
                                : <span className="text-gray-300">미설정</span>
                              }
                              <Edit2 size={11} className="text-gray-300 group-hover:text-primary-500" />
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-500">{fmtH(row.totalMinutes)}</td>
                        <td className="px-4 py-3 text-right text-xs text-blue-600">
                          {wage > 0 ? fmtWon(extendedPay) : <span className="text-gray-200">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-indigo-600">
                          {wage > 0 ? fmtWon(nightPay) : <span className="text-gray-200">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-orange-600">
                          {wage > 0 ? fmtWon(holidayPay) : <span className="text-gray-200">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-800">
                          {wage > 0
                            ? fmtWon(total)
                            : <span className="text-gray-300 font-normal text-xs">시급 입력 필요</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 text-sm" colSpan={7}>
                      {calYear}년 {calMonth}월 총 지급 수당
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-primary-700 text-base">
                      {fmtWon(totalPay)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

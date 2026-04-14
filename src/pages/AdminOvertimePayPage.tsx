import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Edit2, Check, X, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { calculateOvertimeBreakdown } from '../utils/overtime-calc'
import type { OvertimeRequest } from '../types'

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토']

interface VerifyPopup {
  empId: string
  empName: string
  records: (OvertimeRequest & { employee: any })[]
  loading: boolean
}

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
  const [verifyPopup, setVerifyPopup] = useState<VerifyPopup | null>(null)

  async function openVerify(empId: string, empName: string) {
    setVerifyPopup({ empId, empName, records: [], loading: true })
    const { data } = await supabase
      .from('overtime_requests')
      .select('*, employee:employees!overtime_requests_employee_id_fkey(id, name)')
      .eq('employee_id', empId)
      .gte('date', `${monthPrefix}-01`)
      .lte('date', `${monthPrefix}-31`)
      .order('date', { ascending: true })
    setVerifyPopup({ empId, empName, records: (data as any) ?? [], loading: false })
  }

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
      <p className="text-sm text-dark-400">불러오는 중...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-dark-900">연장근무수당</h1>
        <p className="text-sm text-dark-500 mt-0.5">시급을 입력하면 수당을 자동으로 계산합니다</p>
      </div>

      {/* 계산 기준 안내 */}
      <div className="bg-primary-50 border border-blue-100 rounded-xl px-4 py-3 space-y-2">
        <p className="text-xs font-semibold text-primary-700">수당 계산 기준 (근로기준법)</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-primary-600">
          <span>연장근로 × 1.5배</span>
          <span>야간근로(연장+야간) × 2.0배</span>
          <span>휴일근로(8h 이내) × 1.5배</span>
          <span>휴일근로(8h 초과) × 2.0배</span>
          <span>휴일+야간 × 2.0배</span>
          <span>휴일초과+야간 × 2.5배</span>
        </div>
        <p className="text-xs text-dark-400">* 시급은 사원현황에서 설정하거나 여기서 직접 수정할 수 있습니다</p>
      </div>

      {/* 대체휴가 제외 안내 */}
      {compLeaveExcludedCount > 0 && (
        <div className="flex items-center gap-2 bg-dark-50 border border-primary-200 rounded-xl px-4 py-2.5 text-xs text-dark-700">
          <span>대체휴가로 처리된 야근 <span className="font-semibold">{compLeaveExcludedCount}건</span>은 수당 계산에서 제외됩니다</span>
        </div>
      )}

      {/* 월 선택 */}
      <div className="flex items-center gap-2 justify-end">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-dark-100 transition-colors">
          <ChevronLeft className="w-4 h-4 text-dark-600" />
        </button>
        <span className="text-sm font-semibold text-dark-700 min-w-[80px] text-center">{calYear}년 {calMonth}월</span>
        <button
          onClick={nextMonth}
          disabled={calYear === now.getFullYear() && calMonth === now.getMonth() + 1}
          className="p-1.5 rounded-lg hover:bg-dark-100 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-dark-600" />
        </button>
      </div>

      {payTable.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] py-16 text-center">
          <p className="text-sm text-dark-400">해당 월 승인된 야근 데이터가 없습니다</p>
        </div>
      ) : (
        <>
          {wageFilledCount < payTable.length && (
            <div className="flex items-center gap-2 bg-warning-50 border border-warning-200 rounded-xl px-4 py-2.5 text-xs text-warning-700">
              <span>시급이 설정되지 않은 직원이 {payTable.length - wageFilledCount}명 있습니다. 편집 버튼으로 시급을 입력해 주세요.</span>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-100 bg-dark-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">직원</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400">부서</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-dark-600 whitespace-nowrap">시급</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-500 whitespace-nowrap">총 근무</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-primary-600 whitespace-nowrap">연장수당</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-700 whitespace-nowrap">야간수당</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-primary-600 whitespace-nowrap">휴일수당</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-700 whitespace-nowrap">수당 합계</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-50">
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
                      <tr key={row.empId} className="hover:bg-dark-50 transition-colors">
                        <td
                          className="px-4 py-3 font-medium text-dark-800 cursor-pointer hover:text-primary-600 underline-offset-2 hover:underline"
                          onClick={() => openVerify(row.empId, row.name)}
                        >{row.name}</td>
                        <td className="px-4 py-3 text-xs text-dark-400">{row.department}</td>
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
                              <button onClick={cancelEdit} className="p-1 text-dark-400 hover:text-dark-600">
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(row.empId, wage)}
                              className="flex items-center gap-1.5 mx-auto text-xs font-medium text-dark-700 hover:text-primary-700 group"
                            >
                              {wage > 0
                                ? <span>{wage.toLocaleString('ko-KR')}원</span>
                                : <span className="text-dark-300">미설정</span>
                              }
                              <Edit2 size={11} className="text-dark-300 group-hover:text-primary-500" />
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-dark-500">{fmtH(row.totalMinutes)}</td>
                        <td className="px-4 py-3 text-right text-xs text-primary-600">
                          {wage > 0 ? fmtWon(extendedPay) : <span className="text-dark-200">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-dark-700">
                          {wage > 0 ? fmtWon(nightPay) : <span className="text-dark-200">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-primary-600">
                          {wage > 0 ? fmtWon(holidayPay) : <span className="text-dark-200">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-dark-800">
                          {wage > 0
                            ? fmtWon(total)
                            : <span className="text-dark-300 font-normal text-xs">시급 입력 필요</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-dark-200 bg-dark-50">
                    <td className="px-4 py-3 font-semibold text-dark-700 text-sm" colSpan={7}>
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
      {/* ── 누락 확인 팝업 ── */}
      {verifyPopup && (() => {
        const approved = verifyPopup.records.filter(r => r.status === 'approved')
        const pending = verifyPopup.records.filter(r => r.status === 'pending')
        const rejected = verifyPopup.records.filter(r => r.status === 'rejected')
        const hasPending = pending.length > 0

        const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
          approved: { text: '승인', cls: 'bg-success-50 text-success-700' },
          pending:  { text: '대기', cls: 'bg-warning-50 text-warning-700' },
          rejected: { text: '반려', cls: 'bg-red-50 text-red-600' },
        }

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setVerifyPopup(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
                <div>
                  <p className="text-base font-bold text-dark-900">{verifyPopup.empName}</p>
                  <p className="text-xs text-dark-400 mt-0.5">{calYear}년 {calMonth}월 야근신청 전체 내역</p>
                </div>
                <button onClick={() => setVerifyPopup(null)} className="p-1.5 rounded-lg hover:bg-dark-100">
                  <X size={18} className="text-dark-500" />
                </button>
              </div>

              {/* 요약 배지 */}
              <div className="px-5 py-3 flex items-center gap-2 border-b border-dark-50">
                <span className="text-xs px-2 py-1 bg-success-50 text-success-700 rounded-full font-medium">승인 {approved.length}건</span>
                {pending.length > 0 && (
                  <span className="text-xs px-2 py-1 bg-warning-50 text-warning-700 rounded-full font-medium flex items-center gap-1">
                    <AlertCircle size={11} /> 대기 {pending.length}건
                  </span>
                )}
                {rejected.length > 0 && (
                  <span className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded-full font-medium">반려 {rejected.length}건</span>
                )}
                {verifyPopup.records.length === 0 && !verifyPopup.loading && (
                  <span className="text-xs text-dark-400">신청 내역 없음</span>
                )}
              </div>

              {/* 대기 건 경고 */}
              {hasPending && (
                <div className="mx-5 mt-3 px-3 py-2 bg-warning-50 border border-warning-200 rounded-xl text-xs text-warning-700 flex items-center gap-1.5">
                  <AlertCircle size={13} />
                  대기 중인 건은 수당 계산에 미반영됩니다. 승인 후 재확인하세요.
                </div>
              )}

              {/* 목록 */}
              <div className="overflow-y-auto flex-1 divide-y divide-dark-50 mt-2">
                {verifyPopup.loading ? (
                  <p className="py-10 text-center text-sm text-dark-400">불러오는 중...</p>
                ) : verifyPopup.records.length === 0 ? (
                  <p className="py-10 text-center text-sm text-dark-400">신청 내역이 없습니다</p>
                ) : verifyPopup.records.map(r => {
                  const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
                  const dow = DOW_KO[new Date(r.date + 'T00:00:00+09:00').getDay()]
                  const h = Math.floor(bd.totalMinutes / 60)
                  const m = bd.totalMinutes % 60
                  const timeStr = m === 0 ? `${h}시간` : `${h}시간 ${m}분`
                  const st = STATUS_LABEL[r.status] ?? { text: r.status, cls: 'bg-dark-100 text-dark-600' }
                  const isCompLeave = compLeaveRequestIds.has(r.id)

                  return (
                    <div key={r.id} className={`px-5 py-3.5 ${r.status === 'pending' ? 'bg-warning-50/30' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-dark-800">
                          {r.date.slice(5).replace('-', '/')} ({dow})
                        </span>
                        <div className="flex items-center gap-1.5">
                          {isCompLeave && (
                            <span className="text-xs px-1.5 py-0.5 bg-dark-100 text-dark-500 rounded font-medium">대체휴가</span>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${st.cls}`}>{st.text}</span>
                          <span className="text-sm font-bold text-primary-600">{timeStr}</span>
                        </div>
                      </div>
                      <div className="text-xs text-dark-500 mb-0.5">
                        {r.planned_start} ~ {r.planned_end}
                        {bd.isHoliday && <span className="ml-2 text-primary-500 font-medium">휴일</span>}
                      </div>
                      {(r.site_name || r.reason) && (
                        <p className="text-xs text-dark-400 truncate">{r.site_name ? `[${r.site_name}] ` : ''}{r.reason}</p>
                      )}
                      {r.rejection_reason && (
                        <p className="text-xs text-red-400 mt-0.5">반려 사유: {r.rejection_reason}</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 합계 */}
              {approved.length > 0 && (
                <div className="px-5 py-3 border-t border-dark-100 flex items-center justify-between bg-dark-50 rounded-b-2xl">
                  <span className="text-xs text-dark-500">승인분 합계</span>
                  <span className="text-sm font-bold text-dark-800">
                    {(() => {
                      const total = approved.reduce((s, r) => s + calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end).totalMinutes, 0)
                      const h = Math.floor(total / 60); const m = total % 60
                      return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
                    })()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

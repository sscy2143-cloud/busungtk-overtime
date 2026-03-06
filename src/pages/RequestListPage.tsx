import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ChevronLeft, ChevronRight, Clock, CalendarDays, FileCheck, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { OvertimeRequest } from '../types'
import { OVERTIME_TYPE_LABEL, REQUEST_STATUS_LABEL } from '../types'
import { StatusBadge } from '../components/common/StatusBadge'

const TODAY = new Date().toISOString().split('T')[0]
const TODAY_LABEL = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '')
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

function getWeekRange() {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: monday.toISOString().split('T')[0], end: sunday.toISOString().split('T')[0] }
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return mins / 60
}

function formatDate(d: string) {
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}(${['일','월','화','수','목','금','토'][dt.getDay()]})`
}

const TYPE_COLOR: Record<string, string> = {
  extended: 'bg-blue-100 text-blue-700',
  night: 'bg-indigo-100 text-indigo-700',
  holiday: 'bg-orange-100 text-orange-700',
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────
export function RequestListPage() {
  const navigate = useNavigate()
  const { employee } = useAuth()
  const [requests, setRequests] = useState<OvertimeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    if (!employee?.id) return
    supabase
      .from('overtime_requests')
      .select('*')
      .eq('employee_id', employee!.id)
      .order('date', { ascending: false })
      .then(({ data }) => {
        if (data) setRequests(data as OvertimeRequest[])
        setLoading(false)
      })
  }, [employee?.id])

  const weekRange = getWeekRange()
  const thisMonthPrefix = TODAY.slice(0, 7)

  const weeklyHours = requests
    .filter(r => r.status === 'approved' && r.date >= weekRange.start && r.date <= weekRange.end)
    .reduce((s, r) => s + calcHours(r.planned_start, r.planned_end), 0)

  const monthlyHours = requests
    .filter(r => r.status === 'approved' && r.date.startsWith(thisMonthPrefix))
    .reduce((s, r) => s + calcHours(r.planned_start, r.planned_end), 0)

  const pending = requests.filter(r => r.status === 'pending')
  const past = requests.filter(r => r.status !== 'pending')

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-gray-400">불러오는 중...</p></div>

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">근무 현황</h1>
        <p className="text-sm text-gray-400 mt-0.5">{TODAY_LABEL}</p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-2">
            <Clock className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-lg font-bold text-blue-600">{weeklyHours.toFixed(1)}h</p>
          <p className="text-xs text-gray-400 mt-0.5">금주 연장</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="w-8 h-8 bg-primary-50 rounded-xl flex items-center justify-center mx-auto mb-2">
            <CalendarDays className="w-4 h-4 text-primary-600" />
          </div>
          <p className="text-lg font-bold text-primary-600">{monthlyHours.toFixed(1)}h</p>
          <p className="text-xs text-gray-400 mt-0.5">이번달 연장</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="w-8 h-8 bg-warning-50 rounded-xl flex items-center justify-center mx-auto mb-2">
            <FileCheck className="w-4 h-4 text-warning-500" />
          </div>
          <p className="text-lg font-bold text-warning-600">{pending.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">승인 대기</p>
        </div>
      </div>

      {/* 신청 버튼 */}
      <button
        onClick={() => navigate('/request')}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary-600 text-white font-semibold rounded-2xl hover:bg-primary-700 transition-colors shadow-sm"
      >
        <Plus className="w-5 h-5" />
        연장근무 신청하기
      </button>

      {/* 승인 대기중 + 지난 내역 (2칸) */}
      <div className="grid grid-cols-2 gap-3">
        {/* 승인 대기중 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-3 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-900">승인 대기중</h2>
            {pending.length > 0 && (
              <span className="text-xs bg-warning-100 text-warning-700 font-semibold px-1.5 py-0.5 rounded-full">{pending.length}</span>
            )}
          </div>
          {pending.length === 0 ? (
            <div className="py-8 text-center"><p className="text-xs text-gray-400">없음</p></div>
          ) : (
            <div className="divide-y divide-gray-50">
              {pending.map(req => (
                <div key={req.id} className="px-3 py-2.5">
                  <p className="text-xs font-medium text-gray-700">{formatDate(req.date)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{req.planned_start}~{req.planned_end}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                      {OVERTIME_TYPE_LABEL[req.type]}
                    </span>
                    <span className="text-xs font-semibold text-gray-600">
                      {calcHours(req.planned_start, req.planned_end).toFixed(1)}h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 지난 내역 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-3 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-900">지난 내역</h2>
            <button onClick={() => setHistoryOpen(true)} className="text-xs text-primary-600 hover:underline">더보기</button>
          </div>
          {past.length === 0 ? (
            <div className="py-8 text-center"><p className="text-xs text-gray-400">없음</p></div>
          ) : (
            <div className="divide-y divide-gray-50">
              {past.slice(0, 10).map(req => (
                <div key={req.id} className="px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-700">{formatDate(req.date)}</p>
                    <StatusBadge status={req.status} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{req.planned_start}~{req.planned_end}
                    <span className="ml-1 font-semibold text-gray-600">{calcHours(req.planned_start, req.planned_end).toFixed(1)}h</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 더보기 모달 */}
      {historyOpen && (
        <HistoryModal requests={requests} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  )
}

// ─── 더보기 모달 ────────────────────────────────────────────────────────────
function HistoryModal({ requests, onClose }: { requests: OvertimeRequest[]; onClose: () => void }) {
  const now = new Date()
  const [filterStart, setFilterStart] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
  const [filterEnd, setFilterEnd] = useState(TODAY)
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [popupDay, setPopupDay] = useState<string | null>(null)

  // 리스트: 기간 필터 적용
  const filtered = useMemo(() =>
    requests.filter(r => r.date >= filterStart && r.date <= filterEnd)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [requests, filterStart, filterEnd]
  )

  // 캘린더: 해당 월 날짜별 시간 집계 (approved만)
  const dayHoursMap = useMemo(() => {
    const map = new Map<string, { hours: number; reqs: OvertimeRequest[] }>()
    const prefix = `${calYear}-${String(calMonth).padStart(2, '0')}`
    requests
      .filter(r => r.status === 'approved' && r.date.startsWith(prefix))
      .forEach(r => {
        const h = calcHours(r.planned_start, r.planned_end)
        const existing = map.get(r.date)
        if (existing) { existing.hours += h; existing.reqs.push(r) }
        else map.set(r.date, { hours: h, reqs: [r] })
      })
    return map
  }, [requests, calYear, calMonth])

  // 캘린더 날짜 배열 (월~일 기준)
  const calDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth - 1, 1).getDay() // 0=Sun
    const offset = firstDay === 0 ? 6 : firstDay - 1 // Mon=0
    const lastDate = new Date(calYear, calMonth, 0).getDate()
    const cells: (number | null)[] = Array(offset).fill(null)
    for (let d = 1; d <= lastDate; d++) cells.push(d)
    return cells
  }, [calYear, calMonth])

  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calYear === now.getFullYear() && calMonth === now.getMonth() + 1) return
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1) }
    else setCalMonth(m => m + 1)
  }

  function dayKey(d: number) {
    return `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  const popupData = popupDay ? dayHoursMap.get(popupDay) : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-auto">
      <div className="relative bg-white w-full min-h-screen sm:min-h-0 sm:rounded-2xl sm:my-6 sm:max-w-5xl shadow-2xl flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">연장근무 전체 내역</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* 바디 */}
        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">

          {/* ── 좌측: 리스트 ── */}
          <div className="flex flex-col lg:w-1/2 border-b lg:border-b-0 lg:border-r border-gray-100">
            {/* 기간 필터 */}
            <div className="px-4 py-3 border-b border-gray-100 shrink-0">
              <p className="text-xs font-semibold text-gray-500 mb-2">기간 설정</p>
              <div className="flex items-center gap-2">
                <input
                  type="date" value={filterStart}
                  onChange={e => setFilterStart(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
                />
                <span className="text-xs text-gray-400">~</span>
                <input
                  type="date" value={filterEnd}
                  onChange={e => setFilterEnd(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">{filtered.length}건 · 총 {filtered.filter(r => r.status === 'approved').reduce((s, r) => s + calcHours(r.planned_start, r.planned_end), 0).toFixed(1)}h (승인)</p>
            </div>

            {/* 리스트 */}
            <div className="overflow-y-auto flex-1 max-h-[40vh] lg:max-h-none">
              {filtered.length === 0 ? (
                <div className="py-12 text-center"><p className="text-sm text-gray-400">해당 기간 내역이 없습니다</p></div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">날짜</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">유형</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">시간</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">현장</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map(req => (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-gray-700">{formatDate(req.date)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-1.5 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                            {OVERTIME_TYPE_LABEL[req.type]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-700">
                          {calcHours(req.planned_start, req.planned_end).toFixed(1)}h
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 max-w-[80px] truncate">{req.site_name ?? '-'}</td>
                        <td className="px-3 py-2.5"><StatusBadge status={req.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── 우측: 캘린더 ── */}
          <div className="flex flex-col lg:w-1/2 p-4">
            {/* 월 네비 */}
            <div className="flex items-center justify-between mb-3 shrink-0">
              <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100">
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
              <span className="text-sm font-semibold text-gray-800">{calYear}년 {calMonth}월</span>
              <button
                onClick={nextMonth}
                disabled={calYear === now.getFullYear() && calMonth === now.getMonth() + 1}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map(d => (
                <div key={d} className={`text-center text-xs font-medium py-1 ${d === '토' ? 'text-blue-400' : d === '일' ? 'text-red-400' : 'text-gray-400'}`}>
                  {d}
                </div>
              ))}
            </div>

            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7 gap-0.5 flex-1">
              {calDays.map((d, i) => {
                if (!d) return <div key={`empty-${i}`} />
                const dk = dayKey(d)
                const info = dayHoursMap.get(dk)
                const isToday = dk === TODAY
                const colIndex = i % 7
                return (
                  <div
                    key={dk}
                    className={`min-h-[52px] rounded-lg p-1 flex flex-col ${isToday ? 'bg-primary-50 border border-primary-200' : 'hover:bg-gray-50'}`}
                  >
                    <span className={`text-xs mb-0.5 ${isToday ? 'font-bold text-primary-700' : colIndex === 5 ? 'text-blue-400' : colIndex === 6 ? 'text-red-400' : 'text-gray-500'}`}>
                      {d}
                    </span>
                    {info && (
                      <button
                        onClick={() => setPopupDay(popupDay === dk ? null : dk)}
                        className="text-xs font-semibold text-primary-600 bg-primary-100 hover:bg-primary-200 rounded px-1 py-0.5 w-full text-center transition-colors"
                      >
                        +{info.hours.toFixed(1)}h
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 날짜 클릭 팝업 */}
            {popupDay && popupData && (
              <div className="mt-3 border border-primary-200 rounded-xl p-3 bg-primary-50 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-primary-800">{popupDay} 연장근무</p>
                  <button onClick={() => setPopupDay(null)}><X className="w-3.5 h-3.5 text-primary-400" /></button>
                </div>
                <div className="space-y-2">
                  {popupData.reqs.map(req => (
                    <div key={req.id} className="bg-white rounded-lg px-3 py-2 text-xs">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`px-1.5 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                          {OVERTIME_TYPE_LABEL[req.type]}
                        </span>
                        <StatusBadge status={req.status} />
                      </div>
                      <p className="text-gray-700 mt-1">{req.planned_start} ~ {req.planned_end} · <span className="font-semibold">{calcHours(req.planned_start, req.planned_end).toFixed(1)}h</span></p>
                      {req.site_name && <p className="text-gray-500 truncate">{req.site_name}</p>}
                      {req.work_details && <p className="text-gray-400 truncate">{req.work_details}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

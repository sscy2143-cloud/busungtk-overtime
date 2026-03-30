import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { OvertimeRequest } from '../types'
import { OVERTIME_TYPE_LABEL } from '../types'
import { StatusBadge } from '../components/common/StatusBadge'

const TODAY = new Date().toISOString().split('T')[0]
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
  extended: 'bg-primary-100 text-primary-700',
  night: 'bg-dark-100 text-dark-700',
  holiday: 'bg-primary-100 text-primary-700',
}

const FILTER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '대기중' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
]

export function RequestListPage() {
  const navigate = useNavigate()
  const { employee } = useAuth()
  const now = new Date()

  const [requests, setRequests] = useState<OvertimeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [detailReq, setDetailReq] = useState<OvertimeRequest | null>(null)
  const [showCalendar, setShowCalendar] = useState(false)
  const [listYear, setListYear] = useState(now.getFullYear())
  const [listMonth, setListMonth] = useState(now.getMonth() + 1)
  const [showAllMonths, setShowAllMonths] = useState(false)

  useEffect(() => {
    if (!employee?.id) return
    supabase
      .from('overtime_requests')
      .select('*, approver:employees!overtime_requests_approved_by_fkey(name, role)')
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

  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'manager_approved').length

  const filtered = useMemo(() => {
    // "전체" 필터이거나 showAllMonths이면 월 필터 무시
    let list = (filter === 'all' || showAllMonths)
      ? requests
      : requests.filter(r => r.date.startsWith(`${listYear}-${String(listMonth).padStart(2, '0')}`))
    if (filter === 'pending') return list.filter(r => r.status === 'pending' || r.status === 'manager_approved')
    if (filter !== 'all') return list.filter(r => r.status === filter)
    return list
  }, [requests, filter, listYear, listMonth, showAllMonths])

  // 캘린더
  const dayHoursMap = useMemo(() => {
    const map = new Map<string, { hours: number; reqs: OvertimeRequest[] }>()
    const prefix = `${listYear}-${String(listMonth).padStart(2, '0')}`
    requests
      .filter(r => r.status === 'approved' && r.date.startsWith(prefix))
      .forEach(r => {
        const h = calcHours(r.planned_start, r.planned_end)
        const existing = map.get(r.date)
        if (existing) { existing.hours += h; existing.reqs.push(r) }
        else map.set(r.date, { hours: h, reqs: [r] })
      })
    return map
  }, [requests, listYear, listMonth])

  const calDays = useMemo(() => {
    const firstDay = new Date(listYear, listMonth - 1, 1).getDay()
    const offset = firstDay === 0 ? 6 : firstDay - 1
    const lastDate = new Date(listYear, listMonth, 0).getDate()
    const cells: (number | null)[] = Array(offset).fill(null)
    for (let d = 1; d <= lastDate; d++) cells.push(d)
    return cells
  }, [listYear, listMonth])

  function dayKey(d: number) {
    return `${listYear}-${String(listMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-dark-400">불러오는 중...</p></div>

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark-900">근무 현황</h1>
          <p className="text-sm text-dark-400 mt-0.5">
            {now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
        <button
          onClick={() => navigate('/request')}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white text-sm font-semibold rounded-lg hover:bg-primary-600 transition-colors"
        >
          <Plus size={16} />
          연장근무 신청
        </button>
      </div>

      {/* 요약 띠 */}
      <div data-tour="work-summary" className="bg-white rounded-xl border border-dark-200 flex divide-x divide-dark-100 overflow-hidden">
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-dark-400 mb-0.5">금주 연장</p>
          <p className="text-lg font-bold text-primary-600">{weeklyHours.toFixed(1)}h</p>
        </div>
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-dark-400 mb-0.5">이번달 연장</p>
          <p className="text-lg font-bold text-primary-600">{monthlyHours.toFixed(1)}h</p>
        </div>
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-dark-400 mb-0.5">승인 대기</p>
          <p className="text-lg font-bold text-warning-600">{pendingCount}건</p>
        </div>
        <div className="flex-1 px-5 py-3.5">
          <p className="text-xs text-dark-400 mb-0.5">전체 신청</p>
          <p className="text-lg font-bold text-dark-700">{requests.length}건</p>
        </div>
      </div>

      {/* 월 선택 */}
      <div className="bg-white rounded-xl border border-dark-200">
        <div className="flex items-center justify-between px-4 py-2.5">
          <button
            onClick={() => { if (listMonth === 1) { setListYear(y => y - 1); setListMonth(12) } else setListMonth(m => m - 1); setShowAllMonths(false) }}
            className="p-1 rounded hover:bg-dark-100 transition-colors"
          >
            <ChevronLeft size={16} className="text-dark-500" />
          </button>
          <button
            onClick={() => setShowAllMonths(false)}
            className={`text-sm font-semibold ${showAllMonths ? 'text-dark-400' : 'text-dark-800'}`}
          >
            {listYear}년 {listMonth}월
          </button>
          <button
            onClick={() => { if (listYear === now.getFullYear() && listMonth === now.getMonth() + 1) return; if (listMonth === 12) { setListYear(y => y + 1); setListMonth(1) } else setListMonth(m => m + 1); setShowAllMonths(false) }}
            disabled={listYear === now.getFullYear() && listMonth === now.getMonth() + 1}
            className="p-1 rounded hover:bg-dark-100 disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} className="text-dark-500" />
          </button>
          <button
            onClick={() => setShowAllMonths(v => !v)}
            className={`ml-2 px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              showAllMonths
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-white text-dark-500 border-dark-200 hover:border-primary-300'
            }`}
          >
            전체
          </button>
        </div>
      </div>

      {/* 탭 + 캘린더 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {FILTER_TABS.map(tab => {
            const count = tab.key === 'all' ? requests.length
              : tab.key === 'pending' ? pendingCount
              : requests.filter(r => r.status === tab.key).length
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-colors ${
                  filter === tab.key
                    ? 'bg-primary-500 text-white border-primary-600'
                    : 'bg-white text-dark-500 border-dark-200 hover:border-dark-300'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 text-xs ${filter === tab.key ? 'text-primary-200' : 'text-dark-400'}`}>{count}</span>
              </button>
            )
          })}
        </div>
        <button
          onClick={() => setShowCalendar(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            showCalendar ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-dark-200 text-dark-500 hover:border-dark-300'
          }`}
        >
          <Calendar size={14} />
          캘린더
        </button>
      </div>

      {/* 캘린더 */}
      {showCalendar && (
        <div className="bg-white rounded-xl border border-dark-200 p-4">
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(d => (
              <div key={d} className={`text-center text-xs font-medium py-1 ${d === '토' ? 'text-dark-400' : d === '일' ? 'text-primary-400' : 'text-dark-400'}`}>
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {calDays.map((d, i) => {
              if (!d) return <div key={`empty-${i}`} />
              const dk = dayKey(d)
              const info = dayHoursMap.get(dk)
              const isToday = dk === TODAY
              const colIndex = i % 7
              return (
                <div
                  key={dk}
                  className={`min-h-[48px] rounded-lg p-1 flex flex-col ${isToday ? 'bg-primary-50 border border-primary-200' : 'hover:bg-dark-50'}`}
                >
                  <span className={`text-xs mb-0.5 ${isToday ? 'font-bold text-primary-700' : colIndex === 5 ? 'text-dark-400' : colIndex === 6 ? 'text-primary-400' : 'text-dark-500'}`}>
                    {d}
                  </span>
                  {info && (
                    <span className="text-xs font-semibold text-primary-600 bg-primary-100 rounded px-1 py-0.5 text-center">
                      {info.hours.toFixed(1)}h
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 테이블 */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-dark-200 py-16 text-center">
          <p className="text-sm text-dark-400">해당 내역이 없습니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-dark-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-dark-50 border-b border-dark-200">
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-dark-400 w-10">번호</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500 whitespace-nowrap">날짜</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500">유형</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500 whitespace-nowrap">근무시간</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-dark-500 whitespace-nowrap">시간</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500 hidden sm:table-cell">현장</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500 hidden md:table-cell">사유</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500 hidden lg:table-cell">기타</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-dark-500">상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((req, idx) => (
                <tr
                  key={req.id}
                  onClick={() => setDetailReq(req)}
                  className={`border-b border-dark-100 last:border-0 cursor-pointer transition-colors ${idx % 2 === 1 ? 'bg-dark-50/50' : 'bg-white'} hover:bg-primary-50/40`}
                >
                  <td className="px-3 py-2.5 text-center text-xs font-bold text-dark-300">{idx + 1}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-700 whitespace-nowrap">{formatDate(req.date)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${TYPE_COLOR[req.type]}`}>
                      {OVERTIME_TYPE_LABEL[req.type]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-dark-600 whitespace-nowrap">
                    {req.planned_start} ~ {req.planned_end}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs font-semibold text-dark-800">
                    {calcHours(req.planned_start, req.planned_end).toFixed(1)}h
                  </td>
                  <td className="px-3 py-2.5 text-xs text-dark-500 hidden sm:table-cell max-w-[100px] truncate">
                    {req.site_name ?? '-'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-dark-500 hidden md:table-cell max-w-[140px] truncate">
                    {req.reason ?? '-'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-dark-400 hidden lg:table-cell max-w-[140px] truncate">
                    {req.work_details ?? '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-primary-600 hover:underline cursor-pointer">더보기 →</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-dark-200 bg-dark-50">
                <td colSpan={6} className="px-3 py-2.5 text-xs font-semibold text-dark-500">
                  총 {filtered.length}건
                </td>
                <td className="px-3 py-2.5 text-center text-sm font-bold text-dark-800">
                  {filtered.filter(r => r.status === 'approved').reduce((s, r) => s + calcHours(r.planned_start, r.planned_end), 0).toFixed(1)}h
                </td>
                <td colSpan={2} className="px-3 py-2.5 text-xs text-dark-400 hidden sm:table-cell">승인 기준</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}


      {/* 상세 팝업 */}
      {detailReq && (() => {
        const req = detailReq
        const hours = calcHours(req.planned_start, req.planned_end).toFixed(1)
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDetailReq(null)} />
            <div className="relative bg-white rounded-2xl w-full max-w-md shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
                <h3 className="text-base font-bold text-dark-900">신청 상세</h3>
                <button onClick={() => setDetailReq(null)}><X size={18} className="text-dark-400" /></button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-dark-400">상태</span>
                  <StatusBadge status={req.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-dark-400">날짜</span>
                  <span className="text-sm text-dark-800">{formatDate(req.date)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-dark-400">유형</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                    {OVERTIME_TYPE_LABEL[req.type]}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-dark-400">근무시간</span>
                  <span className="text-sm text-dark-800">{req.planned_start} ~ {req.planned_end} <span className="font-bold text-dark-900">({hours}h)</span></span>
                </div>
                {req.site_name && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-dark-400">현장명</span>
                    <span className="text-sm text-dark-800">{req.site_name}</span>
                  </div>
                )}
                {req.work_details && (
                  <div>
                    <p className="text-xs text-dark-400 mb-1">작업내용</p>
                    <p className="text-sm text-dark-700 bg-dark-50 rounded-xl px-3 py-2">{req.work_details}</p>
                  </div>
                )}
                {req.reason && (
                  <div>
                    <p className="text-xs text-dark-400 mb-1">사유</p>
                    <p className="text-sm text-dark-700 bg-dark-50 rounded-xl px-3 py-2">{req.reason}</p>
                  </div>
                )}
                {(req as any).adjusted_by && (
                  <div className="bg-primary-50 border border-primary-100 rounded-xl px-3 py-2.5">
                    <p className="text-xs font-semibold text-primary-700 mb-1">근무시간 확인 안내</p>
                    {(req as any).original_start && (
                      <p className="text-xs text-dark-500">변경 전: {(req as any).original_start} ~ {(req as any).original_end}</p>
                    )}
                    <p className="text-xs text-dark-500">변경 후: {req.planned_start} ~ {req.planned_end}</p>
                    <p className="text-xs text-dark-600 mt-1">{(req as any).adjustment_reason}</p>
                  </div>
                )}
                <div className="pt-2 border-t border-dark-100">
                  <p className="text-xs text-dark-400 mb-2">승인 현황</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className={`text-xs px-3 py-2 rounded-lg text-center font-medium ${(req as any).manager_approved_at ? 'bg-success-50 text-success-700' : 'bg-dark-50 text-dark-300'}`}>
                      인사담당자<br />{(req as any).manager_approved_at ? '✓ 승인' : '미승인'}
                    </div>
                    <div className={`text-xs px-3 py-2 rounded-lg text-center font-medium ${req.approved_at ? 'bg-success-50 text-success-700' : 'bg-dark-50 text-dark-300'}`}>
                      대표<br />{req.approved_at ? '✓ 승인' : '미승인'}
                    </div>
                  </div>
                </div>
                {req.status === 'rejected' && req.rejection_reason && (
                  <div className="bg-danger-50 border border-danger-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs font-semibold text-danger-500 mb-1">반려 사유</p>
                    <p className="text-sm text-danger-700">{req.rejection_reason}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

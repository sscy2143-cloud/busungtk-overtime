import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, X, RefreshCw, ChevronRight, CalendarPlus, Calendar, ChevronLeft } from 'lucide-react'
import { StatusBadge } from '../components/common/StatusBadge'
import type { LeaveRequest, LeaveType, SubstituteHistory } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const CURRENT_YEAR = new Date().getFullYear()
const TODAY_LABEL = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '')

export function LeavePage() {
  const navigate = useNavigate()
  const { employee } = useAuth()
  const [balance, setBalance] = useState({
    total_days: 0, used_days: 0, remaining_days: 0,
    substitute_total: 0, substitute_used: 0,
  })
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [editModal, setEditModal] = useState<{
    open: boolean; id: string; type: LeaveType; start_date: string; end_date: string; reason: string
  }>({ open: false, id: '', type: 'annual', start_date: '', end_date: '', reason: '' })
  const [cancelModal, setCancelModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' })
  const [subHistoryModal, setSubHistoryModal] = useState<{ open: boolean; entries: SubstituteHistory[] }>({ open: false, entries: [] })
  const [subHistory, setSubHistory] = useState<(SubstituteHistory & {
    overtime_request?: { date: string; planned_start: string; planned_end: string; type: string; site_name: string | null; work_details: string | null; reason: string | null } | null
    granter?: { name: string } | null
  })[]>([])
  const [subDetailEntry, setSubDetailEntry] = useState<typeof subHistory[0] | null>(null)
  const [leaveHistoryModal, setLeaveHistoryModal] = useState(false)
  const [historyDetailMonth, setHistoryDetailMonth] = useState<{ monthKey: string; reqs: LeaveRequest[] } | null>(null)
  const [historyYear, setHistoryYear] = useState(CURRENT_YEAR)
  const [requestFilter, setRequestFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'>('pending')
  const [detailReq, setDetailReq] = useState<LeaveRequest | null>(null)
  const [adminApproved, setAdminApproved] = useState<{ at: string | null }>({ at: null })
  const [managerApproved, setManagerApproved] = useState<{ at: string | null }>({ at: null })
  const [showCalendar, setShowCalendar] = useState(false)
  const [calendarDate, setCalendarDate] = useState(() => new Date())

  useEffect(() => {
    if (!employee?.id) return
    fetchBalance()
    fetchRequests()
    fetchSubHistory()
  }, [employee?.id])

  // 상세 모달 열릴 때 승인 상태 설정
  useEffect(() => {
    setAdminApproved({ at: detailReq?.approved_at ?? null })
    setManagerApproved({ at: detailReq?.manager_approved_at ?? null })
  }, [detailReq])

  async function fetchSubHistory() {
    const { data, error } = await supabase
      .from('substitute_history')
      .select('*, overtime_request:overtime_requests!related_request_id(date, planned_start, planned_end, type, site_name, work_details, reason), granter:employees!granted_by(name)')
      .eq('employee_id', employee!.id)
      .order('created_at', { ascending: false })
    if (error) {
      void error
      // 조인 실패 시 기본 쿼리로 폴백
      const { data: fallback } = await supabase
        .from('substitute_history')
        .select('*')
        .eq('employee_id', employee!.id)
        .order('created_at', { ascending: false })
      if (fallback) setSubHistory(fallback as any)
    } else if (data) {
      setSubHistory(data as any)
    }
  }

  async function fetchBalance() {
    const { data } = await supabase
      .from('leave_balances')
      .select('total_days, used_days, remaining_days, substitute_total, substitute_used')
      .eq('employee_id', employee!.id)
      .eq('year', CURRENT_YEAR)
      .single()
    if (data) setBalance({
      total_days: data.total_days,
      used_days: data.used_days,
      remaining_days: data.remaining_days,
      substitute_total: data.substitute_total ?? 0,
      substitute_used: data.substitute_used ?? 0,
    })
  }

  async function fetchRequests() {
    const { data } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employee!.id)
      .order('created_at', { ascending: false })
    if (data) setRequests(data as LeaveRequest[])
  }


  function openEditModal(req: LeaveRequest) {
    setEditModal({ open: true, id: req.id, type: req.type, start_date: req.start_date, end_date: req.end_date, reason: req.reason })
  }

  async function handleEdit() {
    const { id, type, start_date, end_date, reason } = editModal
    const days = type.startsWith('half')
      ? 0.5
      : Math.max(1, Math.ceil((new Date(end_date).getTime() - new Date(start_date).getTime()) / 86400000) + 1)
    const { error } = await supabase
      .from('leave_requests')
      .update({ type, start_date, end_date, days, reason })
      .eq('id', id)
    if (!error) {
      setRequests((prev) => prev.map((r) => r.id === id ? { ...r, type, start_date, end_date, days, reason } : r))
    }
    setEditModal({ open: false, id: '', type: 'annual', start_date: '', end_date: '', reason: '' })
  }

  async function handleCancel() {
    const { id } = cancelModal
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: 'cancelled' as const })
      .eq('id', id)
    if (!error) {
      setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: 'cancelled' as const } : r))
    }
    setCancelModal({ open: false, id: '' })
  }

  const { total_days, used_days, remaining_days, substitute_total, substitute_used } = balance
  const usedPct = total_days > 0 ? Math.round((used_days / total_days) * 100) : 0
  const substituteRemaining = substitute_total - substitute_used

  const yearsOfService = employee?.created_at
    ? Math.max(1, Math.floor((Date.now() - new Date(employee.created_at).getTime()) / (365.25 * 24 * 3600 * 1000)) + 1)
    : 1

  // 연차내역 모달용: 선택 연도의 월별 사용 내역
  const historyRequests = requests.filter(
    (r) => r.status === 'approved' && r.start_date.startsWith(String(historyYear))
  )
  const monthlyHistory = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const monthKey = `${historyYear}-${mm}`
    const monthReqs = historyRequests.filter((r) => r.start_date.startsWith(monthKey))
    const usedDays = monthReqs.reduce((sum, r) => sum + r.days, 0)
    return { monthKey, usedDays, reqs: monthReqs }
  })

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">휴가현황</h1>
        <p className="text-sm text-gray-400 mt-0.5">{TODAY_LABEL}</p>
      </div>

      {/* 연차 현황 */}
      <div data-tour="leave-balance-card" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">연차 현황</h2>
          <span className="text-xs text-gray-400">{CURRENT_YEAR}-01-01 ~ {CURRENT_YEAR}-12-31 회계연도 기준</span>
        </div>

        {total_days === 0 ? (
          <p className="text-sm text-gray-400 py-2">아직 발생한 연차가 없습니다.</p>
        ) : (
          <div className="mb-3">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 rounded-full transition-all duration-500" style={{ width: `${usedPct}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1 text-right">연차 소진율 {usedPct}% ({used_days}/{total_days})</p>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 border-t border-gray-100 pt-3">
          {[
            { label: '잔여 연차', value: `${remaining_days}d`, color: 'text-warning-500' },
            { label: '사용 연차', value: `${used_days}d`, color: 'text-gray-700' },
            { label: '총 연차', value: `${total_days}d`, color: 'text-gray-700' },
            { label: '근속연수', value: `${yearsOfService}년차`, color: 'text-gray-700' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <p className={`text-base font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 신청 내역 */}
      <div data-tour="leave-requests" className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* 헤더 */}
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-900">신청 내역</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setHistoryYear(CURRENT_YEAR); setLeaveHistoryModal(true) }}
                className="flex items-center gap-0.5 text-xs text-primary-600 hover:underline"
              >
                연차내역 <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => navigate('/leave/request')}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-primary-600 text-white text-xs font-semibold rounded-lg hover:bg-primary-700 transition-colors"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                신청
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowCalendar(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${showCalendar ? 'bg-primary-100 text-primary-700' : 'text-gray-400 bg-gray-50 hover:bg-gray-100 hover:text-gray-600'}`}
          >
            <Calendar className="w-3.5 h-3.5" />
            캘린더
          </button>
        </div>

        {/* 캘린더 */}
        {showCalendar && (() => {
          const year = calendarDate.getFullYear()
          const month = calendarDate.getMonth()
          const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // 월요일 시작
          const daysInMonth = new Date(year, month + 1, 0).getDate()
          const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']
          const STATUS_COLOR: Record<string, string> = {
            pending: 'bg-primary-400',
            manager_approved: 'bg-yellow-400',
            approved: 'bg-green-400',
            rejected: 'bg-red-300',
            cancelled: 'bg-gray-300',
          }
          // 날짜 → 요청 목록 맵
          const dayMap = new Map<string, LeaveRequest[]>()
          requests.forEach((req) => {
            const s = new Date(req.start_date)
            const e = new Date(req.end_date)
            for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
              const key = d.toISOString().slice(0, 10)
              if (!dayMap.has(key)) dayMap.set(key, [])
              dayMap.get(key)!.push(req)
            }
          })
          const cells = Array(firstDow).fill(null).concat(
            Array.from({ length: daysInMonth }, (_, i) => i + 1)
          )
          while (cells.length % 7 !== 0) cells.push(null)
          return (
            <div className="border-b border-gray-100 px-3 pt-3 pb-4">
              {/* 월 네비게이션 */}
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setCalendarDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1 rounded hover:bg-gray-100">
                  <ChevronLeft className="w-4 h-4 text-gray-500" />
                </button>
                <span className="text-sm font-semibold text-gray-800">{year}년 {month + 1}월</span>
                <button onClick={() => setCalendarDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-1 rounded hover:bg-gray-100">
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </button>
              </div>
              {/* 요일 헤더 */}
              <div className="grid grid-cols-7 mb-1">
                {DAY_LABELS.map(d => (
                  <div key={d} className={`text-center text-xs font-medium py-1 ${d === '일' ? 'text-red-400' : d === '토' ? 'text-blue-400' : 'text-gray-400'}`}>{d}</div>
                ))}
              </div>
              {/* 날짜 */}
              <div className="grid grid-cols-7 gap-y-1">
                {cells.map((day, i) => {
                  if (!day) return <div key={`empty-${i}`} />
                  const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  const dayReqs = dayMap.get(dateKey) ?? []
                  const isToday = dateKey === new Date().toISOString().slice(0, 10)
                  const colIdx = i % 7
                  return (
                    <div
                      key={day}
                      onClick={() => dayReqs.length > 0 && setDetailReq(dayReqs[0])}
                      className={`flex flex-col items-center py-1 rounded-lg ${dayReqs.length > 0 ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    >
                      <span className={`text-xs w-6 h-6 flex items-center justify-center rounded-full font-medium
                        ${isToday ? 'bg-primary-500 text-white' : colIdx === 6 ? 'text-red-400' : colIdx === 5 ? 'text-blue-400' : 'text-gray-700'}`}>
                        {day}
                      </span>
                      {dayReqs.length > 0 && (
                        <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                          {dayReqs.slice(0, 2).map((r, ri) => (
                            <span key={ri} className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[r.status] ?? 'bg-gray-300'}`} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* 범례 */}
              <div className="flex gap-3 mt-3 flex-wrap">
                {[['대기중', 'bg-primary-400'], ['승인', 'bg-green-400'], ['반려', 'bg-red-300'], ['취소', 'bg-gray-300']].map(([label, cls]) => (
                  <div key={label} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${cls}`} />
                    <span className="text-xs text-gray-400">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* 2칸 레이아웃: 좌측 필터 탭 + 우측 리스트 */}
        <div className="flex min-h-[200px]">
          {/* 좌측: 필터 탭 */}
          <div className="w-20 shrink-0 border-r border-gray-100 flex flex-col">
            {([
              { key: 'all', label: '전체' },
              { key: 'pending', label: '대기중' },
              { key: 'approved', label: '승인' },
              { key: 'rejected', label: '반려' },
              { key: 'cancelled', label: '취소' },
            ] as const).map(({ key, label }) => {
              const count = key === 'all' ? requests.length : requests.filter(r => r.status === key).length
              return (
                <button
                  key={key}
                  onClick={() => setRequestFilter(key)}
                  className={`flex flex-col items-center justify-center py-4 text-xs font-medium transition-colors border-b border-gray-50 last:border-b-0 ${
                    requestFilter === key
                      ? 'bg-primary-50 text-primary-700 border-l-2 border-l-primary-500'
                      : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`mt-0.5 text-xs font-bold ${requestFilter === key ? 'text-primary-600' : 'text-gray-300'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* 우측: 리스트 */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {(() => {
              const filtered = requests
                .filter(r => requestFilter === 'all' || r.status === requestFilter)
                .sort((a, b) => b.created_at.localeCompare(a.created_at))

              if (filtered.length === 0) {
                return (
                  <div className="flex items-center justify-center h-full py-12">
                    <p className="text-xs text-gray-400">내역이 없습니다</p>
                  </div>
                )
              }

              return (
                <div className="divide-y divide-gray-50">
                  {filtered.map((req, idx) => (
                    <div
                      key={req.id}
                      className="px-3 py-3 flex items-start gap-2 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setDetailReq(req)}
                    >
                      <span className="shrink-0 text-sm font-bold text-gray-300 w-8 text-center self-center">{idx + 1}</span>
                      <div className="self-stretch w-px bg-gray-200 shrink-0 my-1" />
                      <div className="flex-1 min-w-0 flex items-start justify-between gap-4">
                        {/* 좌측: 유형 + 사유 */}
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-gray-800">{LEAVE_TYPE_LABEL[req.type]}</span>
                          {req.reason && (
                            <p className="text-xs text-gray-400 truncate mt-0.5">{req.reason}</p>
                          )}
                          {req.status === 'rejected' && (req as any).rejection_reason && (
                            <p className="text-xs text-danger-500 mt-0.5 truncate">반려: {(req as any).rejection_reason}</p>
                          )}
                        </div>
                        {/* 우측: 일수(위) + 날짜(아래) */}
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-gray-800">{req.days}일</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {req.start_date}{req.start_date !== req.end_date ? ` ~ ${req.end_date}` : ''}
                          </p>
                        </div>
                      </div>
                      {req.status === 'pending' && (
                        <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => openEditModal(req)} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => setCancelModal({ open: true, id: req.id })} className="p-1.5 text-danger-500 hover:bg-danger-50 rounded-lg transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* 대체휴가 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-teal-600" />
          <h2 className="text-sm font-semibold text-gray-700">대체휴가 현황</h2>
        </div>

        {/* 요약 */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
          {[
            { label: '총 부여', value: `${substitute_total}일`, color: substitute_total > 0 ? 'text-teal-600' : 'text-gray-300' },
            { label: '사용', value: `${substitute_used}일`, color: substitute_used > 0 ? 'text-warning-600' : 'text-gray-300' },
            { label: '잔여', value: `${substituteRemaining}일`, color: substituteRemaining > 0 ? 'text-teal-700 font-bold' : 'text-gray-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="py-3 text-center">
              <p className={`text-base font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* 부여 내역 */}
        {subHistory.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs text-gray-400">대체휴가 부여 내역이 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(() => {
              // FIFO: 오래된 부여 건부터 소진된 것으로 계산
              const sorted = [...subHistory].sort((a, b) => a.created_at.localeCompare(b.created_at))
              let remaining = substitute_used
              const statusMap = new Map<string, 'used' | 'partial' | 'unused'>()
              for (const entry of sorted) {
                if (remaining <= 0) statusMap.set(entry.id, 'unused')
                else if (remaining >= entry.granted_days) { statusMap.set(entry.id, 'used'); remaining -= entry.granted_days }
                else { statusMap.set(entry.id, 'partial'); remaining = 0 }
              }
              return subHistory.map((entry, idx) => {
                const ot = entry.overtime_request
                const status = statusMap.get(entry.id) ?? 'unused'
                return (
                  <div key={entry.id} className="px-3 py-3 flex items-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setSubDetailEntry(entry)}>
                    <span className="shrink-0 text-sm font-bold text-gray-300 w-8 text-center">{idx + 1}</span>
                    <div className="self-stretch w-px bg-gray-200 shrink-0 my-1" />
                    {/* 좌측: 제목 */}
                    <p className="text-sm font-semibold text-gray-800 truncate flex-1 min-w-0">
                      {(ot?.site_name || entry.reason || '-').replace(/\s*\([\d.]+[일h시간]+\)/g, '').trim()}
                    </p>
                    {/* 중앙: 부여량 + 시간 + 날짜 */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-teal-700">
                        +{entry.granted_days}일
                        {ot?.planned_start && ot?.planned_end && (
                          <span className="ml-1 text-xs font-medium text-teal-500">{ot.planned_start}~{ot.planned_end}</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(entry.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    {/* 우측: 상태 */}
                    <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${
                      status === 'used' ? 'bg-gray-100 text-gray-400' :
                      status === 'partial' ? 'bg-warning-50 text-warning-600' :
                      'bg-teal-50 text-teal-700'
                    }`}>
                      {status === 'used' ? '소진완료' : status === 'partial' ? '일부소진' : '미소진'}
                    </span>
                  </div>
                )
              })
            })()}
          </div>
        )}
      </div>

      {/* 대체휴가 상세 모달 */}
      {subDetailEntry && (() => {
        const e = subDetailEntry
        const ot = e.overtime_request
        const TYPE_LABEL: Record<string, string> = { extended: '연장근무', night: '야간근무', holiday: '휴일근무' }
        const calcHours = (s: string, end: string) => {
          const [sh, sm] = s.split(':').map(Number)
          const [eh, em] = end.split(':').map(Number)
          let mins = (eh * 60 + em) - (sh * 60 + sm)
          if (mins < 0) mins += 24 * 60
          return (mins / 60).toFixed(1)
        }
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSubDetailEntry(null)} />
            <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="text-base font-bold text-gray-900">대체휴가 상세</h3>
                <button onClick={() => setSubDetailEntry(null)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
              <div className="px-5 py-4 space-y-3">
                {/* 부여 정보 */}
                <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-teal-600 font-medium mb-0.5">부여 일수</p>
                    <p className="text-2xl font-bold text-teal-700">+{e.granted_days}일</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">처리일</p>
                    <p className="text-sm text-gray-700 font-medium">
                      {new Date(e.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    {e.granter?.name && (
                      <p className="text-xs text-gray-400 mt-0.5">처리자: {e.granter.name}</p>
                    )}
                  </div>
                </div>

                {/* 연결된 야근 신청 */}
                {ot ? (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 mb-1.5">연결된 야근 신청</p>
                    <div className="bg-gray-50 rounded-xl p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">날짜</span>
                        <span className="font-medium text-gray-800">{ot.date}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">시간</span>
                        <span className="font-medium text-gray-800">
                          {ot.planned_start} ~ {ot.planned_end}
                          <span className="ml-1 text-primary-600">({calcHours(ot.planned_start, ot.planned_end)}h)</span>
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">유형</span>
                        <span className="font-medium text-gray-800">{TYPE_LABEL[ot.type] ?? ot.type}</span>
                      </div>
                      {ot.site_name && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">현장</span>
                          <span className="font-medium text-gray-800 text-right max-w-[180px]">{ot.site_name}</span>
                        </div>
                      )}
                    </div>
                    {ot.work_details && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-400 mb-1">작업내용 상세</p>
                        <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2">{ot.work_details}</p>
                      </div>
                    )}
                    {ot.reason && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-400 mb-1">기타</p>
                        <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2">{ot.reason}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 mb-1.5">사유</p>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2">{e.reason}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* 수정 모달 */}
      {editModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">휴가 신청 수정</h3>
              <button onClick={() => setEditModal((p) => ({ ...p, open: false }))}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">유형</label>
                <select
                  value={editModal.type}
                  onChange={(e) => setEditModal((p) => ({ ...p, type: e.target.value as LeaveType }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  {Object.entries(LEAVE_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">시작일</label>
                  <input type="date" value={editModal.start_date}
                    onChange={(e) => setEditModal((p) => ({ ...p, start_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">종료일</label>
                  <input type="date" value={editModal.end_date}
                    onChange={(e) => setEditModal((p) => ({ ...p, end_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">사유</label>
                <textarea value={editModal.reason}
                  onChange={(e) => setEditModal((p) => ({ ...p, reason: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
                취소
              </button>
              <button onClick={handleEdit} disabled={!editModal.start_date || !editModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors">
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 취소 확인 모달 */}
      {cancelModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCancelModal({ open: false, id: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">휴가 신청 취소</h3>
              <button onClick={() => setCancelModal({ open: false, id: '' })}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">이 휴가 신청을 취소하시겠습니까?</p>
            <div className="flex gap-2">
              <button onClick={() => setCancelModal({ open: false, id: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
                돌아가기
              </button>
              <button onClick={handleCancel}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors">
                취소하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 연차내역 모달 */}
      {leaveHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setLeaveHistoryModal(false)} />
          <div className="relative bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <h3 className="text-base font-bold text-gray-900">연차내역</h3>
              <button onClick={() => setLeaveHistoryModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {/* 연도 네비게이션 */}
            <div className="flex items-center justify-center gap-4 px-5 py-3 border-b border-gray-100 shrink-0">
              <button
                onClick={() => setHistoryYear((y) => y - 1)}
                className="p-1 rounded hover:bg-gray-100 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-gray-500 rotate-180" />
              </button>
              <span className="text-sm font-semibold text-gray-800">
                {historyYear}-01-01 ~ {historyYear}-12-31
              </span>
              <button
                onClick={() => setHistoryYear((y) => y + 1)}
                disabled={historyYear >= CURRENT_YEAR}
                className="p-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* 연차 현황 요약 (해당 연도) */}
            <div className="px-5 py-4 border-b border-gray-100 shrink-0">
              <p className="text-xs font-semibold text-gray-500 mb-3">잔여연차</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '잔여 연차', value: historyYear === CURRENT_YEAR ? `${remaining_days}d` : '-', color: 'text-primary-600' },
                  { label: '사용 연차', value: historyYear === CURRENT_YEAR ? `${used_days}d` : `${historyRequests.reduce((s, r) => s + r.days, 0)}d`, color: 'text-warning-600' },
                  { label: '총 연차', value: historyYear === CURRENT_YEAR ? `${total_days}d` : '-', color: 'text-gray-700' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center bg-gray-50 rounded-xl py-3">
                    <p className={`text-lg font-bold ${color}`}>{value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 월별 사용 내역 테이블 */}
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">연월</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">사용 일수</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">내역</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {monthlyHistory.map(({ monthKey, usedDays, reqs }) => {
                    const isThisMonth = monthKey === `${CURRENT_YEAR}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
                    return (
                      <tr
                        key={monthKey}
                        onClick={() => reqs.length > 0 && setHistoryDetailMonth({ monthKey, reqs })}
                        className={`transition-colors ${reqs.length > 0 ? 'cursor-pointer hover:bg-primary-50/30' : ''} ${isThisMonth ? 'bg-primary-50/40' : ''}`}
                      >
                        <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                          {monthKey}
                          {isThisMonth && (
                            <span className="ml-1.5 text-xs text-primary-600 font-semibold">이번달</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={usedDays > 0 ? 'text-warning-600 font-semibold' : 'text-gray-400'}>
                            {usedDays > 0 ? `${usedDays}일` : '0일'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {reqs.length > 0 ? (
                            <div className="grid grid-cols-2 gap-1">
                              {reqs.map((r) => (
                                <span key={r.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-center truncate">
                                  {LEAVE_TYPE_LABEL[r.type]} {r.days}일
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 월별 신청내역 상세 모달 */}
      {historyDetailMonth && (() => {
        const { monthKey, reqs } = historyDetailMonth
        return (
          <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setHistoryDetailMonth(null)} />
            <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
                <div>
                  <h3 className="text-base font-bold text-gray-900">{monthKey} 신청내역</h3>
                  <p className="text-xs text-gray-400 mt-0.5">총 {reqs.reduce((s, r) => s + r.days, 0)}일 사용</p>
                </div>
                <button onClick={() => setHistoryDetailMonth(null)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
              <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
                {reqs.map((req) => {
                  const isSpecial = req.type === 'special'
                  const [specialSubType, specialNote] = isSpecial && req.reason?.includes(' / ')
                    ? [req.reason.split(' / ')[0], req.reason.split(' / ').slice(1).join(' / ')]
                    : ['', req.reason ?? '']
                  const displayReason = isSpecial ? specialNote : req.reason
                  return (
                    <div key={req.id} className="bg-gray-50 rounded-xl p-4 space-y-2.5">
                      {/* 상태 + 유형 */}
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold text-gray-800">{LEAVE_TYPE_LABEL[req.type]}</span>
                          {isSpecial && specialSubType && (
                            <p className="text-xs text-gray-500 mt-0.5">{specialSubType}</p>
                          )}
                        </div>
                        <StatusBadge status={req.status} />
                      </div>
                      {/* 기간 / 일수 */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">기간</span>
                        <span className="text-gray-800 font-medium">
                          {req.start_date}{req.start_date !== req.end_date ? ` ~ ${req.end_date}` : ''}
                          <span className="ml-1 text-primary-600 font-semibold">({req.days}일)</span>
                        </span>
                      </div>
                      {/* 사유 */}
                      {displayReason && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">신청 사유</p>
                          <p className="text-xs text-gray-700 bg-white rounded-lg px-3 py-2 border border-gray-100">{displayReason}</p>
                        </div>
                      )}
                      {/* 승인 정보 */}
                      {req.status === 'approved' && req.approved_at && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-400">승인일</span>
                          <span className="text-gray-600">
                            {new Date(req.approved_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                          </span>
                        </div>
                      )}
                      {/* 반려 사유 */}
                      {req.status === 'rejected' && (req as any).rejection_reason && (
                        <div className="bg-danger-50 rounded-lg px-3 py-2">
                          <p className="text-xs text-danger-500 font-medium">반려 사유</p>
                          <p className="text-xs text-danger-700 mt-0.5">{(req as any).rejection_reason}</p>
                        </div>
                      )}
                      {/* 대체휴가 차감 여부 */}
                      {req.use_substitute && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-medium">대체휴가 차감</span>
                        </div>
                      )}
                      {/* 신청일 */}
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-200">
                        <span className="text-gray-400">신청일</span>
                        <span className="text-gray-500">
                          {new Date(req.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}

      {/* 신청 상세 모달 */}
      {detailReq && (() => {
        const isApproved = detailReq.status === 'approved'
        const isSpecial = detailReq.type === 'special'
        const [specialSubType, specialNote] = isSpecial && detailReq.reason
          ? detailReq.reason.includes(' / ')
            ? [detailReq.reason.split(' / ')[0], detailReq.reason.split(' / ').slice(1).join(' / ')]
            : [detailReq.reason, '']
          : ['', detailReq.reason]
        const displayReason = isSpecial ? specialNote : detailReq.reason
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDetailReq(null)} />
            <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="text-base font-bold text-gray-900">휴가 신청 상세</h3>
                <button onClick={() => setDetailReq(null)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">상태</span>
                  <StatusBadge status={detailReq.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">휴가 종류</span>
                  <div className="text-right">
                    <span className="text-sm font-medium text-gray-800">{LEAVE_TYPE_LABEL[detailReq.type]}</span>
                    {isSpecial && specialSubType && (
                      <p className="text-xs text-gray-500 mt-0.5">{specialSubType}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">기간</span>
                  <span className="text-sm text-gray-800">
                    {detailReq.start_date}{detailReq.start_date !== detailReq.end_date && ` ~ ${detailReq.end_date}`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">일수</span>
                  <span className="text-sm font-semibold text-gray-800">{detailReq.days}일</span>
                </div>
                {displayReason && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">신청 사유</p>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2">{displayReason}</p>
                  </div>
                )}
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-400 mb-3">승인현황</p>
                  <div className="space-y-2">
                    {/* 대표 */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 font-medium">대표</span>
                      {detailReq.status === 'rejected' ? (
                        <span className="text-danger-500 font-semibold">반려</span>
                      ) : adminApproved.at ? (
                        <span className="text-success-600 font-semibold">승인완료</span>
                      ) : (
                        <span className="text-gray-400">미승인</span>
                      )}
                    </div>
                    {adminApproved.at && (
                      <p className="text-xs text-gray-400 text-right -mt-1">
                        {new Date(adminApproved.at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    )}
                    {/* 인사담당자 */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 font-medium">인사담당자</span>
                      {detailReq.status === 'rejected' ? (
                        <span className="text-danger-500 font-semibold">반려</span>
                      ) : managerApproved.at ? (
                        <span className="text-success-600 font-semibold">승인완료</span>
                      ) : (
                        <span className="text-gray-400">미승인</span>
                      )}
                    </div>
                    {managerApproved.at && (
                      <p className="text-xs text-gray-400 text-right -mt-1">
                        {new Date(managerApproved.at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>
                {detailReq.status === 'rejected' && (detailReq as any).rejection_reason && (
                  <div className="bg-danger-50 rounded-xl px-3 py-2">
                    <p className="text-xs text-danger-500 font-medium">반려 사유</p>
                    <p className="text-sm text-danger-700 mt-0.5">{(detailReq as any).rejection_reason}</p>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-gray-400">신청일</span>
                  <span className="text-xs text-gray-500">
                    {new Date(detailReq.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                </div>
              </div>
              {detailReq.status === 'pending' && (
                <div className="flex gap-2 px-5 pb-5">
                  <button
                    onClick={() => { setDetailReq(null); openEditModal(detailReq) }}
                    className="flex-1 py-2.5 text-sm font-medium text-primary-600 border border-primary-300 rounded-xl hover:bg-primary-50 transition-colors"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => { setDetailReq(null); setCancelModal({ open: true, id: detailReq.id }) }}
                    className="flex-1 py-2.5 text-sm font-medium text-danger-600 border border-danger-300 rounded-xl hover:bg-danger-50 transition-colors"
                  >
                    취소
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* 대체휴가 부여 이력 모달 */}
      {subHistoryModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSubHistoryModal({ open: false, entries: [] })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-teal-600" />대체휴가 부여 이력
              </h3>
              <button onClick={() => setSubHistoryModal({ open: false, entries: [] })}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {subHistoryModal.entries.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">부여 이력이 없습니다</p>
            ) : (
              <div className="space-y-3">
                {subHistoryModal.entries.map((entry) => (
                  <div key={entry.id} className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-teal-700">+{entry.granted_days}일</span>
                      <span className="text-xs text-gray-400">
                        {new Date(entry.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">{entry.reason}</p>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setSubHistoryModal({ open: false, entries: [] })}
              className="w-full mt-4 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

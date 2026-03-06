import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, X, RefreshCw, ChevronRight } from 'lucide-react'
import { StatusBadge } from '../components/common/StatusBadge'
import type { LeaveRequest, LeaveType, SubstituteHistory } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const TODAY = new Date().toISOString().split('T')[0]
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
  const [selectedLeaveType, setSelectedLeaveType] = useState<LeaveType>('annual')
  const [editModal, setEditModal] = useState<{
    open: boolean; id: string; type: LeaveType; start_date: string; end_date: string; reason: string
  }>({ open: false, id: '', type: 'annual', start_date: '', end_date: '', reason: '' })
  const [cancelModal, setCancelModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' })
  const [subHistoryModal, setSubHistoryModal] = useState<{ open: boolean; entries: SubstituteHistory[] }>({ open: false, entries: [] })
  const [leaveHistoryModal, setLeaveHistoryModal] = useState(false)
  const [historyYear, setHistoryYear] = useState(CURRENT_YEAR)

  useEffect(() => {
    if (!employee?.id) return
    fetchBalance()
    fetchRequests()
  }, [employee?.id])

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

  async function openSubstituteHistory() {
    const { data } = await supabase
      .from('substitute_history')
      .select('*')
      .eq('employee_id', employee!.id)
      .order('created_at', { ascending: false })
    setSubHistoryModal({ open: true, entries: (data ?? []) as SubstituteHistory[] })
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

  const upcoming = requests.filter(
    (r) => r.status === 'pending' || (r.status === 'approved' && r.end_date >= TODAY)
  )
  const past = requests.filter(
    (r) => r.status === 'cancelled' || r.status === 'rejected' || (r.status === 'approved' && r.end_date < TODAY)
  )

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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
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

      {/* 대체휴가 */}
      {substitute_total > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-teal-600" />
              <h2 className="text-sm font-semibold text-gray-700">대체휴가</h2>
            </div>
            <button onClick={openSubstituteHistory} className="text-xs text-primary-600 hover:underline">
              부여 이력
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '총 부여', value: `${substitute_total}일`, color: 'text-gray-700' },
              { label: '사용', value: `${substitute_used}일`, color: 'text-warning-600' },
              { label: '잔여', value: `${substituteRemaining}일`, color: 'text-teal-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className={`text-base font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 휴가신청 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">휴가신청</h2>
        <div className="flex gap-2">
          <select
            value={selectedLeaveType}
            onChange={(e) => setSelectedLeaveType(e.target.value as LeaveType)}
            className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
          >
            {Object.entries(LEAVE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => navigate(`/leave/request?type=${selectedLeaveType}`)}
            className="px-4 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 active:bg-primary-800 transition-colors whitespace-nowrap"
          >
            신청하기
          </button>
        </div>
      </div>

      {/* 예정휴가 + 지난휴가 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 예정휴가 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">예정휴가</h2>
          </div>
          {upcoming.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-gray-400">예정된 휴가가 없습니다</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">상태</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">휴가종류</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">일수</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">기간</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {upcoming.map((req) => (
                    <tr key={req.id}>
                      <td className="px-3 py-2"><StatusBadge status={req.status} /></td>
                      <td className="px-3 py-2 text-gray-700">{LEAVE_TYPE_LABEL[req.type]}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{req.days}일</td>
                      <td className="px-3 py-2 text-gray-500">
                        {req.start_date}{req.start_date !== req.end_date && ` ~ ${req.end_date}`}
                      </td>
                      <td className="px-3 py-2">
                        {req.status === 'pending' && (
                          <div className="flex gap-1">
                            <button onClick={() => openEditModal(req)} className="p-1 text-primary-600 hover:bg-primary-50 rounded">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button onClick={() => setCancelModal({ open: true, id: req.id })} className="p-1 text-danger-500 hover:bg-danger-50 rounded">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 지난휴가 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">지난휴가</h2>
            <button
              onClick={() => { setHistoryYear(CURRENT_YEAR); setLeaveHistoryModal(true) }}
              className="flex items-center gap-0.5 text-xs text-primary-600 hover:underline"
            >
              더보기 <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {past.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-gray-400">지난 휴가가 없습니다</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">상태</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">휴가종류</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">일수</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">기간</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {past.map((req) => (
                    <tr key={req.id}>
                      <td className="px-3 py-2"><StatusBadge status={req.status} /></td>
                      <td className="px-3 py-2 text-gray-700">{LEAVE_TYPE_LABEL[req.type]}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{req.days}일</td>
                      <td className="px-3 py-2 text-gray-500">
                        {req.start_date}{req.start_date !== req.end_date && ` ~ ${req.end_date}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
              <p className="text-xs font-semibold text-gray-500 mb-3">연차현황</p>
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
                  {monthlyHistory.map(({ monthKey, usedDays, reqs }) => (
                    <tr key={monthKey} className={monthKey === `${CURRENT_YEAR}-${String(new Date().getMonth() + 1).padStart(2, '0')}` ? 'bg-primary-50/40' : ''}>
                      <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                        {monthKey}
                        {monthKey === `${CURRENT_YEAR}-${String(new Date().getMonth() + 1).padStart(2, '0')}` && (
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
                          <div className="flex flex-wrap gap-1">
                            {reqs.map((r) => (
                              <span key={r.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                {LEAVE_TYPE_LABEL[r.type]} {r.days}일
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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

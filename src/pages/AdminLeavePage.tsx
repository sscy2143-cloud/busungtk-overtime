import { useState, useEffect, useMemo } from 'react'
import { X, Trash2, CheckSquare } from 'lucide-react'
import type { LeaveRequest } from '../types'
import { LEAVE_TYPE_LABEL } from '../types'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { StatusBadge } from '../components/common/StatusBadge'

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  manager_approved: '1차 승인',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-warning-600',
  manager_approved: 'text-primary-600',
  approved: 'text-success-600',
  rejected: 'text-danger-600',
  cancelled: 'text-dark-400',
}

const LEAVE_TYPE_COLOR: Record<string, string> = {
  annual: 'bg-primary-50 text-primary-700',
  half_am: 'bg-purple-50 text-purple-700',
  half_pm: 'bg-purple-50 text-purple-700',
  special: 'bg-dark-100 text-dark-700',
}

export function AdminLeavePage() {
  const { employee } = useAuth()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listFilter, setListFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'danger' } | null>(null)

  function showToast(message: string, type: 'success' | 'danger') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2000)
  }
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: string; reason: string }>({ open: false, id: '', reason: '' })
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; id: string; employeeName: string; days: number; status: string }>({ open: false, id: '', employeeName: '', days: 0, status: '' })
  const [detailModal, setDetailModal] = useState<{ open: boolean; request: LeaveRequest | null }>({ open: false, request: null })
  const [approveModal, setApproveModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' })

  const currentYear = new Date().getFullYear()

  useEffect(() => {
    fetchLeaveRequests()
  }, [])

  async function fetchLeaveRequests() {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*, employee:employees!leave_requests_employee_id_fkey(id, name, department)')
      .order('created_at', { ascending: false })

    if (!error && data) {
      const mapped = data as LeaveRequest[]
      setRequests(mapped)
      setSelectedId(prev => {
        if (prev === null) return null
        // If current selection is no longer pending, advance to next pending
        const current = mapped.find(r => r.id === prev)
        if (current && current.status !== 'pending' && current.status !== 'manager_approved') {
          const nextPending = mapped.find(r => r.id !== prev && (r.status === 'pending' || r.status === 'manager_approved'))
          return nextPending ? nextPending.id : null
        }
        return prev
      })
    }
  }

  async function handleApprove(id: string) {
    const req = requests.find((r) => r.id === id)
    if (!req) return

    const now = new Date().toISOString()

    const myRole = employee?.role
    const updateFields: Record<string, unknown> = {}

    if (myRole === 'admin') {
      // 이미 대표 승인했으면 무시
      if (req.approved_at) return
      updateFields.approved_by = employee?.id ?? null
      updateFields.approved_at = now
      updateFields.status = req.manager_approved_at ? 'approved' : 'manager_approved'
    } else {
      // 이미 인사담당자 승인했으면 무시
      if (req.manager_approved_at) return
      updateFields.manager_approved_by = employee?.id ?? null
      updateFields.manager_approved_at = now
      updateFields.status = req.approved_at ? 'approved' : 'manager_approved'
    }

    const { error: reqErr } = await supabase
      .from('leave_requests')
      .update(updateFields)
      .eq('id', id)

    if (reqErr) {
      console.error('연차 승인 실패:', reqErr.message)
      alert('승인 처리에 실패했습니다: ' + reqErr.message)
      return
    }

    // 둘 다 승인 완료 시에만 연차 잔여일수 차감
    if (updateFields.status === 'approved') {
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('used_days, substitute_used, substitute_total')
        .eq('employee_id', req.employee_id)
        .eq('year', currentYear)
        .single()

      if (bal) {
        if (req.use_substitute) {
          await supabase
            .from('leave_balances')
            .update({ substitute_used: Number(bal.substitute_used) + Number(req.days) })
            .eq('employee_id', req.employee_id)
            .eq('year', currentYear)
        } else {
          await supabase
            .from('leave_balances')
            .update({ used_days: Number(bal.used_days) + Number(req.days) })
            .eq('employee_id', req.employee_id)
            .eq('year', currentYear)
        }
      }
    }

    // DB에서 최신 데이터 다시 가져오기
    await fetchLeaveRequests()
    showToast('승인 처리되었습니다', 'success')
  }

  function openReject(id: string) {
    setRejectModal({ open: true, id, reason: '' })
  }

  async function confirmReject() {
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: 'rejected', rejection_reason: rejectModal.reason })
      .eq('id', rejectModal.id)

    const rejectedId = rejectModal.id
    const rejectedReason = rejectModal.reason
    if (!error) {
      setRequests((prev) => {
        const updated = prev.map((r) => r.id === rejectedId ? { ...r, status: 'rejected' as const, rejection_reason: rejectedReason } : r)
        const nextPending = updated.find(r => r.id !== rejectedId && (r.status === 'pending' || r.status === 'manager_approved'))
        if (nextPending) setSelectedId(nextPending.id)
        return updated
      })
      showToast('반려 처리되었습니다', 'danger')
    }
    setRejectModal({ open: false, id: '', reason: '' })
  }

  async function confirmDelete() {
    const { id, status, days } = deleteModal
    const req = requests.find((r) => r.id === id)

    if (status === 'approved' && req) {
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('used_days, substitute_used')
        .eq('employee_id', req.employee_id)
        .eq('year', currentYear)
        .single()

      if (bal) {
        if (req.use_substitute) {
          await supabase
            .from('leave_balances')
            .update({ substitute_used: Math.max(0, Number(bal.substitute_used) - Number(days)) })
            .eq('employee_id', req.employee_id)
            .eq('year', currentYear)
        } else {
          await supabase
            .from('leave_balances')
            .update({ used_days: Math.max(0, Number(bal.used_days) - Number(days)) })
            .eq('employee_id', req.employee_id)
            .eq('year', currentYear)
        }
      }
    }

    const { error } = await supabase.from('leave_requests').delete().eq('id', id)
    if (!error) {
      setRequests((prev) => prev.filter((r) => r.id !== id))
      if (selectedId === id) setSelectedId(null)
    }
    setDeleteModal({ open: false, id: '', employeeName: '', days: 0, status: '' })
  }

  // list filter counts
  const countAll = requests.length
  const countPending = requests.filter(r => r.status === 'pending' || r.status === 'manager_approved').length
  const countApproved = requests.filter(r => r.status === 'approved').length
  const countRejected = requests.filter(r => r.status === 'rejected').length

  const listFilteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (listFilter === 'pending') return r.status === 'pending' || r.status === 'manager_approved'
      if (listFilter === 'approved') return r.status === 'approved'
      if (listFilter === 'rejected') return r.status === 'rejected'
      return true
    })
  }, [requests, listFilter])

  const selectedReq = selectedId ? requests.find(r => r.id === selectedId) ?? null : null

  return (
    <div className="flex flex-col h-full min-h-0 space-y-3">
      {/* 페이지 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-dark-900">연차 관리</h1>
        <p className="text-sm text-dark-500 mt-0.5">연차 신청을 검토하고 처리하세요</p>
      </div>

      {/* 승인 대기 배너 */}
      {countPending > 0 && (
        <div className="flex items-center gap-3 bg-warning-50 border border-warning-200 rounded-xl px-4 py-3 shrink-0">
          <span className="text-2xl font-black text-warning-600">{countPending}</span>
          <span className="text-sm font-semibold text-warning-700">건의 연차 신청이 승인 대기 중입니다</span>
        </div>
      )}

      {/* KakaoWork-style split panel */}
      <div className="flex flex-col lg:flex-row gap-0 bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden flex-1 min-h-0" style={{ minHeight: '520px' }}>

        {/* LEFT PANEL: list */}
        <div className={`flex flex-col lg:w-80 lg:min-w-[320px] lg:max-w-xs border-b lg:border-b-0 lg:border-r border-dark-100 ${selectedId ? 'hidden lg:flex' : 'flex'}`}>

          {/* Tab filter */}
          <div className="px-3 pt-3 pb-2 border-b border-dark-100 shrink-0">
            <div className="flex gap-1.5">
              {(
                [
                  { key: 'all', label: '전체', count: countAll },
                  { key: 'pending', label: '대기중', count: countPending },
                  { key: 'approved', label: '승인', count: countApproved },
                  { key: 'rejected', label: '반려', count: countRejected },
                ] as const
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setListFilter(key)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    listFilter === key
                      ? 'bg-primary-500 text-white border-primary-600'
                      : 'bg-white text-dark-500 border-dark-200 hover:border-dark-300'
                  }`}
                >
                  {label}
                  <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full leading-none ${
                    listFilter === key ? 'bg-white/30 text-white' : 'bg-dark-100 text-dark-500'
                  }`}>{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* List items */}
          <div className="flex-1 overflow-y-auto divide-y divide-dark-50">
            {listFilteredRequests.length === 0 ? (
              <p className="text-center text-sm text-dark-400 py-10">해당 건이 없습니다</p>
            ) : (
              listFilteredRequests.map((req) => {
                const isSelected = selectedId === req.id
                return (
                  <button
                    key={req.id}
                    onClick={() => setSelectedId(req.id)}
                    className={`w-full text-left px-4 py-3 transition-colors relative ${
                      isSelected
                        ? 'bg-primary-50 border-l-2 border-primary-500'
                        : 'hover:bg-dark-50/60 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-dark-900 truncate">
                          {req.employee?.name ?? '-'}
                        </p>
                        <p className="text-xs text-dark-500 mt-0.5 truncate">
                          {req.start_date}{req.start_date !== req.end_date ? ` ~ ${req.end_date}` : ''} · {req.days}일
                        </p>
                        <p className="text-xs text-dark-400 mt-0.5 truncate">
                          <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${LEAVE_TYPE_COLOR[req.type] ?? ''}`}>
                            {LEAVE_TYPE_LABEL[req.type] ?? req.type}
                          </span>
                        </p>
                        {req.manager_approved_at && (
                          <span className="inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-success-50 text-success-700 border border-success-200">인사확인</span>
                        )}
                      </div>
                      <span className={`text-[11px] font-semibold shrink-0 mt-0.5 ${STATUS_COLOR[req.status] ?? 'text-dark-500'}`}>
                        {STATUS_LABEL[req.status] ?? req.status}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL: detail + actions */}
        <div className={`flex-1 flex flex-col min-w-0 ${selectedId ? 'flex' : 'hidden lg:flex'}`}>
          {selectedReq ? (() => {
            const req = selectedReq
            const emp = req.employee
            return (
              <div className="flex flex-col h-full">
                {/* Detail header */}
                <div className="px-5 py-4 border-b border-dark-100 flex items-start justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Back button on mobile */}
                    <button
                      onClick={() => setSelectedId(null)}
                      className="lg:hidden shrink-0 p-1.5 rounded-lg hover:bg-dark-100 text-dark-500"
                      aria-label="목록으로"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-base font-bold text-dark-900">{emp?.name ?? '-'}</p>
                        {emp?.department && (
                          <span className="text-xs text-dark-500 bg-dark-100 px-2 py-0.5 rounded-full">{emp.department}</span>
                        )}
                        <StatusBadge status={req.status} />
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setDetailModal({ open: true, request: req })}
                    className="shrink-0 flex items-center gap-1 text-xs text-dark-500 hover:text-dark-700 border border-dark-200 rounded-lg px-2.5 py-1.5 hover:bg-dark-50 transition-colors"
                  >
                    상세보기
                  </button>
                </div>

                {/* Detail fields */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2.5 text-sm">
                    <span className="text-dark-500 font-medium pt-0.5">신청자</span>
                    <span className="text-dark-900 font-semibold">{emp?.name ?? '-'}</span>

                    <span className="text-dark-500 font-medium pt-0.5">유형</span>
                    <span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEAVE_TYPE_COLOR[req.type] ?? 'bg-dark-100 text-dark-700'}`}>
                        {LEAVE_TYPE_LABEL[req.type] ?? req.type}
                      </span>
                    </span>

                    <span className="text-dark-500 font-medium pt-0.5">시작일</span>
                    <span className="text-dark-900">{req.start_date}</span>

                    <span className="text-dark-500 font-medium pt-0.5">종료일</span>
                    <span className="text-dark-900">{req.end_date}</span>

                    <span className="text-dark-500 font-medium pt-0.5">일수</span>
                    <span className="text-dark-900 font-bold">{req.days}일</span>

                    {req.use_substitute && (
                      <>
                        <span className="text-dark-500 font-medium pt-0.5">차감 구분</span>
                        <span>
                          <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium">대체휴가 차감</span>
                        </span>
                      </>
                    )}

                    {req.reason && (
                      <>
                        <span className="text-dark-500 font-medium pt-0.5">사유</span>
                        <span className="text-dark-800 whitespace-pre-wrap">{req.reason}</span>
                      </>
                    )}

                    <span className="text-dark-500 font-medium pt-0.5">상태</span>
                    <span>
                      <StatusBadge status={req.status} />
                    </span>

                    <span className="text-dark-500 font-medium pt-0.5">대표</span>
                    <span className={`text-xs font-semibold ${req.approved_at ? 'text-success-600' : 'text-dark-400'}`}>
                      {req.approved_at ? '승인완료' : '미승인'}
                      {req.approved_at && (
                        <span className="text-dark-400 font-normal ml-1">
                          {new Date(req.approved_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </span>

                    <span className="text-dark-500 font-medium pt-0.5">인사담당</span>
                    <span className={`text-xs font-semibold ${req.manager_approved_at ? 'text-success-600' : 'text-dark-400'}`}>
                      {req.manager_approved_at ? '승인완료' : '미승인'}
                      {req.manager_approved_at && (
                        <span className="text-dark-400 font-normal ml-1">
                          {new Date(req.manager_approved_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </span>

                    <span className="text-dark-500 font-medium pt-0.5">신청일시</span>
                    <span className="text-dark-800 text-xs">
                      {new Date(req.created_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>

                    {req.status === 'rejected' && req.rejection_reason && (
                      <>
                        <span className="text-danger-600 font-medium pt-0.5">반려사유</span>
                        <span className="text-danger-600">{req.rejection_reason}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="px-5 py-4 border-t border-dark-100 flex flex-col gap-2 shrink-0">
                  {(req.status === 'pending' || req.status === 'manager_approved') && (
                    <>
                      <button
                        onClick={() => setApproveModal({ open: true, id: req.id })}
                        className="w-full flex items-center justify-center gap-2 py-3.5 text-base font-bold text-white bg-success-500 rounded-xl hover:bg-success-600 transition-colors"
                      >
                        <CheckSquare className="w-5 h-5" />
                        승인
                      </button>
                      <button
                        onClick={() => openReject(req.id)}
                        className="w-full flex items-center justify-center gap-2 py-3.5 text-base font-bold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors"
                      >
                        <X className="w-5 h-5" />
                        반려
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setDeleteModal({ open: true, id: req.id, employeeName: emp?.name ?? '', days: req.days, status: req.status })}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium text-danger-600 border border-danger-200 rounded-xl hover:bg-danger-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    삭제
                  </button>
                </div>
              </div>
            )
          })() : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
              <div className="w-12 h-12 rounded-2xl bg-dark-100 flex items-center justify-center mb-3">
                <CheckSquare className="w-6 h-6 text-dark-400" />
              </div>
              <p className="text-sm font-medium text-dark-500">신청 건을 선택하세요</p>
              <p className="text-xs text-dark-400 mt-1">왼쪽 목록에서 항목을 클릭하면 상세 내용이 표시됩니다</p>
            </div>
          )}
        </div>
      </div>

      {/* 상세 보기 모달 (공문 스타일) */}
      {detailModal.open && detailModal.request && (() => {
        const req = detailModal.request
        const dayOfWeek = req.start_date ? ['일', '월', '화', '수', '목', '금', '토'][new Date(req.start_date).getDay()] : ''
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDetailModal({ open: false, request: null })} />
            <div className="relative bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
              {/* 공문 헤더 */}
              <div className="bg-dark-800 text-white px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-dark-300 tracking-widest">부성티케이</p>
                    <h3 className="text-base font-bold mt-0.5">연차 신청서</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-dark-300">문서번호</p>
                    <p className="text-xs font-mono text-dark-200">{req.id.slice(0, 8).toUpperCase()}</p>
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* 신청자 정보 */}
                <div>
                  <p className="text-xs font-semibold text-dark-500 mb-2 tracking-wider">신청자 정보</p>
                  <div className="border border-dark-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium w-24">성명</td>
                          <td className="px-3 py-2 text-dark-800 font-medium">{req.employee?.name ?? '-'}</td>
                        </tr>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">부서</td>
                          <td className="px-3 py-2 text-dark-800">{req.employee?.department ?? '-'}</td>
                        </tr>
                        <tr>
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">신청일시</td>
                          <td className="px-3 py-2 text-dark-800">
                            {new Date(req.created_at).toLocaleString('ko-KR', {
                              year: 'numeric', month: '2-digit', day: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 연차 내용 */}
                <div>
                  <p className="text-xs font-semibold text-dark-500 mb-2 tracking-wider">연차 내용</p>
                  <div className="border border-dark-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium w-24">유형</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${LEAVE_TYPE_COLOR[req.type] ?? ''}`}>
                              {LEAVE_TYPE_LABEL[req.type] ?? req.type}
                            </span>
                          </td>
                        </tr>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">기간</td>
                          <td className="px-3 py-2 text-dark-800">
                            {req.start_date} ({dayOfWeek})
                            {req.start_date !== req.end_date && ` ~ ${req.end_date}`}
                          </td>
                        </tr>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">일수</td>
                          <td className="px-3 py-2 text-dark-800 font-bold">{req.days}일</td>
                        </tr>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">사유</td>
                          <td className="px-3 py-2 text-dark-800">{req.reason || '-'}</td>
                        </tr>
                        {req.use_substitute && (
                          <tr>
                            <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">차감 구분</td>
                            <td className="px-3 py-2">
                              <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium">대체휴가 차감</span>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 처리 현황 */}
                <div>
                  <p className="text-xs font-semibold text-dark-500 mb-2 tracking-wider">처리 현황</p>
                  <div className="border border-dark-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium w-24">상태</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                              req.status === 'approved' ? 'bg-success-50 text-success-700 border-success-200' :
                              req.status === 'rejected' ? 'bg-danger-50 text-danger-700 border-danger-200' :
                              req.status === 'pending' ? 'bg-warning-50 text-warning-700 border-warning-200' :
                              'bg-dark-50 text-dark-600 border-dark-200'
                            }`}>
                              {STATUS_LABEL[req.status] ?? req.status}
                            </span>
                          </td>
                        </tr>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">대표</td>
                          <td className={`px-3 py-2 text-xs font-semibold ${req.approved_at ? 'text-success-600' : 'text-dark-400'}`}>
                            {req.approved_at ? '승인완료' : '미승인'}
                            {req.approved_at && (
                              <span className="text-dark-400 font-normal ml-1">
                                {new Date(req.approved_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </td>
                        </tr>
                        <tr className="border-b border-dark-100">
                          <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">인사담당</td>
                          <td className={`px-3 py-2 text-xs font-semibold ${req.manager_approved_at ? 'text-success-600' : 'text-dark-400'}`}>
                            {req.manager_approved_at ? '승인완료' : '미승인'}
                            {req.manager_approved_at && (
                              <span className="text-dark-400 font-normal ml-1">
                                {new Date(req.manager_approved_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </td>
                        </tr>
                        {req.rejection_reason && (
                          <tr>
                            <td className="bg-dark-50 px-3 py-2 text-xs text-dark-500 font-medium">반려 사유</td>
                            <td className="px-3 py-2 text-danger-700 text-xs">{req.rejection_reason}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 대기중이면 승인/반려 버튼 */}
                {(req.status === 'pending' || req.status === 'manager_approved') && (
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        setDetailModal({ open: false, request: null })
                        setApproveModal({ open: true, id: req.id })
                      }}
                      className="flex-1 py-2.5 text-sm font-semibold text-white bg-success-500 rounded-xl hover:bg-success-600 transition-colors"
                    >
                      승인
                    </button>
                    <button
                      onClick={() => {
                        setDetailModal({ open: false, request: null })
                        openReject(req.id)
                      }}
                      className="flex-1 py-2.5 text-sm font-semibold text-danger-600 border border-danger-300 rounded-xl hover:bg-danger-50 transition-colors"
                    >
                      반려
                    </button>
                    <button
                      onClick={() => {
                        setDetailModal({ open: false, request: null })
                        setDeleteModal({ open: true, id: req.id, employeeName: req.employee?.name ?? '', days: req.days, status: req.status })
                      }}
                      className="px-3 py-2.5 text-danger-400 hover:text-danger-600 border border-danger-200 rounded-xl hover:bg-danger-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* 닫기 */}
              <button
                onClick={() => setDetailModal({ open: false, request: null })}
                className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        )
      })()}

      {/* 토스트 메시지 */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold text-white transition-all ${
          toast.type === 'success' ? 'bg-success-500' : 'bg-danger-500'
        }`}>
          {toast.message}
        </div>
      )}

      {/* 승인 확인 모달 */}
      {approveModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setApproveModal({ open: false, id: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">승인 확인</h3>
              <button onClick={() => setApproveModal({ open: false, id: '' })}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-sm text-dark-600 mb-5">이 연차 신청을 승인하시겠습니까?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setApproveModal({ open: false, id: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={() => {
                  const id = approveModal.id
                  setApproveModal({ open: false, id: '' })
                  handleApprove(id)
                }}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-success-500 rounded-xl hover:bg-success-600 transition-colors"
              >
                승인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 반려 모달 */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRejectModal({ open: false, id: '', reason: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">반려 사유 입력</h3>
              <button onClick={() => setRejectModal({ open: false, id: '', reason: '' })}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <textarea
              className="w-full border border-dark-200 rounded-xl px-3 py-2.5 text-sm text-dark-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              rows={3}
              placeholder="반려 사유를 입력하세요"
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRejectModal({ open: false, id: '', reason: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmReject}
                disabled={!rejectModal.reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 disabled:opacity-40 transition-colors"
              >
                반려
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">연차 신청 삭제</h3>
              <button onClick={() => setDeleteModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-sm text-dark-600 mb-1">
              <span className="font-semibold">{deleteModal.employeeName}</span>의 연차 신청({deleteModal.days}일)을 삭제하시겠습니까?
            </p>
            {deleteModal.status === 'approved' && (
              <p className="text-xs text-warning-600 bg-warning-50 rounded-lg px-3 py-2 mt-2">
                승인된 건이므로 삭제 시 잔여 연차가 복원됩니다.
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setDeleteModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

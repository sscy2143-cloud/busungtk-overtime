import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilePlus, CalendarPlus, Clock, Download, X, Eye, Lock, ShieldCheck, Bell, HelpCircle, ChevronRight, TrendingUp, Calendar, Briefcase } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { StatusBadge } from '../components/common/StatusBadge'

import type { RequestStatus, OvertimeType, LeaveType } from '../types'
import { OVERTIME_TYPE_LABEL, LEAVE_TYPE_LABEL } from '../types'


// 주간 근무시간 게이지 (카카오워크 스타일)
function WeeklyGauge({ hours, max }: { hours: number; max: number }) {
  const pct = Math.min((hours / max) * 100, 100)

  const barColor =
    hours >= 12 ? 'bg-dark-900' :
    hours >= 10 ? 'bg-primary-700' :
    hours >= 8 ? 'bg-primary-500' :
    'bg-primary-300'

  const textColor =
    hours >= 12 ? 'text-dark-900' :
    hours >= 8 ? 'text-primary-600' :
    'text-primary-400'

  return (
    <div>
      <div className="flex items-end gap-2 mb-4">
        <span className={`text-[2.5rem] leading-none font-extrabold tabular-nums ${textColor}`}>
          {hours.toFixed(1)}
        </span>
        <span className="text-sm text-dark-400 font-medium pb-1">/ {max}시간</span>
      </div>

      <div className="relative h-2.5 bg-dark-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between mt-2 text-xs text-dark-400">
        <span>0h</span>
        <span>8h</span>
        <span>10h</span>
        <span>{max}h</span>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { employee, user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = employee?.role === 'manager' || employee?.role === 'admin'

  const maxHours = 12
  const [weeklyHours, setWeeklyHours] = useState(0)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [recentRequests, setRecentRequests] = useState<{ id: string; kind: 'overtime' | 'leave'; type: OvertimeType | LeaveType; date: string; status: RequestStatus; created_at: string }[]>([])
  const [leave, setLeave] = useState({ total: 0, used: 0, remaining: 0 })
  const [notices, setNotices] = useState<{ id: string; title: string; category: string; created_at: string }[]>([])
  const [payslips, setPayslips] = useState<{ id: string; period: string; file_path: string; file_name: string; message: string | null; work_start: string | null; work_end: string | null }[]>([])
  const [payslipModal, setPayslipModal] = useState<{ slip: typeof payslips[number]; signedUrl: string } | null>(null)
  const [payslipVerified, setPayslipVerified] = useState(false)
  const [payslipVerifyModal, setPayslipVerifyModal] = useState<typeof payslips[number] | null>(null)
  const [verifyEmail, setVerifyEmail] = useState('')
  const [verifyError, setVerifyError] = useState('')
  const [unconfirmedExpenses, setUnconfirmedExpenses] = useState<{ id: string; amount: number; paid_at: string }[]>([])
  const [showConfirmAlert, setShowConfirmAlert] = useState(false)

  useEffect(() => {
    if (!employee?.id) return

    async function fetchData() {
      const now = new Date()
      const day = now.getDay()
      const monday = new Date(now)
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const weekStart = monday.toISOString().split('T')[0]
      const weekEnd = sunday.toISOString().split('T')[0]

      const { data: weekOt } = await supabase
        .from('overtime_requests')
        .select('planned_start, planned_end')
        .eq('employee_id', employee!.id)
        .eq('status', 'approved')
        .gte('date', weekStart)
        .lte('date', weekEnd)

      if (weekOt) {
        let totalHours = 0
        for (const row of weekOt) {
          const [sh, sm] = row.planned_start.split(':').map(Number)
          const [eh, em] = row.planned_end.split(':').map(Number)
          let mins = (eh * 60 + em) - (sh * 60 + sm)
          if (mins < 0) mins += 24 * 60
          totalHours += mins / 60
        }
        setWeeklyHours(totalHours)
      }

      const [{ data: recentOt }, { data: recentLeave }] = await Promise.all([
        supabase
          .from('overtime_requests')
          .select('id, type, date, status, created_at')
          .eq('employee_id', employee!.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('leave_requests')
          .select('id, type, start_date, status, created_at')
          .eq('employee_id', employee!.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      const combined = [
        ...(recentOt ?? []).map((r) => ({ id: r.id, kind: 'overtime' as const, type: r.type as OvertimeType, date: r.date, status: r.status as RequestStatus, created_at: r.created_at })),
        ...(recentLeave ?? []).map((r) => ({ id: r.id, kind: 'leave' as const, type: r.type as LeaveType, date: r.start_date, status: r.status as RequestStatus, created_at: r.created_at })),
      ]
      combined.sort((a, b) => b.created_at.localeCompare(a.created_at))
      setRecentRequests(combined.slice(0, 5))

      const currentYear = new Date().getFullYear()
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('total_days, used_days, remaining_days')
        .eq('employee_id', employee!.id)
        .eq('year', currentYear)
        .single()

      if (bal) {
        setLeave({ total: bal.total_days, used: bal.used_days, remaining: bal.remaining_days })
      }

      const { data: slipData } = await supabase
        .from('payslips')
        .select('id, period, file_path, file_name, message, work_start, work_end')
        .eq('employee_id', employee!.id)
        .order('period', { ascending: false })
        .limit(12)
      if (slipData) setPayslips(slipData)

      const { data: noticeData } = await supabase
        .from('notices')
        .select('id, title, category, created_at')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(50)
      if (noticeData) setNotices(noticeData)

      const { data: unconfirmed } = await supabase
        .from('expenses')
        .select('id, amount, paid_at')
        .eq('employee_id', employee!.id)
        .not('paid_at', 'is', null)
        .is('employee_confirmed_at', null)
      if (unconfirmed && unconfirmed.length > 0) {
        setUnconfirmedExpenses(unconfirmed)
        setShowConfirmAlert(true)
      }

      if (employee!.role === 'admin' || employee!.role === 'manager') {
        const { count } = await supabase
          .from('overtime_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
        setPendingApprovals(count ?? 0)
      }
    }

    fetchData()
  }, [employee?.id])

  const leavePct = leave.total > 0 ? (leave.remaining / leave.total) * 100 : 0

  return (
    <div className="space-y-5">

      {/* ── 히어로 영역: 인사 + 날짜 ── */}
      <div className="bg-white rounded-2xl px-6 py-6 relative overflow-hidden border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        {/* 장식 원 */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary-500/10 rounded-full" />
        <div className="absolute -bottom-8 -right-20 w-32 h-32 bg-primary-500/5 rounded-full" />

        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-dark-400 text-sm mb-1">
              {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
            <h1 className="text-xl font-bold text-dark-900">
              {employee?.name ?? '사용자'}님, 안녕하세요
            </h1>
            <p className="text-dark-400 text-sm mt-1">
              {employee?.department || '부성티케이'} · {employee?.role === 'admin' ? '관리자' : employee?.role === 'manager' ? '인사담당' : '직원'}
            </p>
          </div>
          <button
            onClick={() => navigate('/guide')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-dark-400 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-colors"
            title="이용 가이드"
          >
            <HelpCircle size={14} />
            <span className="hidden sm:inline">가이드</span>
          </button>
        </div>
      </div>

      {/* ── 관리자 승인 대기 배너 ── */}
      {isAdmin && pendingApprovals > 0 && (
        <div
          className="flex items-center gap-3 bg-primary-50 border border-primary-200 rounded-xl px-4 py-3.5 cursor-pointer hover:bg-primary-100 transition-colors group"
          onClick={() => navigate('/admin/approvals')}
        >
          <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Bell size={16} className="text-white" />
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold text-dark-800">
              승인 대기 <strong className="text-primary-600">{pendingApprovals}건</strong>
            </span>
            <p className="text-xs text-dark-400">확인이 필요한 신청이 있습니다</p>
          </div>
          <ChevronRight size={16} className="text-dark-300 group-hover:text-primary-500 transition-colors" />
        </div>
      )}

      {/* ── 경비 수령확인 배너 ── */}
      {unconfirmedExpenses.length > 0 && (
        <div
          className="flex items-center gap-3 bg-primary-50 border border-primary-200 rounded-xl px-4 py-3.5 cursor-pointer hover:bg-primary-100 transition-colors group"
          onClick={() => navigate('/expenses')}
        >
          <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Briefcase size={16} className="text-white" />
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold text-dark-800">
              수령 확인 <strong className="text-primary-600">{unconfirmedExpenses.length}건</strong>
            </span>
            <p className="text-xs text-dark-400">지급 완료된 경비의 수령 확인이 필요합니다</p>
          </div>
          <ChevronRight size={16} className="text-dark-300 group-hover:text-primary-500 transition-colors" />
        </div>
      )}

      {/* ── 핵심 지표 카드 2개 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 금주 연장근무 */}
        <div data-tour="weekly-hours" className="bg-white rounded-2xl p-6 border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center">
              <TrendingUp size={14} className="text-primary-500" />
            </div>
            <h2 className="text-sm font-bold text-dark-700">금주 연장근무</h2>
          </div>
          <WeeklyGauge hours={weeklyHours} max={maxHours} />
        </div>

        {/* 잔여 연차 */}
        <div data-tour="leave-balance" className="bg-white rounded-2xl p-6 border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center">
              <Calendar size={14} className="text-primary-500" />
            </div>
            <h2 className="text-sm font-bold text-dark-700">잔여 연차</h2>
          </div>

          <div className="flex items-end gap-2 mb-4">
            <span className="text-[2.5rem] leading-none font-extrabold text-dark-900 tabular-nums">
              {leave.remaining}
            </span>
            <span className="text-sm text-dark-400 font-medium pb-1">/ {leave.total}일</span>
          </div>

          <div className="h-2.5 bg-dark-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-400 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${leavePct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-dark-400 mt-2">
            <span>사용 {leave.used}일</span>
            <span>잔여 {leave.remaining}일</span>
          </div>
        </div>
      </div>

      {/* ── 빠른 액션 ── */}
      <div data-tour="quick-actions" className="grid grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/request')}
          className="group flex flex-col items-center justify-center gap-2 bg-white hover:bg-primary-50 text-dark-800 font-semibold text-sm py-5 rounded-xl border border-dark-100 transition-all shadow-sm"
        >
          <div className="w-9 h-9 bg-primary-50 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
            <FilePlus size={18} className="text-primary-500" />
          </div>
          연장근무 신청
        </button>
        <button
          onClick={() => navigate('/leave/request')}
          className="group flex flex-col items-center justify-center gap-2 bg-white hover:bg-primary-50 text-dark-800 font-semibold text-sm py-5 rounded-xl border border-dark-100 transition-all shadow-sm"
        >
          <div className="w-9 h-9 bg-primary-50 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
            <CalendarPlus size={18} className="text-primary-500" />
          </div>
          휴가 신청
        </button>
        <button
          onClick={() => navigate('/timesheet')}
          className="group flex flex-col items-center justify-center gap-2 bg-white hover:bg-primary-50 text-dark-800 font-semibold text-sm py-5 rounded-xl border border-dark-100 transition-all shadow-sm"
        >
          <div className="w-9 h-9 bg-primary-50 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
            <Clock size={18} className="text-primary-500" />
          </div>
          근무 기록
        </button>
      </div>

      {/* ── 최근 제출 ── */}
      <div data-tour="recent-requests" className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50">
          <h2 className="text-sm font-bold text-dark-700">최근 제출</h2>
          <button
            className="text-xs font-medium text-primary-500 hover:text-primary-600 transition-colors"
            onClick={() => navigate('/requests')}
          >
            전체 보기
          </button>
        </div>

        {recentRequests.length === 0 ? (
          <p className="text-sm text-dark-300 text-center py-10">제출 내역이 없습니다.</p>
        ) : (
          <ul>
            {recentRequests.map((req, i) => (
              <li
                key={req.id}
                className={`flex items-center justify-between px-6 py-3.5 hover:bg-dark-50/50 transition-colors ${i < recentRequests.length - 1 ? 'border-b border-dark-50' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    req.kind === 'overtime' ? 'bg-primary-400' : 'bg-dark-300'
                  }`} />
                  <div>
                    <p className="text-sm font-medium text-dark-800">
                      {req.kind === 'overtime'
                        ? OVERTIME_TYPE_LABEL[req.type as OvertimeType]
                        : LEAVE_TYPE_LABEL[req.type as LeaveType]}
                    </p>
                    <p className="text-xs text-dark-400 mt-0.5">
                      {new Date(req.date).toLocaleDateString('ko-KR', {
                        month: 'long', day: 'numeric', weekday: 'short'
                      })}
                    </p>
                  </div>
                </div>
                <StatusBadge status={req.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 공지사항 + 급여명세서 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 공지사항 */}
        <div data-tour="notices" className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50">
            <h2 className="text-sm font-bold text-dark-700">공지사항</h2>
            {notices.length > 0 && (
              <button onClick={() => navigate('/notices')} className="text-xs font-medium text-primary-500 hover:text-primary-600 transition-colors">
                전체보기
              </button>
            )}
          </div>
          {notices.length === 0 ? (
            <p className="text-sm text-dark-300 text-center py-10">등록된 공지사항이 없습니다.</p>
          ) : (
            <ul>
              {notices.slice(0, 3).map((n, i) => (
                <li key={n.id} className={`flex items-center gap-3 px-6 py-3.5 hover:bg-dark-50/50 transition-colors ${i < Math.min(notices.length, 3) - 1 ? 'border-b border-dark-50' : ''}`}>
                  <span className={`flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    n.category === '업데이트' ? 'bg-dark-100 text-dark-600' :
                    n.category === '공지' ? 'bg-primary-50 text-primary-600' :
                    'bg-primary-50 text-primary-500'
                  }`}>
                    {n.category}
                  </span>
                  <span className="flex-1 text-sm text-dark-700 truncate">{n.title}</span>
                  <span className="flex-shrink-0 text-xs text-dark-300">
                    {new Date(n.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\. /g, '/').replace('.', '')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 급여명세서 */}
        <div data-tour="payslips" className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50">
            <h2 className="text-sm font-bold text-dark-700">급여명세서</h2>
            {payslips.length > 0 && (
              <button onClick={() => navigate('/payslips')} className="text-xs font-medium text-primary-500 hover:text-primary-600 transition-colors">
                전체보기
              </button>
            )}
          </div>
          {payslips.length === 0 ? (
            <p className="text-sm text-dark-300 text-center py-10">등록된 급여명세서가 없습니다.</p>
          ) : (
            <ul>
              {payslips.slice(0, 3).map((slip, i) => {
                const [y, m] = slip.period.split('-')
                return (
                  <li key={slip.id} className={`flex items-center justify-between px-6 py-3.5 hover:bg-dark-50/50 transition-colors ${i < Math.min(payslips.length, 3) - 1 ? 'border-b border-dark-50' : ''}`}>
                    <div>
                      <p className="text-sm font-semibold text-dark-800">{y}년 {parseInt(m)}월</p>
                      <p className="text-xs text-dark-400 mt-0.5">{slip.file_name}</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (!payslipVerified) {
                          setPayslipVerifyModal(slip)
                          return
                        }
                        const { data } = await supabase.storage.from('payslips').createSignedUrl(slip.file_path, 300)
                        if (data?.signedUrl) setPayslipModal({ slip, signedUrl: data.signedUrl })
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-500 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
                    >
                      <Eye size={12} />
                      보기
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── 급여명세서 상세 팝업 ── */}
      {payslipModal && (() => {
        const { slip, signedUrl } = payslipModal
        const [y, m] = slip.period.split('-')
        const isPdf = slip.file_name.toLowerCase().endsWith('.pdf')
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPayslipModal(null)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-dark-100">
                <h3 className="text-base font-bold text-dark-900">급여명세서 상세</h3>
                <button onClick={() => setPayslipModal(null)} className="p-1.5 hover:bg-dark-100 rounded-lg transition-colors">
                  <X size={18} className="text-dark-400" />
                </button>
              </div>

              <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
                <div className="w-full md:w-72 flex-shrink-0 p-6 border-b md:border-b-0 md:border-r border-dark-100 space-y-4 overflow-y-auto">
                  <div>
                    <p className="text-xs font-medium text-dark-400 mb-1">지급월</p>
                    <p className="text-lg font-bold text-dark-900">{y}년 {parseInt(m)}월</p>
                  </div>
                  {slip.work_start && slip.work_end && (
                    <div>
                      <p className="text-xs font-medium text-dark-400 mb-1">실근로일</p>
                      <p className="text-sm text-dark-700">{slip.work_start} ~ {slip.work_end}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium text-dark-400 mb-1">파일명</p>
                    <p className="text-sm text-dark-700">{slip.file_name}</p>
                  </div>
                  {slip.message && (
                    <div>
                      <p className="text-xs font-medium text-dark-400 mb-1">전달 문구</p>
                      <p className="text-sm text-primary-700 bg-primary-50 rounded-lg p-3">{slip.message}</p>
                    </div>
                  )}
                  <button
                    onClick={() => window.open(signedUrl, '_blank', 'noopener,noreferrer')}
                    className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
                  >
                    <Download size={14} />
                    다운로드
                  </button>
                </div>

                <div className="flex-1 bg-dark-50 flex items-center justify-center p-4 min-h-[400px]">
                  {isPdf ? (
                    <iframe
                      src={signedUrl}
                      className="w-full h-full min-h-[500px] rounded-lg border border-dark-200"
                      title="PDF 미리보기"
                    />
                  ) : (
                    <img
                      src={signedUrl}
                      alt="급여명세서"
                      className="max-w-full max-h-[70vh] rounded-lg shadow-sm object-contain"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 경비 수령확인 알림 팝업 ── */}
      {showConfirmAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowConfirmAlert(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center">
                <Bell size={28} className="text-primary-500" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-dark-900 mb-2">수령 확인 필요</h3>
            <p className="text-sm text-dark-500 mb-1">
              지급 완료된 경비 <strong className="text-primary-500">{unconfirmedExpenses.length}건</strong>의
            </p>
            <p className="text-sm text-dark-500 mb-6">수령 확인이 필요합니다.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirmAlert(false)}
                className="flex-1 py-2.5 text-sm font-medium text-dark-500 bg-dark-50 rounded-xl hover:bg-dark-100 transition-colors"
              >
                나중에
              </button>
              <button
                onClick={() => { setShowConfirmAlert(false); navigate('/expenses') }}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
              >
                확인하러 가기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 급여명세서 본인 확인 팝업 ── */}
      {payslipVerifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setPayslipVerifyModal(null); setVerifyEmail(''); setVerifyError('') }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 bg-dark-100 rounded-2xl flex items-center justify-center">
                <Lock size={28} className="text-dark-600" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-dark-900 mb-1">본인 확인</h3>
            <p className="text-sm text-dark-400 mb-6">
              급여명세서 열람을 위해<br />로그인 이메일을 입력해주세요.
            </p>
            <form onSubmit={async (e) => {
              e.preventDefault()
              const userEmail = user?.email?.toLowerCase().trim()
              if (!userEmail) return
              if (verifyEmail.toLowerCase().trim() === userEmail) {
                setPayslipVerified(true)
                setVerifyError('')
                const slip = payslipVerifyModal
                setPayslipVerifyModal(null)
                setVerifyEmail('')
                const { data } = await supabase.storage.from('payslips').createSignedUrl(slip.file_path, 300)
                if (data?.signedUrl) setPayslipModal({ slip, signedUrl: data.signedUrl })
              } else {
                setVerifyError('이메일이 일치하지 않습니다.')
              }
            }} className="space-y-3">
              <input
                type="email"
                value={verifyEmail}
                onChange={e => { setVerifyEmail(e.target.value); setVerifyError('') }}
                placeholder="example@gmail.com"
                className="w-full px-4 py-3 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 text-center"
                autoFocus
              />
              {verifyError && (
                <p className="text-xs text-danger-500 font-medium">{verifyError}</p>
              )}
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
              >
                <ShieldCheck size={16} />
                확인
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

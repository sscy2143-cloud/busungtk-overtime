import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilePlus, CalendarPlus, AlertCircle, Clock, Download, X, Eye, Lock, ShieldCheck, Bell, HelpCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { StatusBadge } from '../components/common/StatusBadge'

import type { RequestStatus, OvertimeType, LeaveType } from '../types'
import { OVERTIME_TYPE_LABEL, LEAVE_TYPE_LABEL } from '../types'


// 주간 근무시간 게이지 (인라인 컴포넌트)
function WeeklyGauge({ hours, max }: { hours: number; max: number }) {
  const pct = Math.min((hours / max) * 100, 100)

  // 구간별 색상
  const barColor =
    hours >= 12 ? 'bg-danger-600' :
    hours >= 10 ? 'bg-danger-400' :
    hours >= 8 ? 'bg-warning-500' :
    'bg-success-500'

  const labelColor =
    hours >= 12 ? 'text-danger-600' :
    hours >= 8 ? 'text-warning-500' :
    'text-success-600'

  // 구간 마커 위치 (%)
  const markers = [
    { pct: (8 / max) * 100, label: '8h' },
    { pct: (10 / max) * 100, label: '10h' },
  ]

  return (
    <div>
      <div className="flex items-baseline gap-1 mb-3">
        <span className={`text-4xl font-bold tabular-nums ${labelColor}`}>
          {hours.toFixed(1)}
        </span>
        <span className="text-sm text-gray-400 font-medium">/ {max}시간 (주간 연장)</span>
      </div>

      {/* 바 */}
      <div className="relative h-3 bg-gray-100 rounded-full overflow-visible">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
        {/* 마커 */}
        {markers.map((m) => (
          <div
            key={m.label}
            className="absolute top-0 bottom-0 w-px bg-gray-300"
            style={{ left: `${m.pct}%` }}
          />
        ))}
      </div>

      {/* 구간 레이블 */}
      <div className="flex justify-between mt-1.5 text-xs text-gray-400">
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
      // 금주 근무시간 계산
      const now = new Date()
      const day = now.getDay() // 0=Sun, 1=Mon...
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

      // 최근 제출 (본인) - 야근 + 휴가 합산
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

      // 잔여 연차
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

      // 급여명세서
      const { data: slipData } = await supabase
        .from('payslips')
        .select('id, period, file_path, file_name, message, work_start, work_end')
        .eq('employee_id', employee!.id)
        .order('period', { ascending: false })
        .limit(12)
      if (slipData) setPayslips(slipData)

      // 공지사항
      const { data: noticeData } = await supabase
        .from('notices')
        .select('id, title, category, created_at')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(50)
      if (noticeData) setNotices(noticeData)

      // 수령확인 대기 경비
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

      // 관리자: 승인 대기 건수
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

  return (
    <div className="space-y-4">
      {/* 인사 */}
      <div data-tour="greeting" className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            안녕하세요, <span className="text-primary-600">{employee?.name ?? '사용자'}님</span>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
        <button
          onClick={() => navigate('/guide')}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
          title="이용 가이드"
        >
          <HelpCircle size={14} />
          <span className="hidden sm:inline">가이드</span>
        </button>
      </div>

      {/* 관리자 승인 대기 배너 */}
      {isAdmin && pendingApprovals > 0 && (
        <div
          className="flex items-center gap-3 bg-warning-50 border border-warning-400 rounded-xl px-4 py-3 cursor-pointer hover:bg-yellow-100 transition-colors"
          onClick={() => navigate('/admin/approvals')}
        >
          <AlertCircle size={18} className="text-warning-500 flex-shrink-0" />
          <span className="text-sm font-medium text-yellow-800">
            승인 대기 중인 신청이 <strong>{pendingApprovals}건</strong> 있습니다
          </span>
          <span className="ml-auto text-xs text-yellow-600">확인 →</span>
        </div>
      )}

      {/* 경비 수령확인 배너 */}
      {unconfirmedExpenses.length > 0 && (
        <div
          className="flex items-center gap-3 bg-primary-50 border border-primary-300 rounded-xl px-4 py-3 cursor-pointer hover:bg-primary-100 transition-colors"
          onClick={() => navigate('/expenses')}
        >
          <Bell size={18} className="text-primary-600 flex-shrink-0" />
          <span className="text-sm font-medium text-primary-800">
            수령 확인이 필요한 경비가 <strong>{unconfirmedExpenses.length}건</strong> 있습니다
          </span>
          <span className="ml-auto text-xs text-primary-600">확인하기 →</span>
        </div>
      )}

      {/* 카드 그리드 (모바일: 1열, md: 2열) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 카드 1: 금주 근무시간 */}
        <div data-tour="weekly-hours" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">금주 연장근무시간</h2>
          <WeeklyGauge hours={weeklyHours} max={maxHours} />
          <p className="text-xs text-gray-400 mt-3">
            이번 주 {weeklyHours.toFixed(1)}시간 / {maxHours}시간
          </p>
        </div>

        {/* 카드 3: 잔여 휴가 */}
        <div data-tour="leave-balance" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">잔여 연차</h2>
          <div className="flex items-baseline gap-1 mb-3">
            <span className="text-4xl font-bold text-primary-600 tabular-nums">
              {leave.remaining}
            </span>
            <span className="text-sm text-gray-400">/ {leave.total}일</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-400 rounded-full"
              style={{ width: `${leave.total > 0 ? (leave.remaining / leave.total) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1.5">
            <span>사용 {leave.used}일</span>
            <span>잔여 {leave.remaining}일</span>
          </div>
        </div>
      </div>

      {/* 빠른 액션 */}
      <div data-tour="quick-actions" className="grid grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/request')}
          className="flex flex-col items-center justify-center gap-1.5 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white font-semibold text-sm py-6 rounded-xl transition-colors shadow-sm"
        >
          <FilePlus size={20} />
          연장근무 신청
        </button>
        <button
          onClick={() => navigate('/leave/request')}
          className="flex flex-col items-center justify-center gap-1.5 bg-white hover:bg-gray-50 active:bg-gray-100 text-primary-600 font-semibold text-sm py-6 rounded-xl border border-primary-200 transition-colors shadow-sm"
        >
          <CalendarPlus size={20} />
          휴가 신청
        </button>
        <button
          onClick={() => navigate('/timesheet')}
          className="flex flex-col items-center justify-center gap-1.5 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 font-semibold text-sm py-6 rounded-xl border border-gray-200 transition-colors shadow-sm"
        >
          <Clock size={20} />
          근무 기록
        </button>
      </div>

      {/* 카드 2: 최근 제출 */}
      <div data-tour="recent-requests" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-500">최근 제출</h2>
          <button
            className="text-xs text-primary-600 hover:underline"
            onClick={() => navigate('/requests')}
          >
            전체 보기 →
          </button>
        </div>

        {recentRequests.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">제출 내역이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {recentRequests.map((req) => (
              <li
                key={req.id}
                className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {req.kind === 'overtime'
                      ? OVERTIME_TYPE_LABEL[req.type as OvertimeType]
                      : LEAVE_TYPE_LABEL[req.type as LeaveType]}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(req.date).toLocaleDateString('ko-KR', {
                      month: 'long', day: 'numeric', weekday: 'short'
                    })}
                  </p>
                </div>
                <StatusBadge status={req.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 공지사항 + 급여명세서 (1x2) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 공지사항 */}
        <div data-tour="notices" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500">공지사항</h2>
            {notices.length > 0 && (
              <button onClick={() => navigate('/notices')} className="text-xs text-primary-600 hover:underline">
                전체보기 →
              </button>
            )}
          </div>
          {notices.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">등록된 공지사항이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {notices.slice(0, 2).map((n) => (
                <li key={n.id} className="flex items-center gap-3 py-2.5">
                  <span className={`flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                    n.category === '업데이트' ? 'bg-blue-50 text-blue-600' :
                    n.category === '공지' ? 'bg-amber-50 text-amber-600' :
                    'bg-red-50 text-red-500'
                  }`}>
                    {n.category}
                  </span>
                  <span className="flex-1 text-sm text-gray-700 truncate">{n.title}</span>
                  <span className="flex-shrink-0 text-xs text-gray-400">
                    {new Date(n.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 급여명세서 */}
        <div data-tour="payslips" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500">급여명세서</h2>
            {payslips.length > 0 && (
              <button onClick={() => navigate('/payslips')} className="text-xs text-primary-600 hover:underline">
                전체보기 →
              </button>
            )}
          </div>
          {payslips.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">등록된 급여명세서가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {payslips.slice(0, 2).map(slip => {
                const [y, m] = slip.period.split('-')
                return (
                  <li key={slip.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{y}년 {parseInt(m)}월</p>
                      <p className="text-xs text-gray-400 mt-0.5">{slip.file_name}</p>
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
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
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

      {/* 급여명세서 상세 팝업 */}
      {payslipModal && (() => {
        const { slip, signedUrl } = payslipModal
        const [y, m] = slip.period.split('-')
        const isPdf = slip.file_name.toLowerCase().endsWith('.pdf')
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setPayslipModal(null)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="text-base font-bold text-gray-900">급여명세서 상세</h3>
                <button onClick={() => setPayslipModal(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={20} className="text-gray-400" />
                </button>
              </div>

              {/* 본문: 좌 정보 + 우 미리보기 */}
              <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
                {/* 왼쪽: 정보 */}
                <div className="w-full md:w-72 flex-shrink-0 p-6 border-b md:border-b-0 md:border-r border-gray-100 space-y-4 overflow-y-auto">
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1">지급월</p>
                    <p className="text-lg font-bold text-gray-900">{y}년 {parseInt(m)}월</p>
                  </div>
                  {slip.work_start && slip.work_end && (
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-1">실근로일</p>
                      <p className="text-sm text-gray-700">{slip.work_start} ~ {slip.work_end}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1">파일명</p>
                    <p className="text-sm text-gray-700">{slip.file_name}</p>
                  </div>
                  {slip.message && (
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-1">전달 문구</p>
                      <p className="text-sm text-primary-700 bg-primary-50 rounded-lg p-3">{slip.message}</p>
                    </div>
                  )}
                  <button
                    onClick={() => window.open(signedUrl, '_blank', 'noopener,noreferrer')}
                    className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
                  >
                    <Download size={14} />
                    다운로드
                  </button>
                </div>

                {/* 오른쪽: 미리보기 */}
                <div className="flex-1 bg-gray-50 flex items-center justify-center p-4 min-h-[400px]">
                  {isPdf ? (
                    <iframe
                      src={signedUrl}
                      className="w-full h-full min-h-[500px] rounded-lg border border-gray-200"
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

      {/* 경비 수령확인 알림 팝업 (로그인 시 자동) */}
      {showConfirmAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowConfirmAlert(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 bg-primary-50 rounded-full flex items-center justify-center">
                <Bell size={24} className="text-primary-600" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">수령 확인 필요</h3>
            <p className="text-sm text-gray-600 mb-1">
              지급 완료된 경비 <strong className="text-primary-600">{unconfirmedExpenses.length}건</strong>의
            </p>
            <p className="text-sm text-gray-600 mb-6">수령 확인이 필요합니다.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirmAlert(false)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                나중에
              </button>
              <button
                onClick={() => { setShowConfirmAlert(false); navigate('/expenses') }}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
              >
                확인하러 가기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 급여명세서 본인 확인 팝업 */}
      {payslipVerifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setPayslipVerifyModal(null); setVerifyEmail(''); setVerifyError('') }} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 bg-primary-50 rounded-full flex items-center justify-center">
                <Lock size={24} className="text-primary-600" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">본인 확인</h3>
            <p className="text-sm text-gray-500 mb-6">
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
                className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 text-center"
                autoFocus
              />
              {verifyError && (
                <p className="text-xs text-red-500 font-medium">{verifyError}</p>
              )}
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
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

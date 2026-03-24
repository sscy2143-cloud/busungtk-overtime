import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Users, Calendar, Clock, Info, ChevronDown } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { OVERTIME_TYPE_LABEL } from '../types'
import { GroupMemberSelect } from '../components/overtime/GroupMemberSelect'
import { WeeklyGauge } from '../components/overtime/WeeklyGauge'
import {
  calculateOvertimeBreakdown,
  isHolidayDate,
  getHolidayName,
  formatMinutes,
} from '../utils/overtime-calc'

export function RequestPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  const [currentWeeklyHours, setCurrentWeeklyHours] = useState(0)

  useEffect(() => {
    if (!employee?.id) return
    async function fetchWeeklyHours() {
      const now = new Date()
      const day = now.getDay()
      const monday = new Date(now)
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const weekStart = monday.toISOString().split('T')[0]
      const weekEnd = sunday.toISOString().split('T')[0]

      const { data } = await supabase
        .from('overtime_requests')
        .select('planned_start, planned_end')
        .eq('employee_id', employee!.id)
        .eq('status', 'approved')
        .gte('date', weekStart)
        .lte('date', weekEnd)

      if (data) {
        let total = 0
        for (const row of data) {
          const [sh, sm] = row.planned_start.split(':').map(Number)
          const [eh, em] = row.planned_end.split(':').map(Number)
          let mins = (eh * 60 + em) - (sh * 60 + sm)
          if (mins < 0) mins += 24 * 60
          total += mins / 60
        }
        setCurrentWeeklyHours(total)
      }
    }
    fetchWeeklyHours()
  }, [employee?.id])

  const timeOptions = useMemo(() => {
    const opts: string[] = []
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      }
    }
    return opts
  }, [])

  const [date, setDate] = useState(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [reason, setReason] = useState('')
  const [siteName, setSiteName] = useState('')
  const [workDetails, setWorkDetails] = useState('')
  const [forceHoliday, setForceHoliday] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(false)

  interface NotionSchedule {
    id: string
    title: string
    date: string
    siteName: string
    workTitle: string
    status: string
  }
  const [schedules, setSchedules] = useState<NotionSchedule[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [selectedScheduleId, setSelectedScheduleId] = useState('')

  useEffect(() => {
    async function fetchSchedules() {
      setScheduleLoading(true)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch('/api/notion-schedules', {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        })
        if (res.ok) {
          const { schedules: items } = await res.json()
          setSchedules(items ?? [])
        }
      } catch { /* 실패해도 무시 */ }
      setScheduleLoading(false)
    }
    fetchSchedules()
  }, [])

  function handleScheduleSelect(scheduleId: string) {
    setSelectedScheduleId(scheduleId)
    if (!scheduleId) return
    const s = schedules.find(s => s.id === scheduleId)
    if (!s) return
    if (s.date) setDate(s.date)
    if (s.siteName) setSiteName(s.siteName)
    if (s.workTitle) setWorkDetails(s.workTitle)
    setForceHoliday(false)
  }

  const autoHoliday = date ? isHolidayDate(date) : false
  const holidayName = date ? getHolidayName(date) : null
  const effectiveHoliday = autoHoliday || forceHoliday

  const breakdown = useMemo(() => {
    if (!date || !startTime || !endTime) return null
    return calculateOvertimeBreakdown(date, startTime, endTime, forceHoliday)
  }, [date, startTime, endTime, forceHoliday])

  const isOverWeekly = currentWeeklyHours >= 12

  function showToast() {
    setToast(true)
    setTimeout(() => setToast(false), 2500)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !startTime || !endTime || !siteName.trim() || !workDetails.trim() || !breakdown) return
    setSubmitting(true)

    const payload = {
      employee_id: employee?.id ?? '',
      type: breakdown.primaryType,
      date,
      planned_start: startTime,
      planned_end: endTime,
      reason: reason.trim(),
      is_retroactive: true,
      group_member_ids: groupIds,
    }

    const groupId = groupIds.length > 0 ? crypto.randomUUID() : null

    const { error } = await supabase.from('overtime_requests').insert({
      employee_id: payload.employee_id,
      type: payload.type,
      date: payload.date,
      planned_start: payload.planned_start,
      planned_end: payload.planned_end,
      reason: payload.reason,
      site_name: siteName.trim() || null,
      work_details: workDetails.trim() || null,
      is_retroactive: payload.is_retroactive,
      created_by: payload.employee_id,
      group_id: groupId,
    })

    if (error) {
      void error
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    showToast()
    setTimeout(() => navigate('/requests'), 800)
  }

  const inputClass = "w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 transition-colors"
  const labelClass = "block text-sm font-semibold text-dark-700 mb-1.5"

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-24">
      <h1 className="text-xl font-bold text-dark-900 mb-6">야근 제출</h1>

      {/* 주간 게이지 */}
      <div data-tour="overtime-gauge" className="mb-6">
        <WeeklyGauge currentHours={currentWeeklyHours} />
      </div>

      {/* 주간 연장근무 한도 경고 (관리자만 표시) */}
      {isOverWeekly && (employee?.role === 'admin' || employee?.role === 'manager') && (
        <div className="flex items-start gap-2 bg-primary-50 border border-primary-200 rounded-xl px-4 py-3 mb-6 text-sm text-primary-700">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>이번 주 연장근무가 <strong>12시간</strong>을 초과했습니다. 한도를 확인하세요.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 노션 스케줄 선택 */}
        {schedules.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClass}>
                <span className="flex items-center gap-1.5">
                  <Calendar size={15} className="text-primary-500" />
                  노션 작업 일정
                </span>
              </label>
              <a
                href="notion://www.notion.so/5feec1e4b2284dffb3428a3f130dfa0d"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary-500 hover:underline"
              >
                노션 바로가기
              </a>
            </div>
            <div className="relative">
              <select
                value={selectedScheduleId}
                onChange={(e) => handleScheduleSelect(e.target.value)}
                className={`${inputClass} appearance-none pr-8`}
              >
                <option value="">일정을 선택하거나 아래에서 직접 입력하세요</option>
                {schedules.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.date.slice(5).replace('-', '/')} — {s.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-300 pointer-events-none" />
            </div>
            <p className="text-xs text-dark-400 mt-1.5">노션에 등록된 최근 2주치 작업 일정입니다.</p>
            <p className="text-xs text-dark-400 mt-0.5">선택하면 날짜, 현장명, 내용이 자동으로 채워집니다.</p>
          </div>
        )}
        {scheduleLoading && (
          <p className="text-xs text-dark-400">스케줄 불러오는 중...</p>
        )}

        {/* 날짜 */}
        <div>
          <label className={labelClass}>
            <span className="flex items-center gap-1.5">
              <Calendar size={15} className="text-primary-500" />
              근무 날짜
            </span>
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setForceHoliday(false)
            }}
            required
            className={inputClass}
          />

          {date && (autoHoliday || forceHoliday) && (
            <div className="flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-primary-50 border border-primary-200 rounded-lg">
              <span className="text-xs font-medium text-primary-700">
                {holidayName ? `${holidayName} (휴일근로 적용)` : '휴일근로 적용'}
              </span>
            </div>
          )}

          {date && !autoHoliday && (
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={forceHoliday}
                onChange={(e) => setForceHoliday(e.target.checked)}
                className="w-4 h-4 rounded border-dark-300 text-primary-500 focus:ring-primary-400"
              />
              <span className="text-xs text-dark-400">공휴일/임시공휴일로 지정</span>
            </label>
          )}
        </div>

        {/* 시간 */}
        <div>
          <label className={labelClass}>
            <span className="flex items-center gap-1.5">
              <Clock size={15} className="text-primary-500" />
              근무 시간
            </span>
          </label>
          <p className="text-xs text-dark-400 mt-1 mb-3">휴게시간을 반영하여 정규 근무 이후 연장근무를 시작한 시각과 종료한 시각을 입력하세요.</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-dark-400 mb-1 block">시작</label>
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">선택</option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-dark-400 mb-1 block">종료</label>
              <select
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">선택</option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 자동 분류 결과 */}
        {breakdown && breakdown.totalMinutes > 0 && (
          <div className="bg-dark-50 rounded-2xl border border-dark-100 p-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <Info size={14} className="text-primary-500" />
              <span className="text-sm font-semibold text-dark-700">자동 분류 결과</span>
            </div>

            <div className="flex items-center gap-2 text-xs text-dark-500 mb-1">
              <span>총 {formatMinutes(breakdown.totalMinutes)}</span>
              <span className="text-dark-200">|</span>
              <span className={`font-medium px-2 py-0.5 rounded-full ${
                effectiveHoliday ? 'bg-primary-100 text-primary-700' : 'bg-dark-100 text-dark-700'
              }`}>
                {effectiveHoliday ? '휴일' : '평일'}
              </span>
              <span className="font-medium text-dark-600">
                {OVERTIME_TYPE_LABEL[breakdown.primaryType]}
              </span>
            </div>

            <div className="space-y-1.5">
              {breakdown.payItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-dark-100"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      item.multiplier >= 2.0 ? 'bg-dark-800' : 'bg-primary-500'
                    }`} />
                    <span className="text-sm text-dark-700">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-dark-900">
                      {formatMinutes(item.minutes)}
                    </span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      item.multiplier >= 2.0 ? 'bg-dark-100 text-dark-800' : 'bg-primary-50 text-primary-700'
                    }`}>
                      x{item.multiplier}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 현장명 */}
        <div>
          <label className={labelClass}>
            현장명 <span className="text-primary-500">*</span>
          </label>
          <input
            type="text"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="현장명을 입력하세요 (예: 폴라리스 홀, R5)"
            required
            className={inputClass}
          />
        </div>

        {/* 작업내용 */}
        <div>
          <label className={labelClass}>
            내용 <span className="text-primary-500">*</span>
          </label>
          <input
            type="text"
            value={workDetails}
            onChange={(e) => setWorkDetails(e.target.value)}
            placeholder="내용을 입력하세요 (예: 워크인냉장고 콤프 교체)"
            required
            className={inputClass}
          />
        </div>

        {/* 기타 */}
        <div>
          <label className={labelClass}>기타</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="추가 메모가 있으면 입력하세요"
            className={`${inputClass} resize-none`}
          />
        </div>

        {/* 그룹 제출 */}
        <div>
          <button
            type="button"
            onClick={() => setGroupOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-primary-500"
          >
            <Users size={16} />
            함께 근무한 직원 추가
            {groupIds.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary-50 text-primary-600 text-xs rounded-full font-bold">
                {groupIds.length}명
              </span>
            )}
          </button>

          {groupOpen && (
            <div className="mt-3">
              <GroupMemberSelect
                selectedIds={groupIds}
                onSelect={setGroupIds}
              />
            </div>
          )}
        </div>

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={submitting || !breakdown || breakdown.totalMinutes <= 0}
          className="w-full py-3.5 bg-primary-500 text-white font-bold rounded-xl hover:bg-primary-600 disabled:opacity-50 transition-colors mt-2"
        >
          {submitting ? '제출 중...' : '제출하기'}
        </button>
      </form>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-dark-900 text-white text-sm px-5 py-3 rounded-full shadow-lg z-50">
          제출이 완료되었습니다
        </div>
      )}
    </div>
  )
}

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

  // 노션 스케줄
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
        const res = await fetch('/api/notion-schedules')
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

  // 자동 판정
  const autoHoliday = date ? isHolidayDate(date) : false
  const holidayName = date ? getHolidayName(date) : null
  const effectiveHoliday = autoHoliday || forceHoliday

  // 실시간 분류 계산
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
      is_retroactive: true, // 사후 제출이므로 항상 true
      group_member_ids: groupIds,
    }
    console.log('[RequestPage] submit payload:', payload)

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
      console.error('[RequestPage] insert error:', error)
      setSubmitting(false)
      return
    }

    // 노션 캘린더 연동 (실패해도 제출은 완료)
    try {
      await fetch('/api/notify-overtime-notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName: employee?.name ?? '',
          date: payload.date,
          startTime: payload.planned_start,
          endTime: payload.planned_end,
          overtimeType: payload.type,
          siteName: siteName.trim(),
          workDetails: workDetails.trim(),
          reason: payload.reason,
        }),
      })
    } catch (notionErr) {
      console.warn('[RequestPage] Notion notify failed (non-blocking):', notionErr)
    }

    setSubmitting(false)
    showToast()
    setTimeout(() => navigate('/requests'), 800)
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-24">
      <h1 className="text-xl font-bold text-gray-900 mb-6">야근 제출</h1>

      {/* 주간 게이지 */}
      <div className="mb-6">
        <WeeklyGauge currentHours={currentWeeklyHours} />
      </div>

      {/* 주간 연장근무 한도 경고 */}
      {isOverWeekly && (
        <div className="flex items-start gap-2 bg-warning-50 border border-warning-400 rounded-xl px-4 py-3 mb-6 text-sm text-warning-500">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>이번 주 연장근무가 <strong>12시간</strong>을 초과했습니다. 법정 한도를 확인하세요.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 노션 스케줄 선택 */}
        {schedules.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">
                <span className="flex items-center gap-1.5">
                  <Calendar size={15} />
                  노션 작업 일정
                </span>
              </label>
              <a
                href="https://www.notion.so/5feec1e4b2284dffb3428a3f130dfa0d"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary-500 hover:underline"
              >
                노션 바로가기 →
              </a>
            </div>
            <div className="relative">
              <select
                value={selectedScheduleId}
                onChange={(e) => handleScheduleSelect(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 appearance-none pr-8"
              >
                <option value="">일정을 선택하거나 아래에서 직접 입력하세요</option>
                {schedules.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.date.slice(5).replace('-', '/')} — {s.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">노션에 등록된 최근 2주치 작업 일정입니다. 선택하면 날짜, 현장명, 작업내용이 자동으로 채워집니다.</p>
          </div>
        )}
        {scheduleLoading && (
          <p className="text-xs text-gray-400">스케줄 불러오는 중...</p>
        )}

        {/* 날짜 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Calendar size={15} />
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
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
          />

          {/* 휴일 자동 감지 배지 */}
          {date && (autoHoliday || forceHoliday) && (
            <div className="flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg">
              <span className="text-xs font-medium text-orange-700">
                {holidayName ? `${holidayName} (휴일근로 적용)` : '휴일근로 적용'}
              </span>
            </div>
          )}

          {/* 공휴일 수동 지정 (자동 감지 안 된 경우만) */}
          {date && !autoHoliday && (
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={forceHoliday}
                onChange={(e) => setForceHoliday(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-400"
              />
              <span className="text-xs text-gray-500">공휴일/임시공휴일로 지정</span>
            </label>
          )}
        </div>

        {/* 시간 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Clock size={15} />
              근무 시간
            </span>
          </label>
          <div className="mt-2 mb-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
            <p className="text-xs text-gray-600">휴게시간을 반영하여 정규 근무 이후 연장근무를 시작한 시각과 종료한 시각을 입력하세요.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">시작</label>
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option value="">선택</option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">종료</label>
              <select
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
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
          <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <Info size={14} className="text-primary-600" />
              <span className="text-sm font-semibold text-gray-700">자동 분류 결과</span>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <span>총 {formatMinutes(breakdown.totalMinutes)}</span>
              <span className="text-gray-300">|</span>
              <span className={`font-medium px-2 py-0.5 rounded-full ${
                effectiveHoliday ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {effectiveHoliday ? '휴일' : '평일'}
              </span>
              <span className="font-medium text-gray-600">
                {OVERTIME_TYPE_LABEL[breakdown.primaryType]}
              </span>
            </div>

            {/* 수당 항목별 표시 */}
            <div className="space-y-1.5">
              {breakdown.payItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-gray-100"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      item.multiplier >= 2.5 ? 'bg-danger-500' :
                      item.multiplier >= 2.0 ? 'bg-warning-500' :
                      'bg-primary-500'
                    }`} />
                    <span className="text-sm text-gray-700">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">
                      {formatMinutes(item.minutes)}
                    </span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      item.multiplier >= 2.5 ? 'bg-danger-50 text-danger-700' :
                      item.multiplier >= 2.0 ? 'bg-warning-50 text-warning-700' :
                      'bg-primary-50 text-primary-700'
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
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            현장명 <span className="text-danger-500">*</span>
          </label>
          <input
            type="text"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="현장명을 입력하세요 (예: 폴라리스 홀, R5)"
            required
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>

        {/* 작업내용 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            내용 <span className="text-danger-500">*</span>
          </label>
          <input
            type="text"
            value={workDetails}
            onChange={(e) => setWorkDetails(e.target.value)}
            placeholder="내용을 입력하세요 (예: 워크인냉장고 콤프 교체)"
            required
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>


        {/* 기타 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            기타
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="추가 메모가 있으면 입력하세요"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
          />
        </div>

        {/* 그룹 제출 */}
        <div>
          <button
            type="button"
            onClick={() => setGroupOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-primary-600"
          >
            <Users size={16} />
            함께 근무한 직원 추가
            {groupIds.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary-100 text-primary-700 text-xs rounded-full">
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
          className="w-full py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors mt-2"
        >
          {submitting ? '제출 중...' : '제출하기'}
        </button>
      </form>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5 py-3 rounded-full shadow-lg z-50">
          제출이 완료되었습니다
        </div>
      )}
    </div>
  )
}

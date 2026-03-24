import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Clock, Calendar, AlertTriangle } from 'lucide-react'
import type { OvertimeRequest, TimeRecord } from '../types'
import { OVERTIME_TYPE_LABEL } from '../types'
import { StatusBadge } from '../components/common/StatusBadge'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

interface TimesheetEntry {
  request: OvertimeRequest
  record: TimeRecord | null
}

const TYPE_COLOR: Record<string, string> = {
  extended: 'bg-dark-100 text-dark-700',
  night: 'bg-dark-100 text-dark-700',
  holiday: 'bg-primary-50 text-primary-700',
}

interface EditModalState {
  requestId: string
  startVal: string
  endVal: string
  editReason: string
}

export function TimesheetPage() {
  const { employee } = useAuth()
  // 월 오프셋 (0 = 이번 달, -1 = 지난 달, ...)
  const [monthOffset, setMonthOffset] = useState(0)
  const [entries, setEntries] = useState<TimesheetEntry[]>([])
  const [editModal, setEditModal] = useState<EditModalState | null>(null)

  // 현재 표시 월 계산
  const now = new Date()
  const displayYear = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getFullYear()
  const displayMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getMonth()
  const isCurrentMonth = monthOffset === 0

  const monthLabel = `${displayYear}년 ${displayMonth + 1}월`

  useEffect(() => {
    if (!employee?.id) return
    fetchMonthEntries()
  }, [employee?.id, monthOffset])

  async function fetchMonthEntries() {
    // 해당 월의 시작/끝 날짜
    const startDate = new Date(displayYear, displayMonth, 1)
    const endDate = new Date(displayYear, displayMonth + 1, 0) // 해당 월 마지막 날
    const startStr = startDate.toISOString().split('T')[0]
    const endStr = endDate.toISOString().split('T')[0]

    const { data: requests } = await supabase
      .from('overtime_requests')
      .select('*')
      .eq('employee_id', employee!.id)
      .gte('date', startStr)
      .lte('date', endStr)
      .in('status', ['approved', 'pending'])
      .order('date', { ascending: false })

    if (requests) {
      const requestIds = requests.map((r: OvertimeRequest) => r.id)
      let records: TimeRecord[] = []
      if (requestIds.length > 0) {
        const { data: recs } = await supabase
          .from('time_records')
          .select('*')
          .in('request_id', requestIds)
        if (recs) records = recs as TimeRecord[]
      }

      const recordMap = new Map(records.map((r) => [r.request_id, r]))

      const newEntries: TimesheetEntry[] = requests.map((req: OvertimeRequest) => ({
        request: req as OvertimeRequest,
        record: recordMap.get(req.id) || null,
      }))
      setEntries(newEntries)
    }
  }

  function formatMinutes(min: number) {
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h === 0) return `${m}분`
    return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
  }

  function calcMinutesFromTime(start: string, end: string): number {
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    let mins = (eh * 60 + em) - (sh * 60 + sm)
    if (mins < 0) mins += 24 * 60
    return mins
  }

  // 월 총 야근 시간 계산 (승인된 건만)
  const approvedEntries = entries.filter(e => e.request.status === 'approved')
  const totalMonthMinutes = approvedEntries.reduce((sum, e) => {
    if (e.record) return sum + e.record.total_minutes
    return sum + calcMinutesFromTime(e.request.planned_start, e.request.planned_end)
  }, 0)

  const totalExtMinutes = approvedEntries.reduce((sum, e) => {
    if (e.record) return sum + e.record.extended_minutes
    if (e.request.type === 'extended') return sum + calcMinutesFromTime(e.request.planned_start, e.request.planned_end)
    return sum
  }, 0)

  const totalNightMinutes = approvedEntries.reduce((sum, e) => {
    if (e.record) return sum + e.record.night_minutes
    if (e.request.type === 'night') return sum + calcMinutesFromTime(e.request.planned_start, e.request.planned_end)
    return sum
  }, 0)

  const totalHolidayMinutes = approvedEntries.reduce((sum, e) => {
    if (e.record) return sum + e.record.holiday_minutes
    if (e.request.type === 'holiday') return sum + calcMinutesFromTime(e.request.planned_start, e.request.planned_end)
    return sum
  }, 0)

  function formatDateKr(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })
  }

  function openEditModal(requestId: string) {
    const entry = entries.find(e => e.request.id === requestId)
    const rec = entry?.record
    setEditModal({
      requestId,
      startVal: rec?.actual_start ?? entry?.request.planned_start ?? '',
      endVal: rec?.actual_end ?? entry?.request.planned_end ?? '',
      editReason: '',
    })
  }

  async function saveEdit() {
    if (!editModal) return
    if (!editModal.editReason.trim()) return
    const { requestId, startVal, endVal, editReason } = editModal
    const totalMin = calcMinutesFromTime(startVal, endVal)

    const entry = entries.find(e => e.request.id === requestId)
    const existingRec = entry?.record

    if (existingRec && existingRec.id && !existingRec.id.startsWith('rec-')) {
      const { error } = await supabase.from('time_records').update({
        actual_start: startVal,
        actual_end: endVal,
        total_minutes: totalMin,
        extended_minutes: totalMin,
        night_minutes: 0,
        holiday_minutes: 0,
        is_manually_edited: true,
        edit_reason: editReason,
      }).eq('id', existingRec.id)

      if (!error) {
        fetchMonthEntries()
      }
    }
    setEditModal(null)
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-24">
      {/* 헤더 + 월 네비 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-dark-900">근무 기록</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonthOffset((v) => v - 1)}
            className="p-1.5 rounded-lg hover:bg-dark-50 text-dark-500"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium text-dark-700 min-w-28 text-center">
            {isCurrentMonth ? (
              <span className="text-primary-600">이번 달</span>
            ) : monthLabel}
          </span>
          <button
            onClick={() => setMonthOffset((v) => v + 1)}
            disabled={monthOffset >= 0}
            className="p-1.5 rounded-lg hover:bg-dark-50 text-dark-500 disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* 월 총 야근 시간 요약 카드 */}
      <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={16} className="text-dark-400" />
          <p className="text-xs text-dark-400">{monthLabel} 야근 합계</p>
        </div>
        <p className="text-3xl font-black text-primary-500 mb-3">
          {(totalMonthMinutes / 60).toFixed(1)}h
        </p>
        <div className="flex gap-4">
          <div>
            <span className="text-xs text-dark-400">연장</span>
            <p className="text-sm font-bold text-dark-800">{(totalExtMinutes / 60).toFixed(1)}h</p>
          </div>
          <div className="w-px bg-dark-100" />
          <div>
            <span className="text-xs text-dark-400">야간</span>
            <p className="text-sm font-bold text-dark-800">{(totalNightMinutes / 60).toFixed(1)}h</p>
          </div>
          <div className="w-px bg-dark-100" />
          <div>
            <span className="text-xs text-dark-400">휴일</span>
            <p className="text-sm font-bold text-dark-800">{(totalHolidayMinutes / 60).toFixed(1)}h</p>
          </div>
          <div className="w-px bg-dark-100" />
          <div>
            <span className="text-xs text-dark-400">건수</span>
            <p className="text-sm font-bold text-dark-800">{approvedEntries.length}건</p>
          </div>
        </div>
      </div>

      {/* 해당 월 신청 건 목록 */}
      {entries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-12 text-center">
          <Clock className="w-12 h-12 text-dark-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-dark-500 mb-1">이 달의 야근 기록이 없습니다</p>
          <p className="text-xs text-dark-400">승인된 야근 신청이 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(({ request: req, record: rec }) => {
            const minutes = rec
              ? rec.total_minutes
              : calcMinutesFromTime(req.planned_start, req.planned_end)

            return (
              <div key={req.id} className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
                {/* 날짜 + 유형 + 상태 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-dark-800">
                      {formatDateKr(req.date)}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                      {OVERTIME_TYPE_LABEL[req.type]}
                    </span>
                  </div>
                  <StatusBadge status={req.status} />
                </div>

                {/* 시간 정보 */}
                <div className="flex items-center gap-1.5 text-xs text-dark-500 mb-1">
                  <Clock size={13} className="text-dark-400" />
                  <span>계획: {req.planned_start} ~ {req.planned_end}</span>
                  <span className="text-dark-200">|</span>
                  <span className="font-medium text-dark-700">{formatMinutes(minutes)}</span>
                </div>

                {/* 실제 기록 (있는 경우) */}
                {rec && (
                  <div className="flex items-center justify-between mt-2">
                    <div className="bg-dark-50 rounded-lg px-3 py-1.5 text-xs">
                      <span className="text-dark-500">실제: </span>
                      <span className="font-semibold text-dark-800">
                        {rec.actual_start} ~ {rec.actual_end}
                      </span>
                      <span className="ml-1.5 text-primary-600 font-medium">
                        ({formatMinutes(rec.total_minutes)})
                      </span>
                      {rec.is_manually_edited && (
                        <span className="ml-1.5 text-primary-500 inline-flex items-center gap-0.5">
                          <AlertTriangle size={10} />
                          수동
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => openEditModal(req.id)}
                      className="text-xs text-primary-600 hover:underline shrink-0 ml-2"
                    >
                      수정
                    </button>
                  </div>
                )}

                {/* 사유 */}
                <p className="text-xs text-dark-400 mt-1.5 truncate">{req.reason}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* 수동 수정 모달 */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg bg-white rounded-t-3xl p-6 space-y-4">
            <h2 className="text-base font-bold text-dark-900">근무 시간 수정</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">시작 시간</label>
                <input
                  type="time"
                  value={editModal.startVal}
                  onChange={(e) => setEditModal((m) => m ? { ...m, startVal: e.target.value } : m)}
                  className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 text-dark-800 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">종료 시간</label>
                <input
                  type="time"
                  value={editModal.endVal}
                  onChange={(e) => setEditModal((m) => m ? { ...m, endVal: e.target.value } : m)}
                  className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 text-dark-800 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">
                수정 사유 <span className="text-primary-500">*</span>
              </label>
              <textarea
                value={editModal.editReason}
                onChange={(e) => setEditModal((m) => m ? { ...m, editReason: e.target.value } : m)}
                rows={2}
                placeholder="수정 사유를 입력하세요"
                className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl bg-white resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 text-dark-800 transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditModal(null)}
                className="flex-1 py-2.5 border border-dark-200 text-dark-600 text-sm font-medium rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={saveEdit}
                disabled={!editModal.editReason.trim()}
                className="flex-1 py-2.5 bg-primary-500 text-white text-sm font-semibold rounded-xl hover:bg-primary-500 disabled:opacity-40"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, AlertTriangle } from 'lucide-react'
import type { OvertimeRequest, TimeRecord } from '../types'
import { OVERTIME_TYPE_LABEL } from '../types'
import { StatusBadge } from '../components/common/StatusBadge'

interface TimesheetEntry {
  request: OvertimeRequest
  record: TimeRecord | null
}

// 데모 승인된 신청 2건
const DEMO_ENTRIES: TimesheetEntry[] = [
  {
    request: {
      id: 'req-1',
      employee_id: 'me',
      type: 'extended',
      date: '2026-02-25',
      planned_start: '18:00',
      planned_end: '21:00',
      reason: '월말 마감 작업',
      status: 'approved',
      is_retroactive: false,
      group_id: null,
      created_by: 'me',
      approved_by: 'mgr-1',
      approved_at: '2026-02-25T10:00:00Z',
      rejection_reason: null,
      created_at: '2026-02-25T08:00:00Z',
    },
    record: {
      id: 'rec-1',
      request_id: 'req-1',
      employee_id: 'me',
      actual_start: '18:05',
      actual_end: '21:10',
      total_minutes: 185,
      extended_minutes: 185,
      night_minutes: 0,
      holiday_minutes: 0,
      is_manually_edited: false,
      edit_reason: null,
      created_at: '2026-02-25T21:10:00Z',
    },
  },
  {
    request: {
      id: 'req-2',
      employee_id: 'me',
      type: 'extended',
      date: '2026-02-25',
      planned_start: '22:00',
      planned_end: '23:30',
      reason: '긴급 서버 점검',
      status: 'approved',
      is_retroactive: false,
      group_id: null,
      created_by: 'me',
      approved_by: 'mgr-1',
      approved_at: '2026-02-25T15:00:00Z',
      rejection_reason: null,
      created_at: '2026-02-25T14:00:00Z',
    },
    record: null,
  },
]

const TYPE_COLOR: Record<string, string> = {
  extended: 'bg-blue-100 text-blue-700',
  night: 'bg-indigo-100 text-indigo-700',
  holiday: 'bg-orange-100 text-orange-700',
}

interface EditModalState {
  requestId: string
  startVal: string
  endVal: string
  editReason: string
}

export function TimesheetPage() {
  const [dateOffset, setDateOffset] = useState(0)
  const [activeStarts, setActiveStarts] = useState<Record<string, string>>({})
  const [completedRecords, setCompletedRecords] = useState<Record<string, TimeRecord>>(() => {
    const init: Record<string, TimeRecord> = {}
    DEMO_ENTRIES.forEach((e) => {
      if (e.record) init[e.request.id] = e.record
    })
    return init
  })
  const [editModal, setEditModal] = useState<EditModalState | null>(null)

  // 날짜 계산
  const baseDate = new Date('2026-02-25')
  baseDate.setDate(baseDate.getDate() + dateOffset)
  const displayDate = baseDate.toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })
  const isToday = dateOffset === 0

  function nowTime() {
    return new Date().toTimeString().slice(0, 5)
  }

  function startWork(requestId: string) {
    setActiveStarts((prev) => ({ ...prev, [requestId]: nowTime() }))
  }

  function endWork(requestId: string, req: OvertimeRequest) {
    const start = activeStarts[requestId]
    if (!start) return
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = nowTime().split(':').map(Number)
    const totalMin = (eh * 60 + em) - (sh * 60 + sm)

    const rec: TimeRecord = {
      id: `rec-${requestId}`,
      request_id: requestId,
      employee_id: 'me',
      actual_start: start,
      actual_end: nowTime(),
      total_minutes: totalMin,
      extended_minutes: req.type === 'extended' ? totalMin : 0,
      night_minutes: req.type === 'night' ? totalMin : 0,
      holiday_minutes: req.type === 'holiday' ? totalMin : 0,
      is_manually_edited: false,
      edit_reason: null,
      created_at: new Date().toISOString(),
    }
    setCompletedRecords((prev) => ({ ...prev, [requestId]: rec }))
    setActiveStarts((prev) => {
      const next = { ...prev }
      delete next[requestId]
      return next
    })
    console.log('[TimesheetPage] recorded:', rec)
  }

  function openEditModal(requestId: string) {
    const rec = completedRecords[requestId]
    setEditModal({
      requestId,
      startVal: rec?.actual_start ?? '',
      endVal: rec?.actual_end ?? '',
      editReason: '',
    })
  }

  function saveEdit() {
    if (!editModal) return
    if (!editModal.editReason.trim()) return
    const { requestId, startVal, endVal, editReason } = editModal
    const [sh, sm] = startVal.split(':').map(Number)
    const [eh, em] = endVal.split(':').map(Number)
    const totalMin = (eh * 60 + em) - (sh * 60 + sm)
    setCompletedRecords((prev) => ({
      ...prev,
      [requestId]: {
        ...(prev[requestId] ?? {}),
        id: prev[requestId]?.id ?? `rec-${requestId}`,
        request_id: requestId,
        employee_id: 'me',
        actual_start: startVal,
        actual_end: endVal,
        total_minutes: totalMin,
        extended_minutes: totalMin,
        night_minutes: 0,
        holiday_minutes: 0,
        is_manually_edited: true,
        edit_reason: editReason,
        created_at: prev[requestId]?.created_at ?? new Date().toISOString(),
      },
    }))
    setEditModal(null)
  }

  function formatMinutes(min: number) {
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h === 0) return `${m}분`
    return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
  }

  // 오늘 합계
  const totalExt = Object.values(completedRecords).reduce((s, r) => s + r.extended_minutes, 0)
  const totalNight = Object.values(completedRecords).reduce((s, r) => s + r.night_minutes, 0)

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-24">
      {/* 헤더 + 날짜 네비 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">근무 기록</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDateOffset((v) => v - 1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-36 text-center">
            {isToday ? (
              <span className="text-primary-600">오늘</span>
            ) : displayDate}
          </span>
          <button
            onClick={() => setDateOffset((v) => v + 1)}
            disabled={dateOffset >= 0}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* 승인된 신청 목록 */}
      <div className="space-y-4 mb-6">
        {DEMO_ENTRIES.map(({ request: req }) => {
          const rec = completedRecords[req.id]
          const inProgress = !!activeStarts[req.id]
          const done = !!rec

          return (
            <div key={req.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              {/* 신청 정보 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[req.type]}`}>
                    {OVERTIME_TYPE_LABEL[req.type]}
                  </span>
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <Clock size={13} />
                    {req.planned_start} ~ {req.planned_end}
                  </span>
                </div>
                <StatusBadge status={req.status} />
              </div>
              <p className="text-xs text-gray-400 mb-4 truncate">{req.reason}</p>

              {/* 기록 영역 */}
              {done ? (
                <div className="space-y-2">
                  <div className="bg-success-50 rounded-xl p-3 flex items-center justify-between">
                    <div className="text-sm">
                      <span className="text-gray-500">실제 근무: </span>
                      <span className="font-semibold text-gray-800">
                        {rec.actual_start} ~ {rec.actual_end}
                      </span>
                      <span className="ml-2 text-success-600 font-medium">
                        ({formatMinutes(rec.total_minutes)})
                      </span>
                    </div>
                    {rec.is_manually_edited && (
                      <span className="text-xs text-warning-500 flex items-center gap-1">
                        <AlertTriangle size={12} />
                        수동
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => openEditModal(req.id)}
                    className="text-xs text-primary-600 hover:underline"
                  >
                    시간 수정
                  </button>
                </div>
              ) : inProgress ? (
                <div className="space-y-2">
                  <div className="bg-blue-50 rounded-xl p-3 text-sm">
                    <span className="text-gray-500">시작 시각: </span>
                    <span className="font-semibold text-gray-800">{activeStarts[req.id]}</span>
                    <span className="ml-2 text-blue-500 animate-pulse">진행 중...</span>
                  </div>
                  <button
                    onClick={() => endWork(req.id, req)}
                    className="w-full py-2.5 bg-danger-500 text-white text-sm font-semibold rounded-xl hover:bg-danger-600 transition-colors"
                  >
                    종료
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startWork(req.id)}
                  className="w-full py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors"
                >
                  시작
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 오늘 합계 */}
      <div className="bg-gray-900 rounded-2xl p-4 text-white">
        <p className="text-xs text-gray-400 mb-2">오늘 합계</p>
        <div className="flex gap-4">
          <div>
            <span className="text-xs text-gray-400">연장</span>
            <p className="text-lg font-bold">{(totalExt / 60).toFixed(1)}h</p>
          </div>
          <div className="w-px bg-gray-700" />
          <div>
            <span className="text-xs text-gray-400">야간</span>
            <p className="text-lg font-bold">{(totalNight / 60).toFixed(1)}h</p>
          </div>
          <div className="w-px bg-gray-700" />
          <div>
            <span className="text-xs text-gray-400">합계</span>
            <p className="text-lg font-bold text-primary-400">
              {((totalExt + totalNight) / 60).toFixed(1)}h
            </p>
          </div>
        </div>
      </div>

      {/* 수동 수정 모달 */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg bg-white rounded-t-3xl p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900">근무 시간 수정</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">시작 시간</label>
                <input
                  type="time"
                  value={editModal.startVal}
                  onChange={(e) => setEditModal((m) => m ? { ...m, startVal: e.target.value } : m)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">종료 시간</label>
                <input
                  type="time"
                  value={editModal.endVal}
                  onChange={(e) => setEditModal((m) => m ? { ...m, endVal: e.target.value } : m)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                수정 사유 <span className="text-danger-500">*</span>
              </label>
              <textarea
                value={editModal.editReason}
                onChange={(e) => setEditModal((m) => m ? { ...m, editReason: e.target.value } : m)}
                rows={2}
                placeholder="수정 사유를 입력하세요"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditModal(null)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={saveEdit}
                disabled={!editModal.editReason.trim()}
                className="flex-1 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50"
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

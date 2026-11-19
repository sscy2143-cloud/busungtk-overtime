import { Link } from 'react-router-dom'
import { Briefcase } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTrip } from '../../features/trip/screens'
import type { Schedule } from '../../features/trip/data'
import { TripConnected } from './TripConnected'
import { TRIP_ROUTES, tripScreenOpen } from './trip-glue'

const scheduleLabel = (s: Schedule): string => (s.kind === 'day' ? s.date : `${s.startDate} ~ ${s.endDate}`)

/** 출장 검토 대기 건 요약 — 서버 값(RLS 로 읽은 submitted 건)만 보여 주고, 승인·반려는 /admin/trip 에서만 한다 */
export function PendingList() {
  const { service, actor, employees } = useTrip()
  const q = service.reviewQueue(actor, 'submitted')
  // 서버 스위치 OFF·권한 없음 등으로 읽지 못하면 조용히 숨긴다 (기존 승인 화면을 방해하지 않는다)
  if (!q.ok || q.value.length === 0) return null
  const rows = [...q.value].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? '직원'
  return (
    <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3" data-testid="trip-pending-notice">
      <div className="flex items-center gap-2">
        <Briefcase size={18} className="text-primary-600" />
        <span className="text-lg font-bold text-primary-700">{rows.length}</span>
        <span className="text-sm font-semibold text-primary-700">건의 출장 신청이 검토 대기 중입니다</span>
        <Link to={TRIP_ROUTES.admin} className="ml-auto min-h-11 content-center text-sm font-semibold text-primary-700 underline">출장 검토로 이동</Link>
      </div>
      <ul className="mt-2 space-y-1 text-xs text-dark-600">
        {rows.slice(0, 5).map((c) => (
          <li key={c.id}>{nameOf(c.employeeId)} · {scheduleLabel(c.header.schedule)}</li>
        ))}
        {rows.length > 5 && <li>외 {rows.length - 5}건</li>}
      </ul>
      <p className="mt-2 text-xs text-dark-500">출장은 이동·현장 시간이 서버 계산으로 고정되어 있어 야근 승인과 같은 화면에서 처리하지 않고, 검토 화면에서 승인합니다.</p>
    </div>
  )
}

/**
 * 기존 야근 승인함 위에 붙이는 출장 대기 알림 (T10 안 A+B).
 * 코드 스위치 OFF · 대표(admin) 아님 → 아무것도 그리지 않고 서버도 부르지 않는다. 야근 승인 로직과 데이터는 건드리지 않는다.
 */
export function TripPendingNotice() {
  const { employee } = useAuth()
  if (!tripScreenOpen('adminReview') || employee?.role !== 'admin') return null
  return <TripConnected quiet><PendingList /></TripConnected>
}

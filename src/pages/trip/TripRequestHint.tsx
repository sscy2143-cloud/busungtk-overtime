import { Link } from 'react-router-dom'
import { Briefcase, AlertTriangle } from 'lucide-react'
import { useTrip } from '../../features/trip/screens'
import { TripConnected } from './TripConnected'
import { TRIP_ROUTES, tripClaimsOnDate, tripScreenOpen } from './trip-glue'

export function HintBody({ date }: { date: string }) {
  const { service, actor } = useTrip()
  const mine = service.myClaims(actor)
  const clash = mine.ok && date ? tripClaimsOnDate(mine.value, date) : []
  return (
    <div className="space-y-2" data-testid="trip-request-hint">
      {clash.length > 0 && (
        <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>
            {date} 에 이미 출장 신청이 있습니다. 같은 시간에 야근·잔업을 또 신청하면 같은 시간이 두 번 인정될 수 있어, 출장 시간과 겹치는지 확인해 주세요.
            <Link to={TRIP_ROUTES.employee} className="ml-1 font-semibold underline">내 출장 신청 보기</Link>
          </span>
        </div>
      )}
      <Link to={TRIP_ROUTES.employee} className="flex min-h-11 items-center gap-2 rounded-xl border border-dark-200 bg-white px-4 py-3 text-sm text-dark-700 hover:border-primary-400">
        <Briefcase size={16} className="text-primary-600" />
        <span>출장수당 대상 출장이었나요? <span className="font-semibold text-primary-700">출장으로 신청하기</span> — 지역별 이동시간은 자동으로 계산됩니다</span>
      </Link>
    </div>
  )
}

/**
 * 기존 연장근무 신청 화면 위에 붙이는 출장 안내 (직원).
 * 코드 스위치 OFF 면 아무것도 그리지 않고 서버도 부르지 않는다. 야근 신청 입력·저장 로직은 건드리지 않는다.
 */
export function TripRequestHint({ date }: { date: string }) {
  if (!tripScreenOpen('employeeForm')) return null
  return <TripConnected quiet><HintBody date={date} /></TripConnected>
}

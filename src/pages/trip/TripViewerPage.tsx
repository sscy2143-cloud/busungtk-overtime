import { TripViewerScreen } from '../../features/trip/screens'
import { TripClosedNotice, TripConnected } from './TripConnected'
import { tripScreenOpen } from './trip-glue'

/**
 * /trip/all — admin 이 조회 권한을 준 직원(팀장)의 읽기 전용 전체 출장 내역.
 * 권한 여부는 서버(trip_view_grants + RLS)가 정한다. 권한이 없으면 안내만 보이고, 승인·수정은 어디서도 열리지 않는다.
 */
export function TripViewerPage() {
  if (!tripScreenOpen('adminReview')) return <TripClosedNotice title="출장 내역 조회" />
  return (
    <TripConnected>
      <TripViewerScreen />
    </TripConnected>
  )
}

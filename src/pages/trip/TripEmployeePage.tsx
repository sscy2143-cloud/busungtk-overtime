import { useNavigate } from 'react-router-dom'
import { EmployeeTripScreen } from '../../features/trip/screens'
import { TripClosedNotice, TripConnected } from './TripConnected'
import { tripScreenOpen } from './trip-glue'

/** /trip — 직원 출장 신청. 코드 스위치가 꺼져 있으면 안내만 (서버 호출 없음) */
export function TripEmployeePage() {
  const navigate = useNavigate()
  if (!tripScreenOpen('employeeForm')) return <TripClosedNotice title="출장 신청" />
  return (
    <TripConnected>
      <EmployeeTripScreen onPickOvertime={() => navigate('/request')} />
    </TripConnected>
  )
}

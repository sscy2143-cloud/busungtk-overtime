import { useAuth } from '../../contexts/AuthContext'
import { AdminTripReview } from '../../features/trip/screens'
import { TripClosedNotice, TripConnected } from './TripConnected'
import { tripScreenOpen } from './trip-glue'

/**
 * /admin/trip — 출장 검토. App 의 AdminRoute(manager·admin)를 지나온 뒤에도 출장 검토는 admin(대표)만이다.
 * 서버(RPC·RLS)가 같은 규칙으로 다시 거부하므로 이 화면 분기는 안내용이다.
 */
export function AdminTripPage() {
  const { employee } = useAuth()
  if (!tripScreenOpen('adminReview')) return <TripClosedNotice title="출장 검토" />
  if (employee?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-lg px-4 pt-4">
        <div className="rounded-2xl border border-dark-100 bg-white p-6 text-center">
          <p className="font-semibold text-dark-800">출장 검토</p>
          <p className="mt-2 text-sm text-dark-500">출장 검토·승인은 대표(admin) 계정만 할 수 있습니다.</p>
        </div>
      </div>
    )
  }
  return (
    <TripConnected>
      <AdminTripReview />
    </TripConnected>
  )
}

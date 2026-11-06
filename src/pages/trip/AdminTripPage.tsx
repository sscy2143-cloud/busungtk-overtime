import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { AdminTripReview, PilotCompare, TripViewGrantsAdmin } from '../../features/trip/screens'
import { TripClosedNotice, TripConnected } from './TripConnected'
import { tripScreenOpen } from './trip-glue'

/**
 * /admin/trip — 출장 검토. App 의 AdminRoute(manager·admin)를 지나온 뒤에도 출장 검토는 admin(대표)만이다.
 * 서버(RPC·RLS)가 같은 규칙으로 다시 거부하므로 이 화면 분기는 안내용이다.
 */
export function AdminTripPage() {
  const { employee } = useAuth()
  const [tab, setTab] = useState<'review' | 'grants' | 'pilot'>('review')
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
      <div className="mx-auto flex max-w-2xl gap-1 border-b border-dark-200 px-4 pt-4">
        {([['review', '출장 검토'], ['grants', '조회 권한'], ['pilot', '시범 비교']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`min-h-11 px-3 text-sm ${tab === k ? 'border-b-2 border-primary-500 font-semibold text-primary-700' : 'text-dark-600'}`}>{label}</button>
        ))}
      </div>
      {tab === 'review' ? <AdminTripReview /> : tab === 'grants' ? <TripViewGrantsAdmin /> : <PilotCompare />}
    </TripConnected>
  )
}

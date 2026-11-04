import { useTrip } from '../context'
import { Card, NoticeList } from '../parts'
import { AdminTripReview } from './AdminTripReview'

/**
 * 조회 권한자 화면 — 회사 직급이 팀장인 활성 직원 중 admin 이 trip_set_view_grant 로 지정한 사람만 전체 출장 내역을 읽기 전용으로 본다.
 * 거울 자료의 재검증(권한 회수·로그아웃 뒤 남지 않게)은 원격 제공자의 revalidateKey 로 글루가 올린다.
 * 권한 여부는 서버 값(trip_view_grants, RLS)으로 판단하며, 없으면 안내만 보여 준다. 쓰기·승인은 어디서도 열리지 않는다.
 */
export function TripViewerScreen() {
  const { service, actor } = useTrip()
  if (actor.role === 'admin') return <AdminTripReview mode="viewer" />
  const feature = service.featureState('adminReview')
  if (!feature.enabled) {
    return <div className="mx-auto max-w-2xl px-4 pt-4"><Card title="출장 내역 조회"><NoticeList items={['출장 검토 기능은 아직 열리지 않았습니다']} /></Card></div>
  }
  if (!service.viewGrantState(actor).granted) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <Card title="출장 내역 조회">
          <NoticeList items={['전체 출장 내역 조회 권한이 없습니다. 필요하면 대표(admin)에게 요청하세요. 본인 신청은 "출장 신청" 화면에서 볼 수 있습니다']} />
        </Card>
      </div>
    )
  }
  return <AdminTripReview mode="viewer" />
}

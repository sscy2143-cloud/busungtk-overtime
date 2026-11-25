import { useState } from 'react'
import { Briefcase, Moon } from 'lucide-react'
import { useTrip } from './context'
import { Button, Card, NoticeList } from './parts'
import { MyTripClaims } from './MyTripClaims'
import { TripClaimForm } from './TripClaimForm'

/**
 * 통합 근무 신청 입구. 종류를 고른 뒤 종류별 양식으로 간다.
 * 사무실 야근은 기존 화면을 그대로 쓴다 — 여기서는 호출자가 준 이동 함수만 부르고, 연결은 보류 상태다.
 */
export function WorkRequestEntry({ onPickOvertime, onPickTrip }: { onPickOvertime?: () => void; onPickTrip: () => void }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pt-4">
      <h2 className="text-lg font-bold text-dark-900">근무 신청</h2>
      <p className="text-sm text-dark-600">어떤 근무를 신청하나요? 근무를 마친 뒤 신청합니다.</p>
      <div className="grid gap-3">
        <button type="button" onClick={onPickOvertime} disabled={!onPickOvertime} className="flex min-h-20 items-center gap-4 rounded-xl border border-dark-200 bg-white p-4 text-left hover:border-primary-400 disabled:opacity-60">
          <Moon className="text-dark-500" />
          <span>
            <span className="block font-medium text-dark-900">사무실 야근·잔업</span>
            <span className="block text-xs text-dark-500">{onPickOvertime ? '기존 야근 신청 화면으로 갑니다' : '기존 야근 신청 화면과 연결은 보류 중입니다'}</span>
          </span>
        </button>
        <button type="button" onClick={onPickTrip} className="flex min-h-20 items-center gap-4 rounded-xl border border-dark-200 bg-white p-4 text-left hover:border-primary-400">
          <Briefcase className="text-primary-600" />
          <span>
            <span className="block font-medium text-dark-900">출장 (근거리 현장 포함)</span>
            <span className="block text-xs text-dark-500">지역과 현장 시각만 입력하면 유형과 이동시간은 자동으로 정합니다</span>
          </span>
        </button>
      </div>
    </div>
  )
}

type View = { name: 'entry' } | { name: 'list' } | { name: 'form'; claimId?: string }

/** 직원 쪽 전체 흐름: 입구 → 목록 → 양식. 기능이 닫혀 있으면 안내만 보여 준다 */
export function EmployeeTripScreen({ onPickOvertime, startAt = 'entry' }: { onPickOvertime?: () => void; startAt?: 'entry' | 'list' }) {
  const { service, revision } = useTrip()
  const [view, setView] = useState<View>(startAt === 'list' ? { name: 'list' } : { name: 'entry' })
  const feature = service.featureState('employeeForm')

  if (!feature.enabled) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 pt-4">
        <Card title="출장 신청">
          <NoticeList items={['출장수당 기능은 아직 열리지 않았습니다. 도입 공지 후 사용할 수 있습니다']} />
        </Card>
      </div>
    )
  }

  switch (view.name) {
    case 'entry':
      return <WorkRequestEntry onPickOvertime={onPickOvertime} onPickTrip={() => setView({ name: 'list' })} />
    case 'list':
      return (
        <div>
          {startAt === 'entry' && <div className="mx-auto max-w-lg px-4 pt-2"><Button kind="ghost" onClick={() => setView({ name: 'entry' })}>← 근무 종류 선택</Button></div>}
          <MyTripClaims key={revision} onOpen={(claimId) => setView({ name: 'form', claimId })} onNew={() => setView({ name: 'form' })} />
        </div>
      )
    case 'form':
      return <TripClaimForm key={view.claimId ?? 'new'} claimId={view.claimId} onBack={() => setView({ name: 'list' })} />
  }
}

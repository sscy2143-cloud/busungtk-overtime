import { useState } from 'react'
import type { TripClaimRecord } from '../data'
import { formatHours } from '../ui'
import { useTrip } from './context'
import { Button, Card, ErrorBanner, StatusPill } from './parts'
import { claimDates, regionLabel } from './helpers'

/** 내 출장 신청 목록. 동행 초안은 따로 표시한다 */
export function MyTripClaims({ onOpen, onNew }: { onOpen: (claimId: string) => void; onNew: () => void }) {
  const { service, actor, bump } = useTrip()
  const [error, setError] = useState<{ code: string; message: string } | undefined>()
  const r = service.myClaims(actor)

  if (!r.ok) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 pt-4">
        <ErrorBanner error={{ code: r.code, message: r.message }} />
      </div>
    )
  }
  const claims = [...r.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const cancel = async (c: TripClaimRecord) => {
    const x = await service.cancel(actor, c.id, c.version)
    if (!x.ok) setError({ code: x.code, message: x.message })
    else { setError(undefined); bump() }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-8 pt-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-dark-900">내 출장 신청</h2>
        <Button onClick={onNew}>새 신청</Button>
      </header>
      <ErrorBanner error={error} onDismiss={() => setError(undefined)} />
      {claims.length === 0 && <p className="text-sm text-dark-500">아직 신청이 없습니다</p>}
      {claims.map((c) => {
        const calcs = service.latestCalcs(actor, c.id)
        const totals = calcs.ok ? calcs.value.reduce((t, x) => {
          if (!x.result?.ok) return t
          return { trip: t.trip + x.result.trip.hours, overtime: t.overtime + x.result.overtime.hours, proposed: t.proposed || x.result.status === 'proposed' }
        }, { trip: 0, overtime: 0, proposed: false }) : null
        const editable = c.status === 'draft' || c.status === 'returned'
        return (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-dark-900">{claimDates(c)}</p>
                <p className="text-sm text-dark-600">{c.header.regions.map(regionLabel).join(' → ')}</p>
              </div>
              <StatusPill status={c.status} />
            </div>
            {c.origin === 'companion_draft' && c.status === 'draft' && (
              <p className="mt-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-900">동행자가 보낸 초안 — 내용을 확인하고 직접 제출해야 신청됩니다</p>
            )}
            {totals && (
              <p className="mt-2 text-sm text-dark-700">
                출장 {formatHours(totals.trip)} · 연장 {formatHours(totals.overtime)}
                {totals.proposed && <span className="ml-2 text-xs text-amber-800">관리자 확인 필요 항목 있음</span>}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button kind="secondary" onClick={() => onOpen(c.id)}>{editable ? '열어서 고치기' : '보기'}</Button>
              {['draft', 'submitted', 'returned'].includes(c.status) && <Button kind="danger" onClick={() => { void cancel(c) }}>취소</Button>}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

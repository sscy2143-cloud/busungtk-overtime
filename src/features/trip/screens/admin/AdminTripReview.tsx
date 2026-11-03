import { useState } from 'react'
import type { ClaimStatus } from '../../data'
import { CLAIM_STATUS_LABEL, formatHours, toReviewRow } from '../../ui'
import { employeeName, useTrip } from '../context'
import { Button, Card, ErrorBanner, NoticeList, StatusPill } from '../parts'
import { claimDates, regionLabel } from '../helpers'
import { ClaimReviewDetail } from './ClaimReviewDetail'

const FILTERS: (ClaimStatus | 'all')[] = ['submitted', 'returned', 'approved', 'rejected', 'draft', 'cancelled', 'all']

/** 관리자 출장 검토 목록 (T4). 기존 승인 화면에 탭으로 붙이는 것은 보류 — 독립 화면 */
export function AdminTripReview() {
  const { service, actor, employees, revision } = useTrip()
  const [filter, setFilter] = useState<ClaimStatus | 'all'>('submitted')
  const [selected, setSelected] = useState<string | null>(null)

  const feature = service.featureState('adminReview')
  if (!feature.enabled) {
    return <div className="mx-auto max-w-2xl px-4 pt-4"><Card title="출장 검토"><NoticeList items={['출장 검토 기능은 아직 열리지 않았습니다']} /></Card></div>
  }
  if (selected) return <ClaimReviewDetail key={`${selected}-${revision}`} claimId={selected} onBack={() => setSelected(null)} />

  const q = service.reviewQueue(actor, filter === 'all' ? undefined : filter)
  if (!q.ok) return <div className="mx-auto max-w-2xl px-4 pt-4"><ErrorBanner error={{ code: q.code, message: q.message }} /></div>

  const rows = q.value
    .sort((a, b) => (a.submittedAt ?? a.updatedAt).localeCompare(b.submittedAt ?? b.updatedAt))
    .map((claim) => {
      const calcs = service.latestCalcs(actor, claim.id)
      const dates = claimDates(claim)
      return { claim, row: toReviewRow(claim, calcs.ok ? calcs.value : [], [dates]) }
    })

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-8 pt-4">
      <h2 className="text-lg font-bold text-dark-900">출장 검토</h2>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`min-h-9 rounded-full px-3 text-sm ${filter === f ? 'bg-dark-900 text-white' : 'bg-dark-100 text-dark-700'}`}>
            {f === 'all' ? '전체' : CLAIM_STATUS_LABEL[f]}
          </button>
        ))}
      </div>
      {rows.length === 0 && <p className="text-sm text-dark-500">해당하는 신청이 없습니다</p>}
      {rows.map(({ claim, row }) => (
        <Card key={claim.id}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-dark-900">{employeeName(employees, claim.employeeId)} {row.companion && <span className="ml-1 text-xs text-sky-800">동행</span>}</p>
              <p className="text-sm text-dark-600">{row.dates.join(', ')} · {claim.header.regions.map(regionLabel).join(' → ')}</p>
            </div>
            <StatusPill status={claim.status} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-green-50 p-2 text-green-900">
              <p className="text-xs">확정</p>
              <p>출장 {formatHours(row.confirmed.trip)} · 연장 {formatHours(row.confirmed.overtime)}{row.confirmed.holiday > 0 && ` · 휴일 ${formatHours(row.confirmed.holiday)}`}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-900">
              <p className="text-xs">제안값 (회사 확정 전)</p>
              <p>출장 {formatHours(row.proposed.trip)} · 연장 {formatHours(row.proposed.overtime)}{row.proposed.holiday > 0 && ` · 휴일 ${formatHours(row.proposed.holiday)}`}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-dark-600">
              {row.hasError && <span className="mr-2 text-red-700">입력 부족·계산 오류</span>}
              {row.reviewCount > 0 ? `확인 항목 ${row.reviewCount}건` : '확인 항목 없음'}
            </p>
            <Button kind="secondary" onClick={() => setSelected(claim.id)}>검토</Button>
          </div>
        </Card>
      ))}
    </div>
  )
}

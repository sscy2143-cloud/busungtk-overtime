/**
 * 관리자 검토 상세(T4) 표시 모델. 서비스의 review 와 같은 기준으로 승인 가능 여부를 낸다.
 */

import { reviewItems, type ClaimDetailData, type FlagDecision, type TripCalcRecord } from '../data'
import { buildDayPreview, type DayPreview } from './preview'
import { approvalBlockers } from './review-model'
import { FLAG_TITLE, flagTitle } from './labels'
import { formatHours } from './format'

export interface ReviewItemView {
  calcId: string
  code: string
  title: string
  message: string
  /** 미확정 규칙 적용 = 제안값. 확인해도 확정 규정이 되지 않는다 */
  undecidedRule: boolean
  acknowledged: boolean
}

export interface DayDetailView {
  date: string
  dayId: string
  revision: number
  calc?: TripCalcRecord
  preview: DayPreview
  items: ReviewItemView[]
  /** 다음 날로 넘어간 작업·이동 */
  carryOut?: { toDate: string; text: string; linked: boolean }
  carryIn?: { fromDate: string; text: string }
}

export interface ClaimDetailView {
  days: DayDetailView[]
  /** 승인 전에 반드시 봐야 하는 경고 (확인 항목과 별개로 눈에 띄게) */
  warnings: string[]
  blockers: string[]
  /** 승인 요청에 넣을 계산 결과 id (화면에 보인 것) */
  expectedCalcIds: string[]
  /** 승인 당시 계산 결과 — 승인 뒤 바뀌었는지 */
  approvedSnapshot?: { calcIds: string[]; changedSinceApproval: boolean; at: string }
  proposedNote?: string
}

const EMPTY_PREVIEW: DayPreview = { heading: '계산 전', prompts: [], errors: [], rows: [], standardTravel: [], notices: [], staffNotices: [], flags: [] }

const rangeText = (r: { start: number; end: number }) => formatHours(r.end - r.start)
const carryText = (c: { work?: { start: number; end: number }; travel: { start: number; end: number }[] }) =>
  [c.work ? `작업 ${rangeText(c.work)}` : null, ...c.travel.map((t) => `이동 ${rangeText(t)}`)].filter(Boolean).join(', ')

export function buildClaimDetail(data: ClaimDetailData, decisions: FlagDecision[]): ClaimDetailView {
  const { claim, days, calcs, reviews, mismatches, sameDayOthers } = data
  const calcByDay = new Map(calcs.map((c) => [c.dayId, c]))

  const dayViews: DayDetailView[] = days.map((d) => {
    const calc = calcByDay.get(d.id)
    const flags = calc?.result?.ok ? calc.result.flags : []
    const items: ReviewItemView[] = calc
      ? reviewItems(calc).map((code) => {
        const f = flags.find((x) => x.code === code)
        const notice = calc.classification.notices.find((n) => n.code === code)
        return {
          calcId: calc.id,
          code,
          title: flagTitle(code),
          message: f?.message ?? notice?.message ?? FLAG_TITLE[code] ?? code,
          undecidedRule: f?.kind === 'undecided_rule',
          acknowledged: decisions.some((x) => x.calcId === calc.id && x.code === code),
        }
      })
      : []
    return {
      date: d.date,
      dayId: d.id,
      revision: d.revision,
      calc,
      preview: calc ? buildDayPreview(calc) : EMPTY_PREVIEW,
      items,
      ...(calc?.carryOut ? { carryOut: { toDate: calc.carryOut.toDate, text: carryText(calc.carryOut), linked: calc.carryOut.linkedDayId !== undefined } } : {}),
      ...(calc?.carryIn ? { carryIn: { fromDate: calc.carryIn.fromDate, text: carryText(calc.carryIn) } } : {}),
    }
  })

  const warnings: string[] = []
  for (const m of mismatches) {
    const what = m.field === 'site' ? '현장 시각' : m.field === 'regions' ? '지역' : '근무일 유무'
    warnings.push(`${m.date} 동행자 간 ${what}이 다릅니다 (${m.employeeIds.join(', ')})`)
  }
  for (const o of sameDayOthers) warnings.push(`${o.date}에 같은 직원의 다른 진행 중 신청이 있습니다 (${o.claimId})`)
  for (const d of dayViews) {
    if (d.carryOut && !d.carryOut.linked) warnings.push(`${d.date} → ${d.carryOut.toDate} 로 넘어간 ${d.carryOut.text}: 다음 날 기록이 없습니다`)
    if (d.calc && d.calc.dayRevision !== d.revision) warnings.push(`${d.date} 입력이 계산 뒤에 바뀌었습니다 (재계산 필요)`)
  }

  const approval = reviews.filter((r) => r.action === 'approve').at(-1)
  const approvedSnapshot = approval
    ? {
      calcIds: approval.calcIds,
      at: approval.at,
      changedSinceApproval: JSON.stringify([...approval.calcIds].sort()) !== JSON.stringify(calcs.map((c) => c.id).sort()),
    }
    : undefined
  if (approvedSnapshot?.changedSinceApproval) warnings.push('승인 뒤 계산 결과가 바뀌었습니다. 승인은 당시 결과에 묶여 있으며 정산도 그 결과를 씁니다')

  const anyProposed = calcs.some((c) => c.result?.ok && c.result.status === 'proposed')
  return {
    days: dayViews,
    warnings,
    blockers: approvalBlockers(claim, calcs, decisions),
    expectedCalcIds: calcs.map((c) => c.id),
    ...(approvedSnapshot ? { approvedSnapshot } : {}),
    ...(anyProposed ? { proposedNote: '제안값(미확정 규칙)이 있습니다. 확인 표시를 해도 규정이 확정되는 것은 아니며, 정산에서는 보류됩니다' } : {}),
  }
}

/**
 * 신청 미리보기 · 관리자 상세에서 같이 쓰는 계산 결과 표시 모델
 */

import type { ValueStatus } from '../engine'
import type { TripCalcRecord } from '../data'
import { formatHours, formatRange } from './format'
import { DAY_KIND_LABEL, FLAG_KIND_LABEL, MISSING_FIELD_PROMPT, WORK_TYPE_LABEL, flagTitle } from './labels'

export interface PreviewRow {
  label: string
  hours: number
  text: string
  status: ValueStatus
}

export interface DayPreview {
  heading: string
  /** 계산할 수 없을 때 직원에게 보여 줄 질문 */
  prompts: string[]
  errors: string[]
  rows: PreviewRow[]
  /** 계산에 쓴 표준 이동 구간 — 실제 시각이 아님 */
  standardTravel: string[]
  notices: string[]
  flags: { title: string; kind: string; message: string }[]
  /** 미확정 규칙이 있으면 안내 */
  proposedNote?: string
}

export function buildDayPreview(calc: TripCalcRecord): DayPreview {
  const { classification: cls, result } = calc
  const heading = [cls.workType ? WORK_TYPE_LABEL[cls.workType] : '확인 필요', DAY_KIND_LABEL[cls.dayKind]].join(' · ')
  const base: DayPreview = {
    heading,
    prompts: cls.missing.map((m) => MISSING_FIELD_PROMPT[m]),
    errors: [],
    rows: [],
    standardTravel: [],
    notices: cls.notices.map((n) => n.message),
    flags: [],
  }
  if (!result) return base
  if (!result.ok) return { ...base, errors: result.errors.map((e) => e.message) }

  const row = (label: string, hours: number, status: ValueStatus): PreviewRow => ({ label, hours, text: formatHours(hours), status })
  const rows: PreviewRow[] = result.holiday
    ? [
      row('휴일근로 (8시간 이내)', result.holiday.within8Hours, result.status),
      row('휴일근로 (8시간 초과)', result.holiday.over8Hours, result.status),
    ]
    : [
      row('출장', result.trip.hours, result.valueStatus.trip),
      row('그중 야간 이동', result.trip.nightTravelHours, result.valueStatus.nightTravel),
      row('연장', result.overtime.hours, result.valueStatus.overtime),
      row('그중 야간', result.overtime.nightHours, result.valueStatus.nightOvertime),
    ]
  return {
    ...base,
    rows,
    standardTravel: result.trace.travel.map(formatRange),
    flags: result.flags.map((f) => ({ title: flagTitle(f.code), kind: FLAG_KIND_LABEL[f.kind], message: f.message })),
    ...(result.status === 'proposed'
      ? { proposedNote: '일부 값은 회사 규정이 아직 정해지지 않아 제안값입니다. 관리자 확인 전에는 급여에 반영되지 않습니다' }
      : {}),
  }
}

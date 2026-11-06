/**
 * 신청 한 건의 근무일 전부를 계산한다 — 저장소에 기대지 않는 순수 함수.
 *
 * 메모리 서비스(service.ts)와 실제 서버 계산(T6: Vercel Function / Edge Function)이 같은 함수를 쓴다.
 * 클라이언트가 보낸 계산 결과를 저장하지 않고, 서버가 가진 입력 원본으로 여기서 다시 계산하는 것이 조작 방지의 핵심이다.
 *
 *  1. 하루씩 분류·계산 (computeDay)
 *  2. 다음 근무일로 넘어간 작업·이동 연결 (5-4, E7) — 같은 신청 안의 다음 날, 또는 다른 진행 중 신청
 *  3. 넘어온 작업과 다음 날 입력이 맞는지 (누락·겹침·빈틈) → 관리자 확인 항목
 *  4. 같은 날 다른 신청(기존 야근 등) → 관리자 확인 항목 (5-8 같은 시간 중복 지급 금지)
 */

import { addDays, weekStartOf, type HolidayCalendar, type IsoDate } from './calendar.js'
import { classifyDay } from './classify.js'
import { calculateTripDay } from '../engine/index.js'
import type { ClaimHeader, DayEntry, Notice, TripCalcRecord, TripDayRecord } from './types.js'
import type { ClassifyOptions } from './classify.js'

export type DayComputation = Pick<TripCalcRecord, 'classification' | 'engineInput' | 'result' | 'carryIn' | 'carryOut'>
export type DayComputationWithDay = DayComputation & { day: TripDayRecord }

/** 하루 분류 + 계산. 저장과 화면 미리보기가 같은 함수를 쓴다 */
export function computeDay(header: ClaimHeader, entry: DayEntry, opts: ClassifyOptions): DayComputation {
  const cls = classifyDay(header, entry, opts)
  const result = cls.input ? calculateTripDay(cls.input) : null
  const { input, ...classification } = cls
  // 엔진이 "이동 시각을 입력하세요"로 답하면 그 항목만 추가로 묻는다 (E4 충돌)
  if (result && !result.ok && result.errors.some((e) => e.code === 'E4_TRAVEL_CONFLICT')) {
    classification.missing = [...classification.missing, 'travelStarts.out']
  }
  return { classification, engineInput: input, result }
}

export interface ClaimComputeArgs {
  header: ClaimHeader
  employeeId: string
  days: TripDayRecord[]
  calendar: HolidayCalendar
  /** 5-6: 그 주(월요일 시작)에 결근·연차가 있는지 */
  absenceLookup?: (employeeId: string, weekStart: IsoDate) => boolean
  /** 같은 직원의 다른 진행 중 신청의 근무일 (이 신청 밖) — 다음 날 연결용 */
  findActiveDay?: (employeeId: string, date: IsoDate) => TripDayRecord | undefined
  /** 같은 날 기존 야근 등 다른 신청의 표시 문구. 비어 있지 않으면 관리자 확인 항목 */
  otherRequestLookup?: (employeeId: string, date: IsoDate) => string[]
}

const fmt = (h: number) => {
  const t = Math.round(h * 60)
  const d = Math.floor(t / 1440)
  const m = ((t % 1440) + 1440) % 1440
  return `${d > 0 ? '다음 날 ' : ''}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const withNotice = (d: DayComputation, n: Notice): void => {
  d.classification = { ...d.classification, notices: [...d.classification.notices, n] }
}

export function computeClaimDays(args: ClaimComputeArgs): DayComputationWithDay[] {
  const { header, employeeId, days, calendar } = args
  const drafts: DayComputationWithDay[] = days.map((day) => ({
    day,
    ...computeDay(header, day.entry, { calendar, weekHasAbsenceOrLeave: args.absenceLookup?.(employeeId, weekStartOf(day.date)) }),
  }))

  // 2. 다음 근무일로 넘어간 작업·이동 연결
  for (const d of drafts) {
    const r = d.result
    if (!r || !r.ok || (!r.nextDay && !r.nextDayTravel)) continue
    const toDate = addDays(d.day.date, 1)
    const sibling = drafts.find((x) => x.day.date === toDate)
    const linked = sibling?.day ?? args.findActiveDay?.(employeeId, toDate)
    d.carryOut = { toDate, ...(r.nextDay ? { work: r.nextDay } : {}), travel: r.nextDayTravel ?? [], ...(linked ? { linkedDayId: linked.id } : {}) }
    if (sibling) sibling.carryIn = { fromDate: d.day.date, ...(r.nextDay ? { work: r.nextDay } : {}), travel: r.nextDayTravel ?? [] }
    if (!linked) {
      withNotice(d, { code: 'NEXT_DAY_ENTRY_MISSING', message: `${toDate} 근무 기록이 없습니다. 다음 날로 넘어간 작업·이동을 그날 기록에 넣어야 합니다` })
    }
  }

  // 3. 넘어온 작업 ↔ 다음 날 입력 대조 (누락·겹침·빈틈은 두 번 계산되거나 빠질 수 있다)
  for (const d of drafts) {
    const w = d.carryIn?.work
    if (!w) continue
    const from = d.carryIn!.fromDate
    const expected = { start: w.start - 24, end: w.end - 24 } // 전날 기준 시각 → 이날 기준
    const site = d.engineInput?.site
    if (!site) {
      withNotice(d, { code: 'CARRY_IN_NOT_ENTERED', message: `${from}에서 넘어온 작업 ${fmt(expected.start)}~${fmt(expected.end)}이 이날 현장 작업에 없습니다. 빠지면 그 시간은 어느 날에도 계산되지 않습니다` })
    } else if (site.start < expected.start - 1e-9) {
      withNotice(d, { code: 'CARRY_IN_OVERLAP', message: `이날 현장 시작 ${fmt(site.start)}이 ${from}에서 넘어온 작업 시작 ${fmt(expected.start)}보다 빠릅니다. ${fmt(site.start)}~${fmt(expected.start)}은 전날 계산에 이미 들어 있어 두 번 계산될 수 있습니다` })
    } else if (site.start > expected.start + 1e-9) {
      withNotice(d, { code: 'CARRY_IN_GAP', message: `${from}에서 넘어온 작업은 ${fmt(expected.start)}부터인데 이날 현장 시작이 ${fmt(site.start)}입니다. 그 사이 시간이 어느 날에도 들어가지 않습니다` })
    }
  }

  // 4. 같은 날 다른 신청 (기존 야근 등)
  if (args.otherRequestLookup) {
    for (const d of drafts) {
      const others = args.otherRequestLookup(employeeId, d.day.date)
      if (others.length > 0) {
        withNotice(d, { code: 'OTHER_REQUEST_SAME_DAY', message: `같은 날 다른 신청이 있습니다: ${others.join(', ')}. 같은 시간을 두 번 지급하지 않도록 확인하세요 (5-8)` })
      }
    }
  }

  return drafts
}

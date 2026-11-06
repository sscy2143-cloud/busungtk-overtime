/**
 * 근무 유형 자동 분류 + 엔진 입력 만들기
 *
 * 직원은 근무 유형을 고르지 않는다. 출장 일정(당일/숙박)과 그날 입력으로 판정한다.
 *
 *   지역이 모두 제외 지역                → ① 제외 지역 현장
 *   현장 작업 없음 표시 / 사무실만 있음  → ⑥ 작업 없는 이동일   (출발 시각 필요)
 *   사무실 근무 + 현장 작업              → ⑤ 사무실 근무 후 출발 (출발 시각은 비워도 됨 — E4)
 *   현장 작업만                          → 당일 ② / 숙박 첫날 ③ / 마지막 날 ④ / 중간일 ⑦(E5)
 *
 * 판정할 수 없거나 정보가 모자라면 missing 으로 돌려주고, 화면은 그 항목만 추가로 묻는다.
 */

import { REGIONS, type HourRange, type TravelLegInput, type TripDayInput, type WorkType } from '../engine/index.js'
import { dayKindOf, isVerifiedCalendar, type HolidayCalendar, type IsoDate } from './calendar.js'
import { toHour, toHourRange } from './time-input.js'
import type { ClaimHeader, Classification, DayEntry, DayPosition, MissingField, Notice, Schedule } from './types.js'

const NEXT_DAY_9 = 33

export function dayPosition(schedule: Schedule, date: IsoDate): DayPosition | null {
  if (schedule.kind === 'day') return date === schedule.date ? 'single' : null
  const { startDate, endDate } = schedule
  if (date < startDate || date > endDate) return null
  if (startDate === endDate) return 'single'
  if (date === startDate) return 'first'
  if (date === endDate) return 'last'
  return 'middle'
}

const SITE_TYPE: Record<DayPosition, WorkType> = {
  single: 'day_trip',
  first: 'stay_outbound',
  last: 'stay_return',
  middle: 'stay_middle',
}

/** ⑤⑥ 그날의 이동 방향 */
const LEG_DIRECTIONS: Record<DayPosition, ('out' | 'back')[]> = {
  single: ['out', 'back'],
  first: ['out'],
  last: ['back'],
  middle: [],
}

export interface ClassifyOptions {
  calendar: HolidayCalendar
  /** 5-6: 토요일 근무 주에 결근·연차가 있는지 (시스템이 조회해서 넘김) */
  weekHasAbsenceOrLeave?: boolean
}

export function classifyDay(header: ClaimHeader, entry: DayEntry, opts: ClassifyOptions): Classification {
  const notices: Notice[] = []
  const missing: MissingField[] = []
  const dayKind = dayKindOf(entry.date, opts.calendar.holidays)
  const position = dayPosition(header.schedule, entry.date)
  if (position === null) {
    return {
      workType: null, dayKind, position: 'single', input: null, missing: [],
      notices: [{ code: 'DATE_OUT_OF_SCHEDULE', message: `${entry.date}은 출장 일정 밖의 날짜입니다` }],
    }
  }
  if (!isVerifiedCalendar(opts.calendar)) {
    notices.push({
      code: 'HOLIDAY_SOURCE_UNVERIFIED',
      message: `공휴일 달력 출처가 검증되지 않았습니다 (${opts.calendar.source}). 평일·토요일·휴일 구분을 관리자가 확인해야 합니다`,
    })
  }

  const regions = entry.regions ?? header.regions
  const classes = regions.map((r) => (Object.hasOwn(REGIONS, r) ? REGIONS[r] : undefined))
  const allExcluded = classes.length > 0 && classes.every((c) => c?.kind === 'excluded')
  const isJeju = classes.some((c) => c?.kind === 'jeju')

  const site = entry.site ? toHourRange(entry.site, '현장 작업', notices) : null
  const office = entry.office ? toHourRange(entry.office, '사무실 근무', notices) : null
  if (entry.site && !site) notices.push({ code: 'INVALID_TIME', message: '현장 작업 시각 형식이 올바르지 않습니다' })
  if (entry.office && !office) notices.push({ code: 'INVALID_TIME', message: '사무실 근무 시각 형식이 올바르지 않습니다' })

  let workType: WorkType
  if (allExcluded) {
    workType = 'excluded_site'
    if (!site) missing.push('site')
  } else if (entry.noSiteWork || (office && !site)) {
    workType = 'travel_only'
    if (entry.noSiteWork && !entry.noSiteWork.reason.trim()) missing.push('noSiteWork.reason')
  } else if (!site) {
    workType = SITE_TYPE[position]
    missing.push('site')
  } else if (office) {
    workType = 'office_then_depart'
  } else {
    workType = SITE_TYPE[position]
  }

  // 제주(E6): 실제 이동 시각과 증빙이 반드시 필요
  const jejuPath = isJeju && workType !== 'stay_middle' && workType !== 'excluded_site'
  if (jejuPath) {
    if (!entry.jeju?.legs.length) missing.push('jeju.legs')
    if (!entry.jeju?.evidenceFileIds.length) missing.push('jeju.evidence')
  }

  // ⑤⑥ 이동 구간: 출발 시각은 입력이 있으면 쓰고, 없으면 엔진이 E4 제안 위치에 놓는다.
  // 현장이 없는 ⑥은 기준 시각이 없으므로 출발 시각을 받아야 한다.
  let legs: TravelLegInput[] | undefined
  if (!jejuPath && (workType === 'office_then_depart' || workType === 'travel_only')) {
    legs = LEG_DIRECTIONS[position].map((direction) => {
      const given = entry.travelStarts?.[direction]
      let start = toHour(given)
      // 복귀 출발이 현장 작업 시작보다 이르면 다음 날 새벽으로 본다 (사례 16: 복귀 02시 → 26).
      // 현장이 없는 날(사례 11: 10시 복귀 후 사무실 정리)은 입력 그대로 쓴다
      if (start !== undefined && direction === 'back' && site && start < site.start) {
        start += 24
        notices.push({ code: 'AUTO_NEXT_DAY', message: `복귀 출발 ${given}를 다음 날로 보았습니다. 맞는지 확인하세요` })
      }
      if (start === undefined && workType === 'travel_only') missing.push(direction === 'out' ? 'travelStarts.out' : 'travelStarts.back')
      return start === undefined ? { direction } : { direction, start }
    })
  }

  if (site && site.end > NEXT_DAY_9) {
    notices.push({
      code: 'NEXT_DAY_SPLIT',
      message: '작업이 다음 날 09시를 넘었습니다. 09시 이후는 다음 근무일로 넘어갑니다 (E7 제안). 휴게 시각을 함께 입력하세요',
    })
  }

  const ranges = (rs: DayEntry['breaks'], label: string): HourRange[] | undefined =>
    rs?.map((r) => toHourRange(r, label, notices)).filter((r): r is HourRange => r !== null)

  const input: TripDayInput | null = missing.length > 0 ? null : {
    workType,
    dayKind,
    regions,
    lunchTaken: entry.lunchTaken ?? true,
    ...(site ? { site } : {}),
    ...(office ? { office } : {}),
    ...(entry.breaks?.length ? { breaks: ranges(entry.breaks, '휴게') } : {}),
    ...(entry.directedWaits?.length ? { directedWaits: ranges(entry.directedWaits, '회사 지시 대기') } : {}),
    ...(legs ? { legs } : {}),
    ...(entry.assemblyAt !== undefined ? { assemblyAt: toHour(entry.assemblyAt) } : {}),
    ...(entry.delay ? { delay: { hours: entry.delay.hours, evidenceAttached: entry.delay.evidenceFileIds.length > 0 } } : {}),
    ...(jejuPath && entry.jeju
      ? { jejuActualLegs: ranges(entry.jeju.legs, '제주 이동'), jejuEvidenceAttached: entry.jeju.evidenceFileIds.length > 0 }
      : {}),
    ...(entry.earlyLeaveDirected ? { earlyLeaveDirected: true } : {}),
    ...(dayKind === 'saturday' && opts.weekHasAbsenceOrLeave ? { weekHasAbsenceOrLeave: true } : {}),
    ...(entry.actual
      ? { actualRecord: { departAt: toHour(entry.actual.departAt), arriveAt: toHour(entry.actual.arriveAt, entry.actual.arriveNextDay) } }
      : {}),
  }

  return { workType, dayKind, position, input, missing, notices }
}

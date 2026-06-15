/**
 * 한국 근로기준법 기반 초과근무 자동 분류 및 수당 계산
 *
 * 모든 시간은 KST (한국 표준시, UTC+9) 기준
 *
 * 연장근로: 정규시간(09:00~18:00) 외 근무 → 1.5배
 * 야간근로: 22:00~06:00 → 1.5배 (연장 중복 시 2.0배)
 * 휴일근로: 토/일/공휴일 → 8h 이내 1.5배, 8h 초과 2.0배
 * 휴일+야간: 8h 이내 2.0배, 8h 초과 2.5배
 */

// ── 2026년 한국 공휴일 (대체공휴일 포함) ──────────────
export const KOREAN_HOLIDAYS_2026: string[] = [
  '2026-01-01', // 신정
  '2026-02-16', // 설날 연휴
  '2026-02-17', // 설날
  '2026-02-18', // 설날 연휴
  '2026-03-01', // 삼일절 (일)
  '2026-03-02', // 삼일절 대체공휴일
  '2026-05-05', // 어린이날
  '2026-05-24', // 부처님오신날 (일)
  '2026-05-25', // 부처님오신날 대체공휴일
  '2026-06-06', // 현충일
  '2026-08-15', // 광복절 (토)
  '2026-08-17', // 광복절 대체공휴일
  '2026-10-03', // 개천절 (추석 연휴 겹침)
  '2026-10-04', // 추석 (일)
  '2026-10-05', // 추석 연휴
  '2026-10-06', // 추석/개천절 대체공휴일
  '2026-10-09', // 한글날
  '2026-12-25', // 크리스마스
]

const holidaySet = new Set(KOREAN_HOLIDAYS_2026)

/** 해당 날짜가 휴일(토/일/공휴일)인지 판별 */
export function isHolidayDate(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00+09:00')
  const day = d.getDay()
  if (day === 0 || day === 6) return true // 토/일
  return holidaySet.has(dateStr)
}

/** 해당 날짜의 공휴일 이름 반환 (없으면 null) */
export function getHolidayName(dateStr: string): string | null {
  const d = new Date(dateStr + 'T00:00:00+09:00')
  const day = d.getDay()

  const names: Record<string, string> = {
    '2026-01-01': '신정',
    '2026-02-16': '설날 연휴',
    '2026-02-17': '설날',
    '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절',
    '2026-03-02': '삼일절 대체공휴일',
    '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날',
    '2026-05-25': '부처님오신날 대체공휴일',
    '2026-06-06': '현충일',
    '2026-08-15': '광복절',
    '2026-08-17': '광복절 대체공휴일',
    '2026-10-03': '개천절',
    '2026-10-04': '추석',
    '2026-10-05': '추석 연휴',
    '2026-10-06': '대체공휴일',
    '2026-10-09': '한글날',
    '2026-12-25': '크리스마스',
  }

  if (names[dateStr]) return names[dateStr]
  if (day === 0) return '일요일'
  if (day === 6) return '토요일'
  return null
}

// ── 분류 결과 타입 ────────────────────────────────────
export interface OvertimeBreakdown {
  /** 총 근무 분 */
  totalMinutes: number
  /** 연장근로 분 (평일 정규시간 외, 야간 제외) */
  extendedMinutes: number
  /** 야간근로 분 (22:00~06:00, 평일) */
  nightMinutes: number
  /** 휴일근로 분 (8h 이내, 야간 제외) */
  holidayMinutes: number
  /** 휴일 8h 초과분 (야간 제외) */
  holidayOvertimeMinutes: number
  /** 휴일+야간 중복분 (8h 이내) */
  holidayNightMinutes: number
  /** 휴일 8h 초과+야간 중복분 */
  holidayOvertimeNightMinutes: number
  /** 휴일 여부 */
  isHoliday: boolean
  /** 수당 요약 항목 */
  payItems: PayItem[]
  /** 자동 판정된 주요 유형 */
  primaryType: 'extended' | 'night' | 'holiday'
}

export interface PayItem {
  label: string
  minutes: number
  multiplier: number
}

/**
 * 초과근무 시간 자동 분류
 *
 * @param dateStr - 근무 날짜 (YYYY-MM-DD)
 * @param startTime - 시작 시간 (HH:MM)
 * @param endTime - 종료 시간 (HH:MM), 시작보다 이르면 익일로 간주
 * @param forceHoliday - 공휴일 수동 지정 (평일인데 임시공휴일 등)
 */
export function calculateOvertimeBreakdown(
  dateStr: string,
  startTime: string,
  endTime: string,
  forceHoliday = false,
): OvertimeBreakdown {
  const isHoliday = forceHoliday || isHolidayDate(dateStr)

  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)

  let startMin = sh * 60 + sm
  let endMin = eh * 60 + em

  // 종료가 시작보다 이르면 익일(+24h)
  if (endMin <= startMin) endMin += 24 * 60

  const rawMinutes = endMin - startMin
  if (rawMinutes <= 0) {
    return emptyBreakdown(isHoliday)
  }

  const effectiveEndMin = endMin

  // 2026-05-01부터 완충구간 변경 (17:30~18:30 → 18:00~19:00)
  // 조기출근(09:00 이전)은 날짜 무관 항상 연장근로 인정
  const isNewSchedule = dateStr >= '2026-05-01'

  const REGULAR_START = 9 * 60 // 09:00 — 항상 적용
  const BUFFER_START = isNewSchedule ? 18 * 60 : 17 * 60 + 30 // 18:00 / 17:30
  const BUFFER_END   = isNewSchedule ? 19 * 60 : 18 * 60 + 30 // 19:00 / 18:30
  const crossesBuffer = !isHoliday && effectiveEndMin > BUFFER_END
  const weekdayPaidStart = crossesBuffer ? BUFFER_START : BUFFER_END

  // 분 단위로 순회하며 분류
  let extendedMinutes = 0
  let nightMinutes = 0
  let holidayMinutes = 0
  let holidayOvertimeMinutes = 0
  let holidayNightMinutes = 0
  let holidayOvertimeNightMinutes = 0
  let holidayDayMinutesSoFar = 0 // 휴일 비야간 누적 (8h 기준 판단용)
  for (let m = startMin; m < effectiveEndMin; m++) {
    const minuteOfDay = m % (24 * 60)
    const hour = Math.floor(minuteOfDay / 60)
    const isNight = hour >= 22 || hour < 6

    if (isHoliday) {
      if (isNight) {
        // 휴일 + 야간
        const totalHolidayMinutes = holidayDayMinutesSoFar + holidayNightMinutes + holidayOvertimeMinutes + holidayOvertimeNightMinutes + 1
        if (totalHolidayMinutes > 480) {
          holidayOvertimeNightMinutes++
        } else {
          holidayNightMinutes++
        }
      } else {
        // 휴일 비야간
        holidayDayMinutesSoFar++
        const totalHolidayMinutes = holidayDayMinutesSoFar + holidayNightMinutes + holidayOvertimeMinutes + holidayOvertimeNightMinutes
        if (totalHolidayMinutes > 480) {
          holidayDayMinutesSoFar--
          holidayOvertimeMinutes++
        }
      }
    } else {
      // 평일
      if (isNight) {
        nightMinutes++ // 야간근로 (22:00~06:00)
      } else if (minuteOfDay < REGULAR_START || minuteOfDay >= weekdayPaidStart) {
        extendedMinutes++ // 정규시간(09:00~) 이전 조기출근 또는 퇴근 후 연장
      }
    }
  }

  // 연장근로 30분 단위 절삭 (예: 100분 → 90분)
  extendedMinutes = Math.floor(extendedMinutes / 30) * 30

  // holidayDayMinutesSoFar → holidayMinutes (8h 이내 비야간 휴일분)
  holidayMinutes = holidayDayMinutesSoFar

  // totalMinutes: 실제 수당 산정 시간 합계 (포괄임금 완충 제외)
  const totalMinutes = extendedMinutes + nightMinutes + holidayMinutes +
    holidayOvertimeMinutes + holidayNightMinutes + holidayOvertimeNightMinutes

  // 수당 항목 생성
  const payItems: PayItem[] = []

  if (extendedMinutes > 0) {
    payItems.push({ label: '연장근로', minutes: extendedMinutes, multiplier: 1.5 })
  }
  if (nightMinutes > 0) {
    payItems.push({ label: '야간근로 (연장+야간)', minutes: nightMinutes, multiplier: 2.0 })
  }
  if (holidayMinutes > 0) {
    payItems.push({ label: '휴일근로', minutes: holidayMinutes, multiplier: 1.5 })
  }
  if (holidayOvertimeMinutes > 0) {
    payItems.push({ label: '휴일근로 (8h 초과)', minutes: holidayOvertimeMinutes, multiplier: 2.0 })
  }
  if (holidayNightMinutes > 0) {
    payItems.push({ label: '휴일+야간', minutes: holidayNightMinutes, multiplier: 2.0 })
  }
  if (holidayOvertimeNightMinutes > 0) {
    payItems.push({ label: '휴일 초과+야간', minutes: holidayOvertimeNightMinutes, multiplier: 2.5 })
  }

  // 주요 유형 판정 (DB type 필드용)
  let primaryType: 'extended' | 'night' | 'holiday' = 'extended'
  if (isHoliday) {
    primaryType = 'holiday'
  } else if (nightMinutes > extendedMinutes) {
    primaryType = 'night'
  }

  return {
    totalMinutes,
    extendedMinutes,
    nightMinutes,
    holidayMinutes,
    holidayOvertimeMinutes,
    holidayNightMinutes,
    holidayOvertimeNightMinutes,
    isHoliday,
    payItems,
    primaryType,
  }
}

function emptyBreakdown(isHoliday: boolean): OvertimeBreakdown {
  return {
    totalMinutes: 0,
    extendedMinutes: 0,
    nightMinutes: 0,
    holidayMinutes: 0,
    holidayOvertimeMinutes: 0,
    holidayNightMinutes: 0,
    holidayOvertimeNightMinutes: 0,
    isHoliday,
    payItems: [],
    primaryType: 'extended',
  }
}

/** 수당 배율 (레거시 호환) */
export function getPayMultiplier(
  type: 'extended' | 'night' | 'holiday',
  isOverlap = false,
): number {
  switch (type) {
    case 'extended':
      return 1.5
    case 'night':
      return isOverlap ? 2.0 : 1.5
    case 'holiday':
      return 1.5
  }
}

/** 주간 연장근무 시간에 따른 경고 레벨 (법정 최대 12시간 기준) */
export function getWarningLevel(totalWeeklyHours: number) {
  if (totalWeeklyHours >= 12) return 'exceeded' as const
  if (totalWeeklyHours >= 10) return 'warning' as const
  if (totalWeeklyHours >= 8) return 'caution' as const
  return 'normal' as const
}

/** 분 → "X시간 Y분" 포맷 */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}분`
  if (m === 0) return `${h}시간`
  return `${h}시간 ${m}분`
}

/** 예상 수당 계산 (시급 기반) */
export function calculateEstimatedPay(
  breakdown: OvertimeBreakdown,
  hourlyWage: number,
): number {
  return breakdown.payItems.reduce((sum, item) => {
    return sum + (item.minutes / 60) * hourlyWage * item.multiplier
  }, 0)
}

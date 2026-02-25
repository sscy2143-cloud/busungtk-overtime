/**
 * 한국 근로기준법 기반 초과근무 시간 계산
 *
 * 정규: 09:00~18:00 (점심 12:00~13:00 제외 = 8시간)
 * 연장: 18:00 이후 또는 일 8시간 초과 (150%)
 * 야간: 22:00~06:00 (150%, 연장 중복 시 200%)
 * 휴일: 8h 이내 150%, 8h 초과 200%
 * 주 최대: 52시간 (정규 40 + 연장 12)
 */

export interface OvertimeBreakdown {
  totalMinutes: number
  extendedMinutes: number
  nightMinutes: number
  holidayMinutes: number
}

export function calculateOvertimeBreakdown(
  start: Date,
  end: Date,
  isHoliday: boolean,
): OvertimeBreakdown {
  const totalMinutes = Math.max(0, (end.getTime() - start.getTime()) / 60000)

  if (isHoliday) {
    const nightMin = calculateNightMinutes(start, end)
    return {
      totalMinutes,
      extendedMinutes: 0,
      nightMinutes: nightMin,
      holidayMinutes: totalMinutes - nightMin,
    }
  }

  const nightMin = calculateNightMinutes(start, end)
  const extendedMin = totalMinutes - nightMin

  return {
    totalMinutes,
    extendedMinutes: extendedMin,
    nightMinutes: nightMin,
    holidayMinutes: 0,
  }
}

/** 22:00~06:00 구간의 분 수 계산 */
function calculateNightMinutes(start: Date, end: Date): number {
  let nightMinutes = 0
  const current = new Date(start)

  while (current < end) {
    const hour = current.getHours()
    if (hour >= 22 || hour < 6) {
      nightMinutes++
    }
    current.setMinutes(current.getMinutes() + 1)
  }

  return nightMinutes
}

/** 수당 배율 계산 */
export function getPayMultiplier(
  type: 'extended' | 'night' | 'holiday',
  isOverlap = false,
): number {
  switch (type) {
    case 'extended':
      return 1.5
    case 'night':
      return isOverlap ? 2.0 : 1.5 // 연장+야간 중복 시 200%
    case 'holiday':
      return 1.5 // 8시간 초과분은 2.0 (별도 처리)
  }
}

/** 주간 누적 시간에 따른 경고 레벨 */
export function getWarningLevel(totalWeeklyHours: number) {
  if (totalWeeklyHours >= 52) return 'exceeded' as const
  if (totalWeeklyHours >= 50) return 'warning' as const
  if (totalWeeklyHours >= 48) return 'caution' as const
  return 'normal' as const
}

/** 시간을 "Xh Ym" 형식으로 포맷 */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}분`
  if (m === 0) return `${h}시간`
  return `${h}시간 ${m}분`
}

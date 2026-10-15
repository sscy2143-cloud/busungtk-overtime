import { isHolidayDate } from '../../utils/overtime-calc'

/** 지급항목명 → 근로기준법 시행령상 산출식 문구 (자동연동 항목 기본값) */
export const DEFAULT_CALC_FORMULAS: Record<string, string> = {
  '연장근로수당': '연장근로시간 수 x 시간당 통상임금 x 50%',
  '야간근로수당': '야간근로시간 수 x 시간당 통상임금 x 50%',
}

export function monthRange(period: string) {
  const [y, m] = period.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, '0')}` }
}

/** 기간 내 소정근로일수 (평일이면서 공휴일이 아닌 날) */
export function countBusinessDays(startStr: string, endStr: string): number {
  const [sy, sm, sd] = startStr.split('-').map(Number)
  const [ey, em, ed] = endStr.split('-').map(Number)
  const cur = new Date(sy, sm - 1, sd)
  const end = new Date(ey, em - 1, ed)
  let count = 0
  while (cur <= end) {
    const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    if (!isHolidayDate(dateStr)) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

export function formatHours(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** 화면 공용 표시 도우미 (컴포넌트 파일과 분리 — fast refresh 규칙) */

import { REGIONS } from '../engine'
import type { TripClaimRecord } from '../data'

export function regionLabel(code: string): string {
  const r = REGIONS[code]
  const base = code.replace('경기:', '경기 ')
  if (!r) return code
  if (r.kind === 'excluded') return `${base} (근거리)`
  if (r.kind === 'jeju') return base
  return `${base} (편도 ${r.oneWayHours}시간)`
}

export function claimDates(c: TripClaimRecord): string {
  const s = c.header.schedule
  return s.kind === 'day' ? s.date : `${s.startDate} ~ ${s.endDate}`
}

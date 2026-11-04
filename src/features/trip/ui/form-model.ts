/**
 * 직원 신청 화면(T3)에서 어떤 입력을 보여 줄지 정하는 규칙.
 *
 * 기본으로 보이는 것은 지역 · 일정 · 현장 시작/종료 · 점심 사용뿐이다.
 * 나머지는 계산에 필요해졌거나(required) 권할 이유가 생겼을 때(suggested)만 펼치고,
 * 선택 항목(optional)은 접힌 "추가 상황" 안에 둔다.
 */

import { REGIONS } from '../engine'
import type { Classification, ClaimHeader, DayEntry } from '../data'
import { MISSING_FIELD_PROMPT } from './labels'

export type SectionKey =
  | 'regions' | 'schedule' | 'site' | 'lunch'
  | 'office' | 'noSiteWork' | 'travelStarts' | 'breaks' | 'directedWaits'
  | 'jeju' | 'assembly' | 'delay' | 'actual'

export interface FormSection {
  key: SectionKey
  mode: 'base' | 'required' | 'suggested' | 'optional'
  reason?: string
}

const BASE: FormSection[] = [
  { key: 'regions', mode: 'base' },
  { key: 'schedule', mode: 'base' },
  { key: 'site', mode: 'base' },
  { key: 'lunch', mode: 'base' },
]

export function formSections(header: ClaimHeader, entry: DayEntry, cls: Classification): FormSection[] {
  const out: FormSection[] = [...BASE]
  const add = (s: FormSection) => {
    const i = out.findIndex((x) => x.key === s.key)
    if (i === -1) out.push(s)
    else if (rank(s.mode) > rank(out[i].mode)) out[i] = s
  }

  for (const m of cls.missing) {
    if (m.startsWith('travelStarts')) add({ key: 'travelStarts', mode: 'required', reason: MISSING_FIELD_PROMPT[m] })
    if (m.startsWith('jeju')) add({ key: 'jeju', mode: 'required', reason: MISSING_FIELD_PROMPT[m] })
    if (m === 'noSiteWork.reason') add({ key: 'noSiteWork', mode: 'required', reason: MISSING_FIELD_PROMPT[m] })
  }

  const regions = entry.regions ?? header.regions
  if (regions.some((r) => Object.hasOwn(REGIONS, r) && REGIONS[r].kind === 'jeju')) {
    add({ key: 'jeju', mode: 'required', reason: '제주는 실제 시각과 증빙으로 계산합니다' })
  }
  if (cls.workType === 'excluded_site') add({ key: 'assembly', mode: 'optional', reason: '회사가 사무실 집결을 지시한 날만' })
  if (entry.office) add({ key: 'office', mode: 'required' })
  if (entry.noSiteWork) add({ key: 'noSiteWork', mode: 'required' })
  if (entry.travelStarts) add({ key: 'travelStarts', mode: 'optional' })

  const input = cls.input
  if (input?.site && !input.breaks?.length) {
    const span = input.site.end - input.site.start
    if (cls.notices.some((n) => n.code === 'NEXT_DAY_SPLIT')) {
      add({ key: 'breaks', mode: 'required', reason: '다음 날까지 이어진 작업은 휴게 시각이 필요합니다' })
    } else if (span > 9) {
      add({ key: 'breaks', mode: 'suggested', reason: '8시간 넘게 작업했는데 점심 외 휴게가 없습니다' })
    }
  }
  // 이동 도착과 작업 시작 사이가 1시간 이상 비면 회사 지시 대기였는지 묻는다.
  // 출발 시각을 비운 경우(E4)는 이동을 작업 바로 앞에 놓으므로 빈 시간이 생기지 않는다
  const outLeg = input?.legs?.find((l) => l.direction === 'out')
  if (input?.site && outLeg?.start !== undefined) {
    const first = regions[0]
    const r = Object.hasOwn(REGIONS, first) ? REGIONS[first] : undefined
    const t = r?.kind === 'standard' ? r.oneWayHours : 0
    if (input.site.start - (outLeg.start + t) >= 1) {
      add({ key: 'directedWaits', mode: 'suggested', reason: '도착 후 작업 시작까지 1시간 이상 비었습니다. 회사 지시 대기였나요?' })
    }
  }

  for (const key of ['office', 'noSiteWork', 'breaks', 'directedWaits', 'delay', 'actual'] as const) {
    add({ key, mode: 'optional' })
  }
  return out
}

const rank = (m: FormSection['mode']) => ({ optional: 0, suggested: 1, base: 2, required: 3 })[m]

/** 화면에서 펼쳐 보여 줄 항목 (선택 항목은 접어 둠) */
export const visibleSections = (sections: FormSection[]): FormSection[] => sections.filter((s) => s.mode !== 'optional')

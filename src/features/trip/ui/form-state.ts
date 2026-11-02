/**
 * 직원 신청 화면(T3) 상태. React 없이 테스트할 수 있도록 reducer 로 둔다.
 *
 * 입력 원본(entries)만 들고 있고, 계산은 항상 같은 함수(computeDay)로 다시 한다.
 * 저장 전 미리보기와 저장 후 계산 결과가 같은 코드를 쓴다.
 */

import type { TripDayError, TripDayResult } from '../engine'
import {
  MAX_STAY_DAYS, computeDay, eachDate, type ClaimHeader, type ClaimStatus, type Classification, type DayEntry,
  type HolidayCalendar, type IsoDate, type Schedule, type TripClaimRecord,
} from '../data'

export interface SavedRef {
  id: string
  version: number
  status: ClaimStatus
  origin: TripClaimRecord['origin']
}

export interface TripFormState {
  header: ClaimHeader
  entries: DayEntry[]
  /** 저장된 뒤에만 있음 */
  saved?: SavedRef
  error?: { code: string; message: string }
  /** 저장 후 다시 고쳤는지 (버전 충돌 안내용) */
  dirty: boolean
}

export type FormAction =
  | { type: 'setRegions'; regions: string[] }
  | { type: 'setSchedule'; schedule: Schedule }
  | { type: 'patchEntry'; date: IsoDate; patch: Partial<DayEntry> }
  | { type: 'loaded'; claim: TripClaimRecord; entries: DayEntry[] }
  | { type: 'saved'; claim: TripClaimRecord }
  | { type: 'failed'; code: string; message: string }
  | { type: 'clearError' }

/** 화면용 날짜 목록. 서비스와 같은 상한(MAX_STAY_DAYS)으로 잘라 입력 카드가 무한히 늘지 않게 한다 */
export function scheduleDates(s: Schedule): IsoDate[] {
  if (s.kind === 'day') return [s.date]
  return s.endDate > s.startDate ? eachDate(s.startDate, s.endDate).slice(0, MAX_STAY_DAYS) : [s.startDate]
}

/** 일정 자체의 문제 — 서비스 validateHeader 와 같은 기준 */
export function scheduleProblem(s: Schedule): string | null {
  if (s.kind === 'day') return null
  if (s.endDate <= s.startDate) return '숙박 출장은 복귀일이 출발일보다 뒤여야 합니다'
  if (eachDate(s.startDate, s.endDate).length > MAX_STAY_DAYS) return `숙박 출장은 ${MAX_STAY_DAYS}일을 넘을 수 없습니다`
  return null
}

export function initialFormState(date: IsoDate, regions: string[] = []): TripFormState {
  return { header: { regions, schedule: { kind: 'day', date } }, entries: [{ date }], dirty: false }
}

/** 일정이 바뀌면 날짜 목록을 다시 만들되, 남아 있는 날짜의 입력은 지키고 없어진 날짜는 버린다 */
function alignEntries(entries: DayEntry[], schedule: Schedule): DayEntry[] {
  return scheduleDates(schedule).map((date) => entries.find((e) => e.date === date) ?? { date })
}

/** undefined 로 준 키는 지운다 (예외 입력을 "해당 없음"으로 되돌릴 때) */
function applyPatch(entry: DayEntry, patch: Partial<DayEntry>): DayEntry {
  const next: Partial<DayEntry> = { ...entry }
  for (const key of Object.keys(patch) as (keyof DayEntry)[]) {
    if (patch[key] === undefined) delete next[key]
  }
  return { ...next, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), date: entry.date }
}

const savedRef = (claim: TripClaimRecord): SavedRef => ({ id: claim.id, version: claim.version, status: claim.status, origin: claim.origin })

export function formReducer(state: TripFormState, action: FormAction): TripFormState {
  switch (action.type) {
    case 'setRegions':
      return { ...state, header: { ...state.header, regions: action.regions }, dirty: true, error: undefined }
    case 'setSchedule':
      return {
        ...state,
        header: { ...state.header, schedule: action.schedule },
        entries: alignEntries(state.entries, action.schedule),
        dirty: true,
        error: undefined,
      }
    case 'patchEntry':
      return {
        ...state,
        entries: state.entries.map((e) => (e.date === action.date ? applyPatch(e, action.patch) : e)),
        dirty: true,
        error: undefined,
      }
    case 'loaded':
      return {
        header: action.claim.header,
        entries: alignEntries(action.entries, action.claim.header.schedule),
        saved: savedRef(action.claim),
        dirty: false,
      }
    case 'saved':
      return { ...state, saved: savedRef(action.claim), dirty: false, error: undefined }
    case 'failed':
      return { ...state, error: { code: action.code, message: action.message } }
    case 'clearError':
      return { ...state, error: undefined }
  }
}

export interface DayDraftComputation {
  date: IsoDate
  entry: DayEntry
  classification: Omit<Classification, 'input'>
  result: TripDayResult | TripDayError | null
}

/** 저장하지 않고 하는 미리보기. 저장 시 서비스가 같은 computeDay 를 쓴다 (주간 결근·연차 조회만 서비스에서 추가됨) */
export function previewDays(state: TripFormState, calendar: HolidayCalendar): DayDraftComputation[] {
  if (state.header.regions.length === 0) {
    return state.entries.map((entry) => ({
      date: entry.date, entry, result: null,
      classification: {
        workType: null, dayKind: 'weekday', position: 'single', missing: [],
        notices: [{ code: 'REGION_REQUIRED', message: '지역을 고르세요' }],
      },
    }))
  }
  return state.entries.map((entry) => {
    const c = computeDay(state.header, entry, { calendar })
    return { date: entry.date, entry, classification: c.classification, result: c.result }
  })
}

/** 제출 가능 여부와 막는 이유 — 서비스 submit 과 같은 기준 */
export function submitBlockers(state: TripFormState, computed: DayDraftComputation[]): string[] {
  const out: string[] = []
  if (!state.saved) out.push('먼저 저장하세요')
  else if (state.saved.status !== 'draft' && state.saved.status !== 'returned') out.push('작성 중이거나 되돌아온 신청만 제출할 수 있습니다')
  if (state.dirty && state.saved) out.push('고친 내용을 저장한 뒤 제출하세요')
  if (state.header.regions.length === 0) out.push('지역을 고르세요')
  const sp = scheduleProblem(state.header.schedule)
  if (sp) out.push(sp)
  const incomplete = computed.filter((d) => d.classification.missing.length > 0 || !d.result || !d.result.ok).map((d) => d.date)
  if (incomplete.length > 0) out.push(`입력이 더 필요한 날: ${incomplete.join(', ')}`)
  return out
}

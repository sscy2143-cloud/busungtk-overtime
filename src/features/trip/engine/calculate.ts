/**
 * 출장수당 인정시간 계산 (근무일 1건)
 *
 * 순수 함수다: DB·화면·현재 시각·난수에 의존하지 않는다. 같은 입력이면 항상 같은 결과.
 * 계산은 최종본 규정대로 하고, 최종본에 없는 상황은 미확정 규칙(E3~E7, N1, N2)의 제안값으로 계산한 뒤
 * status 를 'proposed' 로 두고 관리자 확인 플래그를 붙인다.
 *
 * 경로
 *   ① 제외 지역 현장              → excludedPath (5-1)
 *   ②③④⑦ 당일·숙박 가는/오는 날·중간일 → formulaPath (4절, 5-2, ⑦은 E5)
 *   ⑤⑥ 사무실 근무 후 출발·이동일  → windowPath (5-3, E3·E4)
 *   제주(⑦ 제외)                  → jejuPath (5-7, E6)
 */

import { REGIONS, oneWayMinutes, type RegionClass } from './regions.js'
import { RULES, RULE_VERSION } from './rules.js'
import {
  LUNCH, NEXT_DAY_9, NIGHT, REGULAR, hasOverlap, len, overlapMinutes, subtract, sumLen,
  toHours, toInterval, toMin, toRange, type Interval,
} from './time.js'
import type {
  FlagKind, HourRange, ReviewFlag, RuleId, TravelLegInput, TripDayError, TripDayInput, TripDayResult, ValueStatus,
  WorkType,
} from './types.js'

const EIGHT_HOURS = 8 * 60
const FORMULA_TYPES: ReadonlySet<WorkType> = new Set(['day_trip', 'stay_outbound', 'stay_return', 'stay_middle'])
const SITE_REQUIRED: ReadonlySet<WorkType> = new Set([...FORMULA_TYPES, 'excluded_site'])

interface Ctx {
  flags: ReviewFlag[]
  proposed: Set<RuleId>
  legal: Set<RuleId>
}

/** 경로별 분 단위 결과 */
interface Core {
  tripMin: number
  nightTravelMin: number
  otMin: number
  nightOtMin: number
  totalMin: number
  nightWorkMin: number
  travel: Interval[]
  work: Interval[]
  basis: 'standard_travel' | 'actual'
  /** E1: 출장 + 연장이 맞아야 하는 값. 휴일은 검증 제외 */
  invariantTarget?: number
  adjustmentMin?: number
  excessMin?: number
  nextDay?: Interval
  nextDayTravel?: Interval[]
}

const fmt = (m: number): string => `${toHours(m)}`

function flag(ctx: Ctx, kind: FlagKind, rule: RuleId, code: string, message: string): void {
  ctx.flags.push({ code, kind, rule, message })
  if (kind === 'undecided_rule') ctx.proposed.add(rule)
}

function inputError(code: string, rule: RuleId, message: string): TripDayError {
  return { ok: false, errors: [{ code, kind: 'input', rule, message }] }
}

function isError(r: Core | TripDayError): r is TripDayError {
  return 'ok' in r
}

/**
 * 연장시간 중 야간(22~06)이 몇 시간인지.
 * domain(연장이 될 수 있는 작업 구간)이 전부 연장이면 그 안의 야간이 곧 답이다.
 * 일부만 연장이면 어느 시간이 연장인지 최종본에 없으므로 가능한 범위를 구하고,
 * 범위가 한 값이 아니면 직원에게 유리한 최댓값을 제안값으로 낸다 (N1).
 */
function allocateNightOvertime(ctx: Ctx, otMin: number, domain: Interval[]): number {
  if (otMin <= 0) return 0
  const w = sumLen(domain)
  const n = overlapMinutes(domain, NIGHT)
  if (otMin >= w) return n
  const lower = Math.max(0, otMin - (w - n))
  const upper = Math.min(otMin, n)
  if (lower !== upper) {
    flag(ctx, 'undecided_rule', 'N1', 'N1_NIGHT_OVERTIME_ALLOCATION',
      `연장 ${fmt(otMin)}시간 중 야간 시간이 규정으로 정해지지 않음 (가능 범위 ${fmt(lower)}~${fmt(upper)}). 제안값 ${fmt(upper)}`)
  }
  return upper
}

/** 5-4: 다음 날 09시 전까지는 전날 근무. 09시를 넘기면 E7 제안으로 09시에서 나눈다 */
function splitAtNextDay9(ctx: Ctx, iv: Interval, hasBreaks: boolean): { iv: Interval; nextDay?: Interval } {
  if (iv.end <= NEXT_DAY_9) return { iv }
  flag(ctx, 'undecided_rule', 'E7', 'E7_SPLIT_AT_NEXT_DAY_9',
    '다음 날 09시를 넘긴 작업: 09시에서 나눠 앞부분만 이 근무일로 계산 (제안). 주 한도 초과 시 특별연장 여부 확인')
  ctx.legal.add('E7')
  if (!hasBreaks) flag(ctx, 'input', 'E7', 'E7_BREAK_NOT_RECORDED', '밤샘 작업인데 휴게 기록이 없음')
  return { iv: { start: iv.start, end: NEXT_DAY_9 }, nextDay: { start: NEXT_DAY_9, end: iv.end } }
}

function lunchInside(span: Interval, lunchTaken: boolean): Interval[] {
  return lunchTaken && span.start <= LUNCH.start && span.end >= LUNCH.end ? [LUNCH] : []
}

function deductBreaks(ctx: Ctx, breaks: Interval[], work: Interval[]): number {
  const breakMin = overlapMinutes(breaks, work)
  if (breakMin > 0) flag(ctx, 'rule_review', '3', 'BREAK_DEDUCTED', `점심 외 휴게 ${fmt(breakMin)}시간을 근무에서 뺌`)
  return breakMin
}

// ── ① 제외 지역 현장 (5-1) ──────────────────────────────

function excludedPath(input: TripDayInput, ctx: Ctx): Core {
  const site = toInterval(input.site!)
  const breaks = (input.breaks ?? []).map(toInterval)
  const start = input.assemblyAt !== undefined ? toMin(input.assemblyAt) : site.start
  const { iv: span, nextDay } = splitAtNextDay9(ctx, { start, end: site.end }, breaks.length > 0)
  const lunchCut = lunchInside(span, input.lunchTaken)
  // 점심(12~13)과 겹치는 휴게는 이미 점심으로 뺐으므로 다시 빼지 않는다
  const breakMin = deductBreaks(ctx, breaks, subtract([span], lunchCut))
  const totalMin = Math.max(0, len(span) - (input.lunchTaken ? 60 : 0) - breakMin)
  const work = subtract([span], [...lunchCut, ...breaks])
  const nightWorkMin = overlapMinutes(work, NIGHT)
  const base = { tripMin: 0, nightTravelMin: 0, totalMin, nightWorkMin, travel: [], work, basis: 'standard_travel' as const, nextDay }

  if (input.dayKind === 'holiday') return { ...base, otMin: 0, nightOtMin: 0 }
  if (input.dayKind === 'saturday') {
    // 점심을 썼지만 작업 구간에 12~13시가 없으면 연장이 작업 구간보다 1시간 짧다 → 야간도 배분으로 구함
    return { ...base, otMin: totalMin, nightOtMin: allocateNightOvertime(ctx, totalMin, work), invariantTarget: totalMin }
  }
  const otMin = Math.max(0, totalMin - EIGHT_HOURS)
  return { ...base, otMin, nightOtMin: allocateNightOvertime(ctx, otMin, work), invariantTarget: otMin }
}

// ── ②③④⑦ 현장조정 식 (4절, 5-2, E5) ──────────────────────

function formulaPath(input: TripDayInput, ctx: Ctx, tOut: number, tBack: number): Core {
  const wt = input.workType
  const breaks = (input.breaks ?? []).map(toInterval)
  const raw = toInterval(input.site!)
  const { iv: site, nextDay } = splitAtNextDay9(ctx, raw, breaks.length > 0)
  if (wt === 'stay_middle') {
    flag(ctx, 'undecided_rule', 'E5', 'E5_STAY_MIDDLE', '숙박 중간일(이동 없음): 유형 ⑦, T = 0으로 4절 식 적용 (제안)')
  }

  const outMin = wt === 'day_trip' || wt === 'stay_outbound' ? tOut : 0
  const hasBack = wt === 'day_trip' || wt === 'stay_return'
  const backFull = hasBack && !nextDay ? tBack : 0
  // 5-4: 다음 날 09시 이후의 복귀 이동은 다음 날 정규근무
  const backMin = Math.min(backFull, Math.max(0, NEXT_DAY_9 - site.end))
  // 이 근무일에 넣지 않은 복귀 이동은 다음 근무일 기록으로 넘긴다 (누락 방지)
  const nextDayTravel: Interval[] = !hasBack ? []
    : nextDay ? [{ start: raw.end, end: raw.end + tBack }]
      : backMin < backFull ? [{ start: NEXT_DAY_9, end: site.end + backFull }] : []

  const lunchCut = lunchInside(site, input.lunchTaken)
  const breakMin = deductBreaks(ctx, breaks, subtract([site], lunchCut))
  const siteRaw = len(site) - (input.lunchTaken ? 60 : 0) - breakMin
  // 현장조정 = (9 − 시작) + (종료 − 18), 점심을 못 쓰면 +1
  const adj = (REGULAR.start - site.start) + (site.end - REGULAR.end) + (input.lunchTaken ? 0 : 60) - breakMin
  const travelMin = outMin + backMin
  const travel = [
    { start: site.start - outMin, end: site.start },
    { start: site.end, end: site.end + backMin },
  ].filter((iv) => len(iv) > 0)
  const work = subtract([site], [...lunchCut, ...breaks])
  const nightWorkMin = overlapMinutes(work, NIGHT)
  const totalMin = travelMin + Math.max(0, siteRaw)
  const base = {
    nightTravelMin: overlapMinutes(travel, NIGHT), // E8: 출장시간이 0이어도 기록
    totalMin, nightWorkMin, travel, work, basis: 'standard_travel' as const, nextDay, nextDayTravel, adjustmentMin: adj,
  }

  if (input.dayKind === 'holiday') return { ...base, tripMin: 0, otMin: 0, nightOtMin: 0 }
  if (input.dayKind === 'saturday') {
    // 5-6: 이동은 전부 출장, 작업은 전부 연장 (8시간 차감 없음)
    const otMin = Math.max(0, siteRaw)
    // 점심을 썼지만 작업 구간에 12~13시가 없으면 연장이 작업 구간보다 1시간 짧다 → 야간도 배분으로 구함
    return { ...base, tripMin: travelMin, otMin, nightOtMin: allocateNightOvertime(ctx, otMin, work), invariantTarget: totalMin }
  }
  const otMin = Math.max(0, adj)
  const tripMin = Math.max(0, travelMin + Math.min(adj, 0))
  const nightOtMin = allocateNightOvertime(ctx, otMin, subtract(work, [REGULAR]))
  // E1: 출장 + 연장 = max(0, 일한 시간 − 8)
  return { ...base, tripMin, otMin, nightOtMin, invariantTarget: Math.max(0, travelMin + adj) }
}

// ── ⑤⑥ 시각 기준 (5-3, E3·E4) ─────────────────────────────

function windowPath(input: TripDayInput, ctx: Ctx, tOut: number, tBack: number): Core | TripDayError {
  const breaks = (input.breaks ?? []).map(toInterval)
  const office = input.office ? toInterval(input.office) : undefined
  const waits = (input.directedWaits ?? []).map(toInterval)
  let site: Interval | undefined
  let nextDay: Interval | undefined
  if (input.site) ({ iv: site, nextDay } = splitAtNextDay9(ctx, toInterval(input.site), breaks.length > 0))

  const legInputs: TravelLegInput[] = input.legs ?? (input.workType === 'office_then_depart' ? [{ direction: 'out' }] : [])
  if (legInputs.length === 0) return inputError('TRAVEL_REQUIRED', '5-3', '이동 구간이 필요합니다')

  const legs: Interval[] = []
  const nextDayTravel: Interval[] = []
  for (const leg of legInputs) {
    const t = leg.direction === 'out' ? tOut : tBack
    let iv: Interval
    if (leg.start !== undefined) {
      // 5-3 "시각으로 계산": 이동 시각은 일정대로, 길이는 항상 표준 편도시간
      iv = { start: toMin(leg.start), end: toMin(leg.start) + t }
    } else {
      if (!site) return inputError('TRAVEL_START_REQUIRED', 'E4', '현장 작업이 없으면 이동 시작 시각이 필요합니다')
      if (leg.direction === 'back') {
        if (nextDay) {
          // 복귀 이동은 다음 근무일 몫 (E7)
          const end = toMin(input.site!.end)
          nextDayTravel.push({ start: end, end: end + t })
          continue
        }
        iv = { start: site.end, end: site.end + t }
      } else {
        // E4 제안: 작업 시작 − T. 바로 앞에 회사 지시 대기가 있으면 대기 앞에 놓음
        let anchor = site.start
        let wait = waits.find((w) => w.end === anchor)
        while (wait) {
          anchor = wait.start
          wait = waits.find((w) => w.end === anchor)
        }
        iv = { start: anchor - t, end: anchor }
        // E4 안은 "사무실 종료 직후로 옮김"이지만, 그러면 언제나 작업 시작과 겹친다 → 시각 입력을 받는다
        if (office && iv.start < office.end && iv.end > office.start) {
          return inputError('E4_TRAVEL_CONFLICT', 'E4',
            '사무실 종료 후 표준 이동시간으로는 작업 시작에 맞출 수 없습니다. 이동 시작 시각을 입력하세요')
        }
      }
      flag(ctx, 'undecided_rule', 'E4', 'E4_TRAVEL_PLACED',
        `이동 시각 미입력: 표준 이동을 ${fmt(iv.start)}~${fmt(iv.end)}시에 놓음 (제안)`)
    }
    // 5-4: 다음 날 09시 이후 이동은 다음 날 정규근무 → 다음 근무일 기록으로 넘김
    if (iv.start >= NEXT_DAY_9) {
      nextDayTravel.push(iv)
      continue
    }
    if (iv.end > NEXT_DAY_9) nextDayTravel.push({ start: NEXT_DAY_9, end: iv.end })
    legs.push({ start: iv.start, end: Math.min(iv.end, NEXT_DAY_9) })
  }

  const workRaw = [office, site, ...waits].filter((iv): iv is Interval => iv !== undefined)
  if (hasOverlap([...workRaw, ...legs])) {
    return inputError('OVERLAP', '5-8', '사무실·이동·현장·대기 시각이 겹칩니다 (같은 시간 중복 인정 불가)')
  }

  const lunchInTravel = input.lunchTaken
    && overlapMinutes(workRaw, [LUNCH]) < len(LUNCH)
    && overlapMinutes(legs, [LUNCH]) > 0
  const lunchCut = input.lunchTaken ? [LUNCH] : []
  deductBreaks(ctx, breaks, subtract(workRaw, lunchCut))
  const work = subtract(workRaw, [...lunchCut, ...breaks])
  const travelMin = sumLen(legs)
  const totalMin = travelMin + sumLen(work)
  if (lunchInTravel && totalMin > EIGHT_HOURS) {
    flag(ctx, 'undecided_rule', 'N2', 'N2_LUNCH_DURING_TRAVEL',
      '점심 시간이 표준 이동 구간과 겹쳐 근무에서 빼지 않음 (제안)')
  }
  const nightWorkMin = overlapMinutes(work, NIGHT)
  const base = {
    nightTravelMin: overlapMinutes(legs, NIGHT), totalMin, nightWorkMin, travel: legs, work,
    basis: 'standard_travel' as const, nextDay, nextDayTravel,
  }

  if (input.dayKind === 'holiday') return { ...base, tripMin: 0, otMin: 0, nightOtMin: 0 }
  if (input.dayKind === 'saturday') {
    return { ...base, tripMin: travelMin, otMin: sumLen(work), nightOtMin: nightWorkMin, invariantTarget: totalMin }
  }

  const excess = Math.max(0, totalMin - EIGHT_HOURS)
  let tripMin = sumLen(subtract(legs, [REGULAR])) // 09~18시 밖 이동
  const otDomain = subtract(work, [REGULAR]) // 09~18시 밖 근무
  let otMin = sumLen(otDomain)
  const sum = tripMin + otMin
  if (sum > excess) {
    // 5-3: 차이만큼 출장에서 먼저 뺌
    const diff = sum - excess
    const cut = Math.min(diff, tripMin)
    tripMin -= cut
    const rest = diff - cut
    if (rest > 0) {
      otMin -= rest
      flag(ctx, 'undecided_rule', 'E3', 'E3_SURPLUS_FROM_OVERTIME',
        `출장시간을 다 빼고도 ${fmt(rest)}시간이 남아 연장에서 뺌 (제안)`)
    }
  } else if (sum < excess) {
    otMin += excess - sum
    flag(ctx, 'undecided_rule', 'E3', 'E3_SHORTFALL_TO_OVERTIME',
      `09~18시 밖 시간이 초과보다 ${fmt(excess - sum)}시간 모자라 연장에 더함 (제안)`)
  }
  return {
    ...base, tripMin, otMin, nightOtMin: allocateNightOvertime(ctx, otMin, otDomain),
    invariantTarget: excess, excessMin: excess,
  }
}

// ── 제주 (5-7, E6) ─────────────────────────────────────────

function jejuPath(input: TripDayInput, ctx: Ctx): Core | TripDayError {
  flag(ctx, 'undecided_rule', 'E6', 'E6_JEJU',
    '제주: 실제 시각으로 계산, 인정 = max(8, 실근무). 출발 기준·공항 대기·연장 구분 전제 미확정 (제안)')
  if (!input.jejuEvidenceAttached) flag(ctx, 'input', 'E6', 'E6_NO_EVIDENCE', '제주 이동 증빙이 없음')
  const legs = (input.jejuActualLegs ?? []).map(toInterval)
  if (legs.length === 0) flag(ctx, 'input', 'E6', 'E6_ACTUAL_TIMES_REQUIRED', '제주 실제 이동 시각이 없음')

  const breaks = (input.breaks ?? []).map(toInterval)
  const office = input.office ? toInterval(input.office) : undefined
  let site: Interval | undefined
  let nextDay: Interval | undefined
  if (input.site) ({ iv: site, nextDay } = splitAtNextDay9(ctx, toInterval(input.site), breaks.length > 0))
  const workRaw = [office, site, ...(input.directedWaits ?? []).map(toInterval)]
    .filter((iv): iv is Interval => iv !== undefined)
  if (hasOverlap([...workRaw, ...legs])) {
    return inputError('OVERLAP', '5-8', '사무실·이동·현장·대기 시각이 겹칩니다 (같은 시간 중복 인정 불가)')
  }
  const lunchCut = input.lunchTaken ? [LUNCH] : []
  deductBreaks(ctx, breaks, subtract(workRaw, lunchCut))
  const work = subtract(workRaw, [...lunchCut, ...breaks])
  const travelMin = sumLen(legs)
  const workMin = sumLen(work)
  const totalMin = travelMin + workMin
  const nightWorkMin = overlapMinutes(work, NIGHT)
  const base = {
    nightTravelMin: overlapMinutes(legs, NIGHT), totalMin, nightWorkMin, travel: legs, work,
    basis: 'actual' as const, nextDay,
  }

  if (input.dayKind === 'holiday') return { ...base, tripMin: 0, otMin: 0, nightOtMin: 0 }
  if (input.dayKind === 'saturday') {
    return { ...base, tripMin: travelMin, otMin: workMin, nightOtMin: nightWorkMin, invariantTarget: totalMin }
  }
  // 5-7: 이동일은 8시간 인정, 실제 근무가 8시간을 넘은 시간은 연장
  const otMin = Math.max(0, totalMin - EIGHT_HOURS)
  return {
    ...base, tripMin: 0, otMin, nightOtMin: allocateNightOvertime(ctx, otMin, [...legs, ...work]),
    invariantTarget: otMin,
  }
}

// ── 입력 검증 ───────────────────────────────────────────────

function validate(input: TripDayInput): { errors: ReviewFlag[]; regions: RegionClass[] } {
  const errors: ReviewFlag[] = []
  const err = (code: string, rule: RuleId, message: string) => errors.push({ code, kind: 'input', rule, message })

  const ranges: [string, HourRange | undefined][] = [
    ['현장 작업', input.site],
    ['사무실 근무', input.office],
    ...(input.breaks ?? []).map((r): [string, HourRange] => ['휴게', r]),
    ...(input.directedWaits ?? []).map((r): [string, HourRange] => ['회사 지시 대기', r]),
    ...(input.jejuActualLegs ?? []).map((r): [string, HourRange] => ['제주 실제 이동', r]),
  ]
  for (const [name, r] of ranges) {
    if (r && !(r.end > r.start)) err('INVALID_RANGE', '3', `${name}: 종료가 시작보다 늦어야 합니다`)
  }
  if (input.site && toMin(input.site.start) >= NEXT_DAY_9) {
    err('INVALID_RANGE', '5-4', '현장 작업이 다음 날 09시 이후에 시작하면 다음 근무일로 입력해야 합니다')
  }
  if (hasOverlap((input.breaks ?? []).map(toInterval))) err('OVERLAP', '3', '휴게 시각이 서로 겹칩니다')
  if (input.delay && !(input.delay.hours >= 0)) err('INVALID_RANGE', '5-8', '경유·지연 시간이 올바르지 않습니다')
  if (input.assemblyAt !== undefined && input.site && input.assemblyAt > input.site.start) {
    err('INVALID_RANGE', '5-1', '사무실 집결 시각이 현장 시작보다 늦습니다')
  }
  if (SITE_REQUIRED.has(input.workType) && !input.site) err('SITE_REQUIRED', '3', '현장 작업 시작·종료 시각이 필요합니다')
  // 그 유형의 계산식이 쓰지 않는 입력은 조용히 버리지 않고 오류로 알린다 (근무시간 누락 방지)
  if (SITE_REQUIRED.has(input.workType) && input.legs?.length) {
    err('FIELD_NOT_APPLICABLE', '5-3', '이동 시각 입력은 사무실 근무 후 출발·작업 없는 이동일에만 씁니다')
  }
  if (input.assemblyAt !== undefined && input.workType !== 'excluded_site') {
    err('FIELD_NOT_APPLICABLE', '5-1', '사무실 집결 시각은 제외 지역 현장에만 씁니다')
  }

  const regions: RegionClass[] = []
  if (input.regions.length === 0) err('REGION_REQUIRED', '2', '현장 지역이 필요합니다')
  for (const id of input.regions) {
    const r = Object.hasOwn(REGIONS, id) ? REGIONS[id] : undefined
    if (r) regions.push(r)
    else err('REGION_UNKNOWN', '2', `알 수 없는 지역: ${id}`)
  }
  if (regions.length > 0 && regions.length === input.regions.length) {
    const allExcluded = regions.every((r) => r.kind === 'excluded')
    if (input.workType === 'excluded_site' && !allExcluded) {
      err('REGION_TYPE_MISMATCH', '5-1', '제외 지역 현장 유형인데 출장 지역이 포함되어 있습니다')
    }
    if (input.workType !== 'excluded_site' && allExcluded) {
      err('REGION_TYPE_MISMATCH', '2', '제외 지역(서울·인천·경기남부)은 출장이 아닙니다')
    }
    // 제주 경로는 사무실·대기를 함께 계산하므로 제외
    const isJeju = regions.some((r) => r.kind === 'jeju')
    if (SITE_REQUIRED.has(input.workType) && !(isJeju && input.workType !== 'stay_middle')) {
      if (input.office) err('FIELD_NOT_APPLICABLE', '5-3', '사무실 근무가 있는 날은 "사무실 근무 후 출발"(5-3)로 계산해야 합니다')
      if (input.directedWaits?.length) err('FIELD_NOT_APPLICABLE', '5-3', '회사 지시 대기는 5-3 유형에서만 따로 계산합니다')
    }
  }
  return { errors, regions }
}

// ── 진입점 ─────────────────────────────────────────────────

export function calculateTripDay(input: TripDayInput): TripDayResult | TripDayError {
  const { errors, regions } = validate(input)
  if (errors.length > 0) return { ok: false, errors }

  const ctx: Ctx = { flags: [], proposed: new Set(), legal: new Set(['C-0']) }
  const wt = input.workType
  const tOut = oneWayMinutes(regions[0])
  const tBack = oneWayMinutes(regions[regions.length - 1]) // 5-8: 첫 지역 가는 시간 + 마지막 지역 오는 시간
  const isJeju = regions.some((r) => r.kind === 'jeju')

  let core: Core | TripDayError
  if (wt === 'excluded_site') core = excludedPath(input, ctx)
  else if (isJeju && wt !== 'stay_middle') core = jejuPath(input, ctx)
  else if (FORMULA_TYPES.has(wt)) core = formulaPath(input, ctx, tOut, tBack)
  else core = windowPath(input, ctx, tOut, tBack)
  if (isError(core)) return core

  return finalize(input, ctx, core)
}

function finalize(input: TripDayInput, ctx: Ctx, core: Core): TripDayResult | TripDayError {
  if (core.invariantTarget !== undefined && core.tripMin + core.otMin !== core.invariantTarget) {
    return inputError('INVARIANT_BROKEN', 'E1',
      `출장 ${fmt(core.tripMin)} + 연장 ${fmt(core.otMin)} ≠ ${fmt(core.invariantTarget)} (계산 오류)`)
  }

  let { otMin, totalMin } = core
  if (input.delay && input.delay.hours > 0) {
    if (input.delay.evidenceAttached) {
      const d = toMin(input.delay.hours)
      totalMin += d
      if (input.dayKind !== 'holiday') otMin += d
      flag(ctx, 'rule_review', '5-8', 'DELAY_REVIEW', `회사 지시 경유·지연 ${input.delay.hours}시간을 연장으로 인정 (담당자 확인)`)
    } else {
      flag(ctx, 'input', '5-8', 'DELAY_NO_EVIDENCE', '경유·지연 증빙이 없어 인정하지 않음')
    }
  }
  if (input.dayKind === 'saturday' && input.weekHasAbsenceOrLeave) {
    flag(ctx, 'rule_review', '5-6', 'SATURDAY_WEEK_ABSENCE', '토요일 근무: 그 주에 결근·연차가 있음 (담당자 확인)')
  }
  if (input.dayKind === 'holiday') {
    flag(ctx, 'rule_review', '5-6', 'HOLIDAY_REVIEW', '일요일·공휴일: 휴일근로로 처리, 출장 정액 미적용 (담당자 확인)')
  }
  if (core.nightWorkMin > core.nightOtMin) ctx.legal.add('E2') // 연장이 아닌 야간 근로가 있음

  const order = Object.keys(RULES) as RuleId[]
  const proposedBy = order.filter((id) => ctx.proposed.has(id))
  // N1 은 야간 연장 배분만 정하므로 나머지 값은 확정으로 남는다. 다른 미확정 규칙은 모든 값에 영향
  const allProposed = proposedBy.some((id) => id !== 'N1')
  const valueOf = (proposed: boolean): ValueStatus => (proposed ? 'proposed' : 'confirmed')
  return {
    ok: true,
    ruleVersion: RULE_VERSION,
    status: valueOf(proposedBy.length > 0),
    valueStatus: {
      trip: valueOf(allProposed),
      nightTravel: valueOf(allProposed),
      overtime: valueOf(allProposed),
      nightOvertime: valueOf(proposedBy.length > 0),
    },
    proposedBy,
    trip: { hours: toHours(core.tripMin), nightTravelHours: toHours(core.nightTravelMin) },
    overtime: { hours: toHours(otMin), nightHours: toHours(core.nightOtMin) },
    holiday: input.dayKind === 'holiday'
      ? { within8Hours: toHours(Math.min(totalMin, EIGHT_HOURS)), over8Hours: toHours(Math.max(0, totalMin - EIGHT_HOURS)) }
      : null,
    legal: {
      totalWorkHours: toHours(totalMin),
      dailyOver8Hours: toHours(Math.max(0, totalMin - EIGHT_HOURS)),
      basis: core.basis,
    },
    actualNight: { workHours: toHours(core.nightWorkMin) },
    flags: ctx.flags,
    requiresLegalReview: order.filter((id) => ctx.legal.has(id)),
    trace: {
      travel: core.travel.map(toRange),
      work: core.work.map(toRange),
      ...(core.adjustmentMin !== undefined ? { adjustmentHours: toHours(core.adjustmentMin) } : {}),
      ...(core.excessMin !== undefined ? { excessHours: toHours(core.excessMin) } : {}),
    },
    ...(core.nextDay ? { nextDay: toRange(core.nextDay) } : {}),
    ...(core.nextDayTravel?.length ? { nextDayTravel: core.nextDayTravel.map(toRange) } : {}),
  }
}

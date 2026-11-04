/**
 * 무작위 입력 불변식
 *
 * 기대 총근로는 엔진 코드를 쓰지 않고 이 파일에서 따로 계산한다 (독립 기준값).
 * 엔진의 법정 총근로나 검증식 결과를 그대로 기대값으로 쓰면 같은 실수를 숨기므로 그렇게 하지 않는다.
 */

import { describe, expect, it } from 'vitest'
import { calculateTripDay } from '../calculate'
import { UNDECIDED_RULES } from '../rules'
import type { HourRange, TripDayInput, WorkType } from '../types'

// 표준 편도시간 — regions.ts 를 읽지 않고 최종본 2절에서 직접 옮김
const T: Record<string, number> = { '경기:고양': 1, 충북: 1, 대전: 2, 광주광역시: 3, 부산: 4 }
const NEXT9 = 33

const ov = (a: HourRange, b: HourRange) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
const LUNCH = { start: 12, end: 13 }

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Sample {
  input: TripDayInput
  /** 독립 계산한 그날 총근로 (회사 기준: 표준 이동 + 작업 − 점심 − 휴게) */
  total: number
  /** 독립 계산한 회사 출장·연장 (평일·토요일). 휴일은 없음 */
  expect?: { trip: number; ot: number }
}

const REG = { start: 9, end: 18 }
/** 09~18 밖 길이 */
const outside = (r: HourRange) => Math.max(0, r.end - r.start) - ov(r, REG)

function samples(count: number): Sample[] {
  const rand = rng(20261030)
  const pick = <V,>(xs: readonly V[]): V => xs[Math.floor(rand() * xs.length)]
  const half = (lo: number, hi: number) => lo + Math.floor(rand() * ((hi - lo) * 2 + 1)) / 2
  const out: Sample[] = []

  while (out.length < count) {
    const dayKind = pick(['weekday', 'weekday', 'weekday', 'saturday', 'holiday'] as const)
    const lunchTaken = rand() < 0.7
    const kind = pick(['formula', 'formula', 'excluded', 'window', 'jeju'] as const)

    if (kind === 'window') {
      // ⑤ 사무실 근무 후 출발. 이동 시각은 절반은 입력, 절반은 E4 배치
      const region = pick(Object.keys(T))
      const oe = half(10, 18)
      const ss = oe + 4.5
      const se = ss + half(1, 10)
      const office = { start: 9, end: oe }
      const site = { start: ss, end: Math.min(se, NEXT9) }
      const legs = rand() < 0.5 ? [{ direction: 'out' as const, start: oe }] : [{ direction: 'out' as const }]
      const breaks = rand() < 0.4 ? [{ start: ss + 0.5, end: ss + 1 }] : []
      const lunchCut = lunchTaken ? ov(office, LUNCH) + ov(site, LUNCH) : 0
      const breakCut = breaks.reduce((t, b) => t + ov(b, site), 0)
      const total = (oe - 9) + T[region] + (site.end - site.start) - lunchCut - breakCut
      // 5-3: 09~18 밖 이동 = 출장, 밖 근무 = 연장, 합이 초과보다 크면 출장에서 먼저 빼고(E3: 그다음 연장), 모자라면 연장에 더함(E3)
      const leg = 'start' in legs[0] ? { start: oe, end: oe + T[region] } : { start: ss - T[region], end: ss }
      const excess = Math.max(0, total - 8)
      let trip = outside(leg)
      let ot = outside(office) + outside(site) - breaks.reduce((t, b) => t + outside(ov2(b, site)), 0)
      const diff = trip + ot - excess
      if (diff > 0) { const cut = Math.min(diff, trip); trip -= cut; ot -= diff - cut } else ot -= diff
      const expect = dayKind === 'weekday' ? { trip, ot } : dayKind === 'saturday' ? { trip: T[region], ot: total - T[region] } : undefined
      out.push({ input: { workType: 'office_then_depart', dayKind, lunchTaken, regions: [region], office, legs, site: { start: ss, end: se }, breaks }, total, expect })
      continue
    }

    const start = half(4, 20)
    const end = start + half(1.5, 16)
    const span = { start, end: Math.min(end, NEXT9) }
    // 휴게: 일부는 점심과 겹치게 (이중 차감 확인)
    const breaks = rand() < 0.4 ? [pick([{ start: 12.5, end: 13.5 }, { start: start + 0.5, end: start + 1 }])] : []
    const lunchInside = lunchTaken && span.start <= 12 && span.end >= 13
    const breakCut = breaks.reduce((t, b) => t + ov(b, span) - (lunchInside ? ov(ov2(b, span), LUNCH) : 0), 0)

    if (kind === 'excluded') {
      const total = Math.max(0, (span.end - span.start) - (lunchTaken ? 1 : 0) - breakCut)
      const expect = dayKind === 'weekday' ? { trip: 0, ot: Math.max(0, total - 8) } : dayKind === 'saturday' ? { trip: 0, ot: total } : undefined
      out.push({ input: { workType: 'excluded_site', dayKind, lunchTaken, regions: ['경기:수원'], site: { start, end }, breaks }, total, expect })
    } else if (kind === 'jeju') {
      // 제주(E6): 실제 이동 + 작업 − (작업 안의 점심) − 휴게
      const legs = [{ start: start - 6, end: start - 1 }]
      const total = 5 + (span.end - span.start) - (lunchTaken ? ov(span, LUNCH) : 0) - breaks.reduce((t, b) => t + ov(b, span) - (lunchTaken ? ov(ov2(b, span), LUNCH) : 0), 0)
      const expect = dayKind === 'weekday' ? { trip: 0, ot: Math.max(0, total - 8) } : dayKind === 'saturday' ? { trip: 5, ot: total - 5 } : undefined
      out.push({ input: { workType: 'day_trip', dayKind, lunchTaken, regions: ['제주'], site: { start, end }, breaks, jejuActualLegs: legs, jejuEvidenceAttached: true }, total, expect })
    } else {
      const workType = pick<WorkType>(['day_trip', 'stay_outbound', 'stay_return', 'stay_middle'])
      const first = pick(Object.keys(T))
      const last = pick(Object.keys(T))
      const split = end > NEXT9
      const outT = workType === 'day_trip' || workType === 'stay_outbound' ? T[first] : 0
      const backT = (workType === 'day_trip' || workType === 'stay_return') && !split
        ? Math.min(T[last], Math.max(0, NEXT9 - span.end)) : 0
      const siteWork = (span.end - span.start) - (lunchTaken ? 1 : 0) - breakCut
      // 4절: 현장조정 = (9 − 시작) + (종료 − 18) (+1 점심 미사용) − 휴게
      const adj = (9 - span.start) + (span.end - 18) + (lunchTaken ? 0 : 1) - breakCut
      const travel = outT + backT
      const expect = dayKind === 'weekday' ? { trip: Math.max(0, travel + Math.min(adj, 0)), ot: Math.max(0, adj) }
        : dayKind === 'saturday' ? { trip: travel, ot: Math.max(0, siteWork) } : undefined
      out.push({ input: { workType, dayKind, lunchTaken, regions: [first, last], site: { start, end }, breaks }, total: travel + Math.max(0, siteWork), expect })
    }
  }
  return out
}

/** 휴게 b 중 구간 span 안에 든 부분 */
function ov2(b: HourRange, span: HourRange): HourRange {
  return { start: Math.max(b.start, span.start), end: Math.min(b.end, span.end) }
}

describe('무작위 입력 1,000건 불변식 (독립 기준값)', () => {
  const all = samples(1000).map((s) => ({ ...s, r: calculateTripDay(s.input) }))
  const ok = all.flatMap(({ input, total, expect, r }) => (r.ok ? [{ input, total, expect, r }] : []))

  it('모두 계산된다 (검증식 E1 위반·입력 오류 없음)', () => {
    expect(all.filter(({ r }) => !r.ok).map(({ r }) => (r.ok ? '' : r.errors[0].code))).toEqual([])
  })

  it('엔진의 그날 총근로가 독립 계산값과 같다', () => {
    for (const { r, total, input } of ok) {
      expect(r.legal.totalWorkHours, JSON.stringify(input)).toBeCloseTo(total, 9)
    }
  })

  it('회사 출장·연장 시간이 각각 독립 계산값과 같다 (4절·5-1·5-3·5-6·5-7 식을 테스트에서 따로 구현)', () => {
    let checked = 0
    for (const { r, expect: e, input } of ok) {
      if (!e) continue
      const msg = JSON.stringify(input)
      expect(r.trip.hours, msg).toBeCloseTo(e.trip, 9)
      expect(r.overtime.hours, msg).toBeCloseTo(e.ot, 9)
      checked++
    }
    expect(checked).toBeGreaterThan(700)
  })

  it('평일: 출장 + 연장 = max(0, 총근로 − 8) / 토요일: = 총근로 / 휴일: 휴일근로 = 총근로', () => {
    for (const { r, total, input } of ok) {
      const msg = JSON.stringify(input)
      if (input.dayKind === 'weekday') expect(r.trip.hours + r.overtime.hours, msg).toBeCloseTo(Math.max(0, total - 8), 9)
      if (input.dayKind === 'saturday') expect(r.trip.hours + r.overtime.hours, msg).toBeCloseTo(total, 9)
      if (input.dayKind === 'holiday') {
        expect(r.trip.hours + r.overtime.hours).toBe(0)
        expect(r.holiday!.within8Hours + r.holiday!.over8Hours, msg).toBeCloseTo(total, 9)
      }
    }
  })

  it('모든 시간은 0 이상, 야간 연장은 연장과 실제 야간 시간을 넘지 않는다', () => {
    for (const { r, input } of ok) {
      const msg = JSON.stringify(input)
      for (const v of [r.trip.hours, r.trip.nightTravelHours, r.overtime.hours, r.overtime.nightHours, r.actualNight.workHours]) {
        expect(v, msg).toBeGreaterThanOrEqual(0)
      }
      expect(r.overtime.nightHours, msg).toBeLessThanOrEqual(r.overtime.hours)
      // 제주(E6 제안)는 이동도 근무로 보므로 야간 이동까지 상한에 포함 — E6 이 미확정이라 결과도 항상 제안값
      const cap = r.actualNight.workHours + (r.legal.basis === 'actual' ? r.trip.nightTravelHours : 0)
      expect(r.overtime.nightHours, msg).toBeLessThanOrEqual(cap)
      if (r.legal.basis === 'actual') expect(r.status).toBe('proposed')
    }
  })

  it('미확정 규칙이 쓰인 결과는 반드시 제안값이고, 확정 결과에는 미확정 규칙이 없다', () => {
    for (const { r } of ok) {
      const undecided = r.flags.filter((f) => f.kind === 'undecided_rule')
      expect(r.status === 'proposed').toBe(undecided.length > 0)
      expect(r.proposedBy.length > 0).toBe(undecided.length > 0)
      for (const id of r.proposedBy) expect(UNDECIDED_RULES).toContain(id)
    }
  })

  it('미확정 규칙 E3·E4·E5·E6·E7·N1·N2 경로를 모두 지나간다 (검사가 빈 경로를 건너뛰지 않음)', () => {
    const seen = new Set(ok.flatMap(({ r }) => r.proposedBy))
    for (const id of ['E3', 'E4', 'E5', 'E6', 'E7', 'N1', 'N2']) expect(seen).toContain(id)
  })

  it('확정값 결과도 충분히 있다 (모든 결과가 제안값이면 검사가 무의미)', () => {
    expect(ok.filter(({ r }) => r.status === 'confirmed').length).toBeGreaterThan(100)
  })

  it('같은 입력이면 같은 결과 (순수 함수)', () => {
    for (const { input, r } of ok.slice(0, 100)) expect(calculateTripDay(structuredClone(input))).toEqual(r)
  })
})

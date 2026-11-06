/**
 * 시범 운영(T9) 수기 병행 비교 — 순수 함수. 급여·DB·화면과 무관하다.
 * 시스템이 계산한 결과(승인된 신청의 정산 미리보기)를 담당자가 수기로 계산한 값과 날짜별로 대조한다.
 * 비교는 값만 본다. 급여 반영 여부를 판단하거나 바꾸지 않으며, 급여 관련 설정과 연결되지 않는다.
 */

export type PilotKey = 'trip' | 'nightTravel' | 'overtime' | 'nightOvertime' | 'holidayWithin8' | 'holidayOver8'
export const PILOT_KEYS: readonly PilotKey[] = ['trip', 'nightTravel', 'overtime', 'nightOvertime', 'holidayWithin8', 'holidayOver8']

export type Hours = Partial<Record<PilotKey, number>>

/** 시스템 결과 한 줄 — SettlementDay(confirmed·held)에 직원 식별자만 붙인 모양 */
export interface SystemRow {
  /** 호출자가 정하는 직원 식별자(사번 등). 이름·UUID 를 그대로 넣지 않는 것을 권장한다 */
  ref: string
  date: string
  confirmed: Hours
  /** 회사 결정 전 제안값 */
  held: Hours
}

/** 수기 계산 한 줄 */
export interface ManualRow {
  ref: string
  date: string
  hours: Hours
}

export type RowStatus = 'match' | 'diff' | 'system_only' | 'manual_only'

export interface KeyDiff {
  key: PilotKey
  system: number
  manual: number
  /** system − manual */
  diff: number
  /** 시스템 값이 제안값(미확정 규칙)에서 왔는지 */
  fromHeld: boolean
}

export interface RowComparison {
  ref: string
  date: string
  status: RowStatus
  /** 값이 다른 항목만 */
  diffs: KeyDiff[]
  /** 시스템 값이 제안값인 항목 — 일치해도 회사 결정 전이라는 표시 */
  heldKeys: PilotKey[]
  /** 같은 직원·날짜에 줄이 여러 개여서 합산했는지 */
  merged: boolean
}

export interface PilotSummary {
  total: number
  match: number
  diff: number
  systemOnly: number
  manualOnly: number
  /** 일치하지만 제안값이 섞여 있어 회사 결정이 필요한 줄 */
  matchedWithHeld: number
  /** 일치율(%) — total 이 0 이면 null */
  matchRate: number | null
}

export interface PilotReport {
  rows: RowComparison[]
  summary: PilotSummary
}

const round = (n: number) => Math.round(n * 1000) / 1000

function sumInto(target: Hours, add: Hours) {
  for (const k of PILOT_KEYS) {
    const v = add[k]
    if (v !== undefined) target[k] = round((target[k] ?? 0) + v)
  }
}

interface Agg { confirmed: Hours; held: Hours; count: number }

/**
 * 시스템 결과와 수기 결과를 (직원, 날짜) 단위로 대조한다.
 * toleranceHours: 허용 오차(시간). 기본 0 — 수기 계산이 시 단위이므로 정확히 같아야 일치로 본다.
 */
export function comparePilot(system: SystemRow[], manual: ManualRow[], opts: { toleranceHours?: number } = {}): PilotReport {
  const tol = opts.toleranceHours ?? 0
  const keyOf = (ref: string, date: string) => `${ref}\u0000${date}`

  const sys = new Map<string, Agg>()
  for (const r of system) {
    const k = keyOf(r.ref, r.date)
    const a = sys.get(k) ?? { confirmed: {}, held: {}, count: 0 }
    sumInto(a.confirmed, r.confirmed)
    sumInto(a.held, r.held)
    a.count += 1
    sys.set(k, a)
  }
  const man = new Map<string, { hours: Hours; count: number }>()
  for (const r of manual) {
    const k = keyOf(r.ref, r.date)
    const a = man.get(k) ?? { hours: {}, count: 0 }
    sumInto(a.hours, r.hours)
    a.count += 1
    man.set(k, a)
  }

  const rows: RowComparison[] = []
  for (const k of new Set([...sys.keys(), ...man.keys()])) {
    const [ref, date] = k.split('\u0000')
    const s = sys.get(k)
    const m = man.get(k)
    if (s && !m) {
      rows.push({ ref, date, status: 'system_only', diffs: [], heldKeys: heldKeysOf(s), merged: s.count > 1 })
      continue
    }
    if (!s && m) {
      rows.push({ ref, date, status: 'manual_only', diffs: [], heldKeys: [], merged: m.count > 1 })
      continue
    }
    const diffs: KeyDiff[] = []
    for (const key of PILOT_KEYS) {
      const sc = s!.confirmed[key]
      const sh = s!.held[key]
      const sv = round((sc ?? 0) + (sh ?? 0))
      const mv = m!.hours[key] ?? 0
      const d = round(sv - mv)
      if (Math.abs(d) > tol + 1e-9) diffs.push({ key, system: sv, manual: mv, diff: d, fromHeld: sh !== undefined })
    }
    rows.push({
      ref, date, status: diffs.length ? 'diff' : 'match', diffs,
      heldKeys: heldKeysOf(s!), merged: s!.count > 1 || m!.count > 1,
    })
  }
  rows.sort((a, b) => a.ref.localeCompare(b.ref) || a.date.localeCompare(b.date))

  const count = (st: RowStatus) => rows.filter((r) => r.status === st).length
  const match = count('match')
  return {
    rows,
    summary: {
      total: rows.length,
      match,
      diff: count('diff'),
      systemOnly: count('system_only'),
      manualOnly: count('manual_only'),
      matchedWithHeld: rows.filter((r) => r.status === 'match' && r.heldKeys.length > 0).length,
      matchRate: rows.length ? Math.round((match / rows.length) * 1000) / 10 : null,
    },
  }
}

function heldKeysOf(a: Agg): PilotKey[] {
  return PILOT_KEYS.filter((k) => a.held[k] !== undefined)
}

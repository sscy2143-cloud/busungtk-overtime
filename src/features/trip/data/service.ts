/**
 * 출장 신청 업무 흐름 — 작성 · 수정 · 제출 · 취소 · 동행 초안 · 관리자 수정 · 검토 · 정산 미리보기
 *
 * 화면이 아니라 이 계층에서 규칙을 지킨다 (실제 DB 단계에서는 같은 규칙을 RPC 가 강제한다).
 *  - 본인 건만 작성·수정·제출·취소. 관리자는 검토·수정. 본인 건은 본인이 승인할 수 없다.
 *  - 승인은 화면에 보였던 계산 결과에 묶인다. 그 뒤 입력이 바뀌었으면 승인을 거부한다.
 *  - 확인 표시가 남아 있으면 승인할 수 없다. 승인해도 제안값은 제안값으로 남는다 (확정 규정이 되지 않음).
 *  - 동행은 초안만 보낸다. 각자 확인하고 각자 제출한다. 제출하지 않은 초안은 정산에 들어가지 않는다.
 *  - 급여 반영은 이 단계에서 하지 않는다 (C-0 노무 확인 전).
 */

import { RULE_VERSION, checkWeek, type TripDayResult, type WeekCheck } from '../engine'
import { addDays, eachDate, isIsoDate, weekStartOf, type HolidayCalendar, type IsoDate } from './calendar'
import { computeClaimDays } from './compute'
import { RepoError, type TripRepository } from './repository'
import type {
  Actor, ClaimHeader, DayEntry, FlagDecision, Result, TripCalcRecord, TripClaimRecord,
} from './types'

/** 이 단계에서는 어떤 결과도 급여에 반영하지 않는다 (C-0, 노무 확인 전) */
export const PAYROLL_APPLICATION_ENABLED = false

export interface ServiceDeps {
  repo: TripRepository
  /** 공휴일 달력. 검증되지 않은 출처면 모든 날이 관리자 확인 대상 */
  calendar: HolidayCalendar
  now: () => string
  newId: (prefix: string) => string
  /** 그 주(월요일 시작)에 결근·연차가 있는지 — 5-6 토요일 확인용 */
  absenceLookup?: (employeeId: string, weekStart: IsoDate) => boolean
  /** 같은 날 기존 야근 등 다른 신청의 표시 문구 (예: '야근 18:00~21:00'). 있으면 관리자 확인 항목 */
  otherRequestLookup?: (employeeId: string, date: IsoDate) => string[]
}

const fail = <T,>(code: string, message: string): Result<T> => ({ ok: false, code, message })
const ok = <T,>(value: T): Result<T> => ({ ok: true, value })

function guard<T>(fn: () => Result<T>): Result<T> {
  try {
    return fn()
  } catch (e) {
    if (e instanceof RepoError) return fail(e.code, e.message)
    throw e
  }
}

export interface SettlementDay {
  date: IsoDate
  calcId: string
  /** 확정값만 */
  confirmed: Partial<Record<SettlementKey, number>>
  /** 제안값 — 관리자·회사 결정 전까지 보류 */
  held: Partial<Record<SettlementKey, number>>
  requiresLegalReview: string[]
}
type SettlementKey = 'trip' | 'nightTravel' | 'overtime' | 'nightOvertime' | 'holidayWithin8' | 'holidayOver8'

export interface GroupMismatch {
  date: IsoDate
  field: 'site' | 'regions' | 'missing_day'
  employeeIds: string[]
}

/** 숙박 출장 최대 일수 — 회사 규정이 아니라 입력 실수·악의적 입력 방어용 임시 상한 (T5 SQL 초안과 같은 값) */
export const MAX_STAY_DAYS = 31

export function createTripService(deps: ServiceDeps) {
  const { repo } = deps

  // ── 검증 ────────────────────────────────────────────────

  function validateHeader(header: ClaimHeader): Result<null> {
    if (header.regions.length === 0) return fail('REGION_REQUIRED', '지역을 고르세요')
    const s = header.schedule
    if (s.kind === 'day') {
      if (!isIsoDate(s.date)) return fail('INVALID_DATE', '날짜가 올바르지 않습니다')
    } else {
      if (!isIsoDate(s.startDate) || !isIsoDate(s.endDate)) return fail('INVALID_DATE', '날짜가 올바르지 않습니다')
      if (s.endDate <= s.startDate) return fail('INVALID_DATE', '숙박 출장은 끝나는 날이 시작일보다 뒤여야 합니다')
      if (eachDate(s.startDate, s.endDate).length > MAX_STAY_DAYS) return fail('INVALID_DATE', `숙박 출장은 ${MAX_STAY_DAYS}일을 넘을 수 없습니다 (임시 상한)`)
    }
    return ok(null)
  }

  function scheduleDates(header: ClaimHeader): IsoDate[] {
    const s = header.schedule
    return s.kind === 'day' ? [s.date] : eachDate(s.startDate, s.endDate)
  }

  function validateEntries(header: ClaimHeader, entries: DayEntry[]): Result<null> {
    if (entries.length === 0) return fail('NO_DAYS', '근무일을 하나 이상 입력하세요')
    const allowed = new Set(scheduleDates(header))
    const seen = new Set<IsoDate>()
    for (const e of entries) {
      if (!allowed.has(e.date)) return fail('DATE_OUT_OF_SCHEDULE', `${e.date}은 출장 일정 밖의 날짜입니다`)
      if (seen.has(e.date)) return fail('DUPLICATE_DATE', `${e.date}을 두 번 입력했습니다`)
      seen.add(e.date)
    }
    return ok(null)
  }

  function conflictDate(employeeId: string, dates: IsoDate[], excludeClaimId?: string): IsoDate | undefined {
    return dates.find((d) => repo.findActiveDay(employeeId, d, excludeClaimId) !== undefined)
  }

  // ── 계산 ────────────────────────────────────────────────

  /** 근무일 전부 다시 계산. 입력·연결이 그대로인 날은 이전 결과를 그대로 쓴다 (승인 묶음이 불필요하게 깨지지 않게) */
  function recompute(claim: TripClaimRecord): void {
    const drafts = computeClaimDays({
      header: claim.header,
      employeeId: claim.employeeId,
      days: repo.listDays(claim.id),
      calendar: deps.calendar,
      absenceLookup: deps.absenceLookup,
      findActiveDay: (employeeId, date) => repo.findActiveDay(employeeId, date, claim.id),
      otherRequestLookup: deps.otherRequestLookup,
    })

    for (const d of drafts) {
      const prev = repo.latestCalc(d.day.id)
      const key = (c: Partial<TripCalcRecord>) => JSON.stringify([c.engineInput, c.classification, c.carryIn, c.carryOut, c.result])
      if (prev && prev.dayRevision === d.day.revision && key(prev) === key(d)) continue
      const { day, ...rest } = d
      repo.insertCalc({
        ...rest, id: deps.newId('calc'), claimId: claim.id, dayId: day.id, dayRevision: day.revision,
        ruleVersion: RULE_VERSION, computedAt: deps.now(),
      })
    }
  }

  function latestCalcs(claimId: string): TripCalcRecord[] {
    return repo.listDays(claimId).map((d) => repo.latestCalc(d.id)).filter((c): c is TripCalcRecord => c !== undefined)
  }

  function ownedEditable(actor: Actor, claimId: string, expectedVersion: number): Result<TripClaimRecord> {
    const claim = repo.getClaim(claimId)
    if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
    if (claim.employeeId !== actor.id) return fail('FORBIDDEN', '본인 신청만 수정할 수 있습니다')
    if (claim.status !== 'draft' && claim.status !== 'returned') return fail('NOT_EDITABLE', '작성 중이거나 반려되어 돌아온 신청만 수정할 수 있습니다')
    if (claim.version !== expectedVersion) return fail('VERSION_CONFLICT', '다른 곳에서 먼저 수정되었습니다. 새로 불러오세요')
    return ok(claim)
  }

  // ── 직원 ────────────────────────────────────────────────

  function createClaim(actor: Actor, args: { employeeId?: string; header: ClaimHeader; entries: DayEntry[] }): Result<TripClaimRecord> {
    return guard(() => {
      const employeeId = args.employeeId ?? actor.id
      if (employeeId !== actor.id && actor.role !== 'admin') return fail('FORBIDDEN', '다른 직원의 신청은 관리자만 대신 작성할 수 있습니다')
      const h = validateHeader(args.header)
      if (!h.ok) return h
      const e = validateEntries(args.header, args.entries)
      if (!e.ok) return e
      // 하나라도 겹치면 아무것도 만들지 않는다 (일부만 생기는 상태 방지)
      const clash = conflictDate(employeeId, args.entries.map((x) => x.date))
      if (clash) return fail('DUPLICATE_DAY', `${clash}에 이미 신청한 근무일이 있습니다`)

      const now = deps.now()
      const id = deps.newId('claim')
      const claim: TripClaimRecord = {
        id, employeeId, groupId: id, initiatorId: actor.id, origin: 'self', header: args.header,
        status: 'draft', version: 1, createdAt: now, updatedAt: now,
      }
      repo.insertClaim(claim)
      for (const entry of args.entries) {
        repo.insertDay({ id: deps.newId('day'), claimId: id, employeeId, date: entry.date, entry, revision: 1 })
      }
      recompute(claim)
      return ok(repo.getClaim(id)!)
    })
  }

  function updateDraft(actor: Actor, claimId: string, expectedVersion: number, args: { header?: ClaimHeader; entries?: DayEntry[] }): Result<TripClaimRecord> {
    return guard(() => {
      const owned = ownedEditable(actor, claimId, expectedVersion)
      if (!owned.ok) return owned
      const claim = owned.value
      const header = args.header ?? claim.header
      const h = validateHeader(header)
      if (!h.ok) return h
      const existing = repo.listDays(claimId)
      const entries = args.entries ?? existing.map((d) => d.entry)
      const e = validateEntries(header, entries)
      if (!e.ok) return e
      const newDates = entries.map((x) => x.date).filter((d) => !existing.some((x) => x.date === d))
      const clash = conflictDate(claim.employeeId, newDates, claimId)
      if (clash) return fail('DUPLICATE_DAY', `${clash}에 이미 신청한 근무일이 있습니다`)

      const updated = repo.updateClaim(claimId, expectedVersion, { header, updatedAt: deps.now() })
      for (const day of existing) {
        const next = entries.find((x) => x.date === day.date)
        if (!next) repo.deleteDay(day.id)
        else if (JSON.stringify(next) !== JSON.stringify(day.entry)) repo.updateDay(day.id, day.revision, next)
      }
      for (const entry of entries.filter((x) => newDates.includes(x.date))) {
        repo.insertDay({ id: deps.newId('day'), claimId, employeeId: claim.employeeId, date: entry.date, entry, revision: 1 })
      }
      recompute(updated)
      return ok(repo.getClaim(claimId)!)
    })
  }

  function submit(actor: Actor, claimId: string, expectedVersion: number): Result<TripClaimRecord> {
    return guard(() => {
      const owned = ownedEditable(actor, claimId, expectedVersion)
      if (!owned.ok) return owned
      const calcs = latestCalcs(claimId)
      const blocked = calcs.filter((c) => c.classification.missing.length > 0 || !c.result || !c.result.ok)
      if (calcs.length === 0) return fail('NO_DAYS', '근무일을 하나 이상 입력하세요')
      if (blocked.length > 0) {
        return fail('INCOMPLETE', `입력이 더 필요한 날이 있습니다: ${blocked.map((c) => repo.listDays(claimId).find((d) => d.id === c.dayId)?.date).join(', ')}`)
      }
      const now = deps.now()
      return ok(repo.updateClaim(claimId, expectedVersion, { status: 'submitted', submittedAt: now, updatedAt: now }))
    })
  }

  function cancel(actor: Actor, claimId: string, expectedVersion: number): Result<TripClaimRecord> {
    return guard(() => {
      const claim = repo.getClaim(claimId)
      if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
      if (claim.employeeId !== actor.id) return fail('FORBIDDEN', '본인 신청만 취소할 수 있습니다')
      if (!['draft', 'submitted', 'returned'].includes(claim.status)) {
        return fail('NOT_CANCELLABLE', '승인·반려·취소된 신청은 직원이 취소할 수 없습니다 (승인 후 정정은 관리자 조정)')
      }
      return ok(repo.updateClaim(claimId, expectedVersion, { status: 'cancelled', updatedAt: deps.now() }))
    })
  }

  /** 동행자에게 초안을 만든다. 같은 사실(지역·일정·현장 시각·이동)만 복사하고, 점심·휴게·사무실 근무는 각자 입력 */
  function inviteCompanions(actor: Actor, claimId: string, companionIds: string[]): Result<{ created: string[]; skipped: { employeeId: string; reason: string }[] }> {
    return guard(() => {
      const claim = repo.getClaim(claimId)
      if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
      if (claim.employeeId !== actor.id) return fail('FORBIDDEN', '본인 신청에서만 동행자를 추가할 수 있습니다')
      if (!['draft', 'submitted', 'returned'].includes(claim.status)) return fail('NOT_EDITABLE', '진행 중인 신청에서만 동행자를 추가할 수 있습니다')
      const days = repo.listDays(claimId)
      const created: string[] = []
      const skipped: { employeeId: string; reason: string }[] = []
      for (const employeeId of [...new Set(companionIds)]) {
        if (employeeId === claim.employeeId) continue
        const clash = conflictDate(employeeId, days.map((d) => d.date))
        if (clash) {
          skipped.push({ employeeId, reason: `${clash}에 이미 신청한 근무일이 있음` })
          continue
        }
        const now = deps.now()
        const id = deps.newId('claim')
        const draft: TripClaimRecord = {
          id, employeeId, groupId: claim.groupId, initiatorId: actor.id, origin: 'companion_draft',
          header: claim.header, status: 'draft', version: 1, createdAt: now, updatedAt: now,
        }
        repo.insertClaim(draft)
        for (const day of days) {
          repo.insertDay({ id: deps.newId('day'), claimId: id, employeeId, date: day.date, entry: companionCopy(day.entry), revision: 1 })
        }
        recompute(draft)
        created.push(id)
      }
      return ok({ created, skipped })
    })
  }

  // ── 관리자 ──────────────────────────────────────────────

  function adminAdjustDay(actor: Actor, claimId: string, dayId: string, expectedRevision: number, entry: DayEntry, reason: string): Result<TripCalcRecord> {
    return guard(() => {
      if (actor.role !== 'admin') return fail('FORBIDDEN', '관리자만 수정할 수 있습니다')
      if (!reason.trim()) return fail('REASON_REQUIRED', '수정 사유를 입력하세요')
      const claim = repo.getClaim(claimId)
      if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
      if (claim.status !== 'submitted') return fail('NOT_EDITABLE', '제출된 신청만 관리자가 수정할 수 있습니다 (승인 후 정정은 다음 달 조정)')
      const day = repo.listDays(claimId).find((d) => d.id === dayId)
      if (!day) return fail('NOT_FOUND', '근무일을 찾을 수 없습니다')
      if (entry.date !== day.date) return fail('DATE_CHANGE_NOT_ALLOWED', '근무일 날짜는 바꿀 수 없습니다')
      repo.updateDay(dayId, expectedRevision, entry)
      repo.insertAdjustment({ id: deps.newId('adj'), dayId, claimId, adminId: actor.id, before: day.entry, after: entry, reason, at: deps.now() })
      const updated = repo.updateClaim(claimId, claim.version, { updatedAt: deps.now() })
      recompute(updated)
      return ok(repo.latestCalc(dayId)!)
    })
  }

  function review(actor: Actor, claimId: string, args: {
    action: 'approve' | 'reject' | 'return'
    expectedCalcIds: string[]
    flagDecisions?: FlagDecision[]
    reason?: string
  }): Result<TripClaimRecord> {
    return guard(() => {
      if (actor.role !== 'admin') return fail('FORBIDDEN', '관리자만 검토할 수 있습니다')
      const claim = repo.getClaim(claimId)
      if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
      if (claim.employeeId === actor.id) return fail('SELF_REVIEW', '본인 신청은 직접 검토할 수 없습니다')
      if (claim.status !== 'submitted') return fail('NOT_SUBMITTED', '제출된 신청만 검토할 수 있습니다')
      if (args.action !== 'approve' && !args.reason?.trim()) return fail('REASON_REQUIRED', '반려·되돌림 사유를 입력하세요')

      const calcs = latestCalcs(claimId)
      const current = calcs.map((c) => c.id).sort()
      const expected = [...args.expectedCalcIds].sort()
      if (JSON.stringify(current) !== JSON.stringify(expected)) {
        return fail('STALE_CALC', '화면을 연 뒤 계산 결과가 바뀌었습니다. 새로 불러온 뒤 다시 검토하세요')
      }
      const decisions = args.flagDecisions ?? []
      if (args.action === 'approve') {
        if (calcs.some((c) => !c.result || !c.result.ok)) return fail('CALC_ERROR', '계산되지 않은 근무일이 있어 승인할 수 없습니다')
        const unresolved = calcs.flatMap((c) => reviewItems(c)
          .filter((code) => !decisions.some((d) => d.calcId === c.id && d.code === code))
          .map((code) => `${c.id}:${code}`))
        if (unresolved.length > 0) return fail('UNRESOLVED_FLAGS', `확인하지 않은 표시가 있습니다: ${unresolved.join(', ')}`)
      }
      const at = deps.now()
      repo.insertReview({
        id: deps.newId('review'), claimId, adminId: actor.id, action: args.action, calcIds: current,
        flagDecisions: decisions, ...(args.reason ? { reason: args.reason } : {}), at,
      })
      const status = args.action === 'approve' ? 'approved' : args.action === 'reject' ? 'rejected' : 'returned'
      return ok(repo.updateClaim(claimId, claim.version, { status, updatedAt: at }))
    })
  }

  // ── 조회 ────────────────────────────────────────────────

  /** 승인된 신청의 정산 미리보기. 제안값은 held 로 분리하고, 급여 반영 여부는 PAYROLL_APPLICATION_ENABLED 를 따른다 */
  function settlementPreview(claimId: string): Result<{ days: SettlementDay[]; payrollApplicable: boolean; note: string }> {
    const claim = repo.getClaim(claimId)
    if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
    if (claim.status !== 'approved') return fail('NOT_APPROVED', '승인된 신청만 정산 대상입니다')
    const approval = repo.listReviews(claimId).filter((r) => r.action === 'approve').at(-1)!
    const dates = new Map(repo.listDays(claimId).map((d) => [d.id, d.date]))
    const days = approval.calcIds.map((id) => {
      const calc = repo.getCalc(id)!
      return { date: dates.get(calc.dayId)!, calcId: id, ...splitByStatus(calc.result as TripDayResult) }
    }).sort((a, b) => a.date.localeCompare(b.date))
    return ok({
      days,
      payrollApplicable: PAYROLL_APPLICATION_ENABLED,
      note: '노무 확인(C-0) 전이므로 급여에 반영하지 않습니다. 제안값은 회사 결정 전까지 보류합니다',
    })
  }

  /** 동행 묶음 안에서 같은 날 지역·현장 시각이 다른 사람 */
  function groupMismatches(groupId: string): GroupMismatch[] {
    const members = repo.listClaims({ groupId }).filter((c) => c.status !== 'cancelled' && c.status !== 'rejected')
    const byDate = new Map<IsoDate, { employeeId: string; entry: DayEntry }[]>()
    for (const m of members) {
      for (const d of repo.listDays(m.id)) {
        byDate.set(d.date, [...(byDate.get(d.date) ?? []), { employeeId: m.employeeId, entry: d.entry }])
      }
    }
    const out: GroupMismatch[] = []
    for (const [date, rows] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
      if (rows.length < members.length) out.push({ date, field: 'missing_day', employeeIds: rows.map((r) => r.employeeId) })
      const differ = (pick: (e: DayEntry) => unknown) => new Set(rows.map((r) => JSON.stringify(pick(r.entry)))).size > 1
      if (differ((e) => e.site)) out.push({ date, field: 'site', employeeIds: rows.map((r) => r.employeeId) })
      if (differ((e) => e.regions ?? members[0].header.regions)) out.push({ date, field: 'regions', employeeIds: rows.map((r) => r.employeeId) })
    }
    return out
  }

  /** 6절 주간 점검 — 그 주 진행 중인 신청의 최신 계산 결과 기준 (경고만) */
  function weeklyCheck(employeeId: string, anyDateInWeek: IsoDate, otherWorkHours = 0): WeekCheck {
    const start = weekStartOf(anyDateInWeek)
    const end = addDays(start, 6)
    const results: TripDayResult[] = []
    for (const claim of repo.listClaims({ employeeId })) {
      if (claim.status === 'cancelled' || claim.status === 'rejected') continue
      for (const d of repo.listDays(claim.id)) {
        if (d.date < start || d.date > end) continue
        const r = repo.latestCalc(d.id)?.result
        if (r?.ok) results.push(r)
      }
    }
    return checkWeek(results, otherWorkHours)
  }

  return {
    createClaim, updateDraft, submit, cancel, inviteCompanions,
    adminAdjustDay, review,
    latestCalcs, settlementPreview, groupMismatches, weeklyCheck,
  }
}

export type TripService = ReturnType<typeof createTripService>

/** 동행 초안 복사 규칙 */
export function companionCopy(entry: DayEntry): DayEntry {
  return {
    date: entry.date,
    ...(entry.site ? { site: entry.site } : {}),
    ...(entry.regions ? { regions: entry.regions } : {}),
    ...(entry.noSiteWork ? { noSiteWork: entry.noSiteWork } : {}),
    ...(entry.travelStarts ? { travelStarts: entry.travelStarts } : {}),
    ...(entry.directedWaits ? { directedWaits: entry.directedWaits } : {}),
    ...(entry.jeju ? { jeju: { legs: entry.jeju.legs, evidenceFileIds: [] } } : {}),
    // 실제 시각은 "동행 복사" 출처로 표시 (본인이 확인·수정)
    ...(entry.actual ? { actual: { ...entry.actual, source: 'companion_copy' as const } } : {}),
    // 점심·휴게·사무실 근무·경유 증빙은 사람마다 다르므로 복사하지 않음
  }
}

/** 분류 단계 안내 중 관리자가 반드시 처리해야 하는 것 */
export const REVIEW_NOTICE_CODES: ReadonlySet<string> = new Set([
  'NEXT_DAY_ENTRY_MISSING', 'HOLIDAY_SOURCE_UNVERIFIED',
  'CARRY_IN_NOT_ENTERED', 'CARRY_IN_OVERLAP', 'CARRY_IN_GAP', 'OTHER_REQUEST_SAME_DAY',
])

/** 관리자가 승인 전에 확인해야 하는 항목: 엔진 확인 표시 전부 + 다음 날 기록 누락 + 달력 미검증 */
export function reviewItems(c: TripCalcRecord): string[] {
  const flags = c.result?.ok ? c.result.flags.map((f) => f.code) : []
  const notices = c.classification.notices.filter((n) => REVIEW_NOTICE_CODES.has(n.code)).map((n) => n.code)
  return [...new Set([...flags, ...notices])]
}

function splitByStatus(r: TripDayResult): Pick<SettlementDay, 'confirmed' | 'held' | 'requiresLegalReview'> {
  const confirmed: SettlementDay['confirmed'] = {}
  const held: SettlementDay['held'] = {}
  const put = (key: SettlementKey, value: number, status: 'confirmed' | 'proposed') => {
    if (value > 0) (status === 'confirmed' ? confirmed : held)[key] = value
  }
  put('trip', r.trip.hours, r.valueStatus.trip)
  put('nightTravel', r.trip.nightTravelHours, r.valueStatus.nightTravel)
  put('overtime', r.overtime.hours, r.valueStatus.overtime)
  put('nightOvertime', r.overtime.nightHours, r.valueStatus.nightOvertime)
  if (r.holiday) {
    put('holidayWithin8', r.holiday.within8Hours, r.status)
    put('holidayOver8', r.holiday.over8Hours, r.status)
  }
  return { confirmed, held, requiresLegalReview: r.requiresLegalReview }
}


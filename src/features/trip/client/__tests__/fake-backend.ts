/**
 * 가짜 서버 — TripBackend 를 메모리 저장소 + createTripService 로 흉내 낸다.
 *
 * 040_trip_rpc.sql 의 규칙을 같은 순서로 강제한다: 기능 스위치 → auth.uid() → employees.role → 본인 건 → version/revision.
 * RLS 는 select 에서 흉내 낸다: 직원은 본인 건, admin·manager 는 전부, 스위치가 꺼져 있으면 0행.
 * 서버 계산(/api/trip-compute)은 메모리 서비스가 저장 때 이미 계산했으므로 최신 계산 id 를 돌려준다.
 * failNext() 로 특정 RPC·계산을 한 번 실패시켜 화면 쪽 재시도·오류 전달을 검사한다.
 */

import {
  createMemoryRepository, createTripService, reviewItems,
  type Actor, type HolidayCalendar, type Result, type ServiceDeps, type TripClaimRecord, type TripService,
} from '../../data'
import { fail, ok, type SelectQuery, type TripBackend } from '../backend'
import type { AdjustmentRow, CalcRow, ClaimRow, DayRow, EmployeeRow, FeatureFlagRow, ReviewRow } from '../rows'

export interface FakeEmployee { id: string; role: 'employee' | 'manager' | 'admin'; is_active?: boolean }

export interface FakeServerOptions {
  employees: FakeEmployee[]
  flags?: Partial<Record<FeatureFlagRow['key'], boolean>>
  calendar: HolidayCalendar
  otherRequestLookup?: ServiceDeps['otherRequestLookup']
}

export interface FakeServer extends TripBackend {
  /** 현재 로그인 사용자 (auth.uid). null 이면 미로그인 */
  session: string | null
  flags: Record<FeatureFlagRow['key'], boolean>
  /** 서버 규칙을 그대로 쓰는 내부 서비스 (테스트가 서버 쪽 상태를 직접 만들 때) */
  server: TripService
  calls: { kind: 'select' | 'rpc' | 'compute'; name: string; args?: unknown }[]
  /** 다음 한 번의 호출을 실패시킨다 */
  failNext(name: string, code: string, message?: string): void
}

const isoAt = (n: number) => `2026-11-10T09:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}Z`

export function createFakeServer(o: FakeServerOptions): FakeServer {
  const repo = createMemoryRepository()
  let seq = 0
  let tick = 0
  const deps: ServiceDeps = {
    repo, calendar: o.calendar, now: () => isoAt(tick++), newId: (p) => `${p}-${++seq}`,
    ...(o.otherRequestLookup ? { otherRequestLookup: o.otherRequestLookup } : {}),
  }
  const server = createTripService(deps)
  const flags: Record<FeatureFlagRow['key'], boolean> = { employee_form: false, admin_review: false, payroll_apply: false, ...o.flags }
  const calls: FakeServer['calls'] = []
  const pendingFailures = new Map<string, { code: string; message: string }>()
  const employees = new Map(o.employees.map((e) => [e.id, e]))

  const self: FakeServer = {
    session: null,
    flags,
    server,
    calls,
    failNext: (name, code, message = code) => pendingFailures.set(name, { code, message }),

    async sessionUserId() { return self.session },

    async select<T>(table: string, q: SelectQuery = {}): Promise<Result<T[]>> {
      calls.push({ kind: 'select', name: table, args: q })
      const injected = pendingFailures.get(`select:${table}`)
      if (injected) { pendingFailures.delete(`select:${table}`); return fail(injected.code, injected.message) }
      if (!self.session) return fail('UNAUTHENTICATED', '로그인이 필요합니다')
      const me = employees.get(self.session)
      const rows = tableRows(table, q, me)
      return ok(rows as T[])
    },

    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
      calls.push({ kind: 'rpc', name: fn, args })
      const injected = pendingFailures.get(fn)
      if (injected) { pendingFailures.delete(fn); return fail(injected.code, injected.message) }
      if (!self.session) return fail('UNAUTHENTICATED', '로그인이 필요합니다')
      const key: FeatureFlagRow['key'] = fn === 'trip_admin_adjust_day' || fn === 'trip_review' ? 'admin_review' : 'employee_form'
      if (!flags[key]) return fail('FEATURE_DISABLED', '출장수당 기능이 아직 열리지 않았습니다')
      const me = employees.get(self.session)
      if (!me || me.is_active === false) return fail('UNKNOWN_USER', '직원 정보가 없습니다')
      const actor: Actor = { id: me.id, role: me.role === 'admin' ? 'admin' : 'employee' }
      const r = dispatch(fn, args, actor)
      return r as Result<T>
    },

    async compute(claimId: string) {
      calls.push({ kind: 'compute', name: claimId })
      const injected = pendingFailures.get('compute')
      if (injected) { pendingFailures.delete('compute'); return fail(injected.code, injected.message) }
      if (!self.session) return fail('UNKNOWN_USER', '인증이 필요합니다')
      const claim = repo.getClaim(claimId)
      if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
      const me = employees.get(self.session)
      if (!me) return fail('UNKNOWN_USER', '직원 정보가 없습니다')
      if (claim.employeeId !== me.id && me.role !== 'admin') return fail('FORBIDDEN', '본인 신청만 계산할 수 있습니다')
      const calcs = server.latestCalcs(claimId)
      return ok({
        claimId, ruleVersion: 'fake',
        calcIds: Object.fromEntries(calcs.map((c) => [c.dayId, c.id])),
        reviewCodes: Object.fromEntries(calcs.map((c) => [c.dayId, reviewItems(c)])),
      })
    },
  }

  function dispatch(fn: string, a: Record<string, unknown>, actor: Actor): Result<unknown> {
    switch (fn) {
      case 'trip_create_claim': {
        const r = server.createClaim(actor, { header: a.p_header as never, entries: a.p_entries as never, ...(a.p_employee_id ? { employeeId: a.p_employee_id as string } : {}) })
        return r.ok ? ok({ id: r.value.id, version: r.value.version }) : r
      }
      case 'trip_update_draft': {
        const r = server.updateDraft(actor, a.p_claim_id as string, a.p_expected_version as number, { header: a.p_header as never, entries: a.p_entries as never })
        return r.ok ? ok({ id: r.value.id, version: r.value.version }) : r
      }
      case 'trip_submit': {
        const r = server.submit(actor, a.p_claim_id as string, a.p_expected_version as number)
        return r.ok ? ok(claimRow(r.value)) : r
      }
      case 'trip_cancel': {
        const r = server.cancel(actor, a.p_claim_id as string, a.p_expected_version as number)
        return r.ok ? ok(claimRow(r.value)) : r
      }
      case 'trip_invite_companions':
        return server.inviteCompanions(actor, a.p_claim_id as string, a.p_companion_ids as string[])
      case 'trip_admin_adjust_day': {
        const r = server.adminAdjustDay(actor, a.p_claim_id as string, a.p_day_id as string, a.p_expected_revision as number, a.p_entry as never, a.p_reason as string)
        if (!r.ok) return r
        const claim = repo.getClaim(a.p_claim_id as string)!
        return ok({ claimId: claim.id, dayId: r.value.dayId, revision: r.value.dayRevision, version: claim.version })
      }
      case 'trip_review': {
        const r = server.review(actor, a.p_claim_id as string, {
          action: a.p_action as 'approve', expectedCalcIds: a.p_expected_calc_ids as string[],
          flagDecisions: a.p_flag_decisions as never, ...(a.p_reason ? { reason: a.p_reason as string } : {}),
        })
        return r.ok ? ok(claimRow(r.value)) : r
      }
      default:
        return fail('BACKEND_NOT_READY', `알 수 없는 RPC: ${fn}`)
    }
  }

  function visibleClaims(me: FakeEmployee | undefined): TripClaimRecord[] {
    if (!me) return []
    const all = repo.listClaims()
    if (me.role === 'admin' || me.role === 'manager') return flags.admin_review ? all : []
    return flags.employee_form ? all.filter((c) => c.employeeId === me.id) : []
  }

  function tableRows(table: string, q: SelectQuery, me: FakeEmployee | undefined): unknown[] {
    const inFilter = (col: string, v: string) => {
      const f = q.filter?.[col]
      if (f === undefined) return true
      return Array.isArray(f) ? f.includes(v) : String(f) === v
    }
    switch (table) {
      case 'trip_feature_flags':
        return (Object.keys(flags) as FeatureFlagRow['key'][]).map((key) => ({ key, enabled: flags[key] }))
      case 'employees': {
        const rows: EmployeeRow[] = [...employees.values()].filter((e) => inFilter('id', e.id)).map((e) => ({ id: e.id, role: e.role, is_active: e.is_active ?? true }))
        // 기존 RLS: 본인 행 + 관리자는 전부 라고 가정 (여기서는 본인 행만)
        return rows.filter((r) => r.id === me?.id)
      }
      case 'trip_claims':
        return visibleClaims(me).filter((c) => inFilter('id', c.id)).map(claimRow)
      case 'trip_claim_days': {
        const ids = new Set(visibleClaims(me).map((c) => c.id))
        const rows: DayRow[] = []
        for (const id of ids) {
          if (!inFilter('claim_id', id)) continue
          for (const d of repo.listDays(id)) rows.push({ id: d.id, claim_id: d.claimId, employee_id: d.employeeId, work_date: d.date, entry: d.entry, revision: d.revision, is_removed: false })
        }
        return rows
      }
      case 'trip_day_calcs': {
        const ids = new Set(visibleClaims(me).map((c) => c.id))
        const rows: CalcRow[] = []
        let n = 0
        for (const id of ids) {
          if (!inFilter('claim_id', id)) continue
          for (const d of repo.listDays(id)) {
            const c = repo.latestCalc(d.id)
            if (c) rows.push({ id: c.id, seq: ++n, claim_id: c.claimId, day_id: c.dayId, day_revision: c.dayRevision, rule_version: c.ruleVersion, classification: c.classification, engine_input: c.engineInput, result: c.result, carry_out: c.carryOut ?? null, carry_in: c.carryIn ?? null, computed_at: c.computedAt })
          }
        }
        return rows
      }
      case 'trip_adjustments': {
        const rows: AdjustmentRow[] = []
        for (const c of visibleClaims(me)) {
          if (!inFilter('claim_id', c.id)) continue
          for (const a of repo.listAdjustments(c.id)) rows.push({ id: a.id, day_id: a.dayId, claim_id: a.claimId, admin_id: a.adminId, before_entry: a.before, after_entry: a.after, reason: a.reason, created_at: a.at })
        }
        return rows
      }
      case 'trip_reviews': {
        const rows: ReviewRow[] = []
        for (const c of visibleClaims(me)) {
          if (!inFilter('claim_id', c.id)) continue
          for (const r of repo.listReviews(c.id)) rows.push({ id: r.id, claim_id: r.claimId, admin_id: r.adminId, action: r.action, calc_ids: r.calcIds, flag_decisions: r.flagDecisions, reason: r.reason ?? null, created_at: r.at })
        }
        return rows
      }
      default:
        return []
    }
  }

  return self
}

export function claimRow(c: TripClaimRecord): ClaimRow {
  return {
    id: c.id, employee_id: c.employeeId, group_id: c.groupId, initiator_id: c.initiatorId, origin: c.origin, header: c.header,
    status: c.status, version: c.version, created_at: c.createdAt, updated_at: c.updatedAt, submitted_at: c.submittedAt ?? null,
  }
}

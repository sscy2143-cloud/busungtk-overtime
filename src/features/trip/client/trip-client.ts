/**
 * T6 — 실제 연결 서비스: 서버 RPC 로 쓰고, RLS 로 읽어 온 값을 거울 저장소에 담아 동기로 읽는다.
 *
 * 왜 거울 저장소인가
 *  - 화면(screens/)은 읽기를 동기로 한다(서버 측 정적 렌더 테스트, 간단한 렌더). 읽기 규칙(본인 건·관리자·
 *    검토 상세 묶음·정산 미리보기·주간 점검)은 data/gate.ts 에 이미 있다. 서버에서 받은 행을 메모리 저장소에 담고
 *    같은 GuardedTripService 를 그 위에서 돌리면 읽기 규칙을 두 벌 만들지 않아도 된다.
 *  - 서버가 RLS 로 이미 범위를 잘랐으므로(직원은 본인 건, 관리자는 전부) 거울에는 볼 수 있는 것만 들어온다.
 *
 * 쓰기 규칙 (계약-서버계산.md 1절)
 *  - 입력 원본만 RPC 로 보낸다. 계산 결과·규칙 버전·역할은 보내지 않는다.
 *  - 저장(createClaim/updateDraft/adminAdjustDay) 뒤에 POST /api/trip-compute 로 서버 계산을 만든다.
 *    계산이 실패해도 입력은 저장돼 있다 — 사유는 computeIssue(claimId) 로 보여 주고 제출 때 다시 시도한다.
 *  - 제출이 CALC_STALE_OR_UNTRUSTED 로 거부되면 한 번 다시 계산한 뒤 재시도한다.
 *  - 기능 스위치가 꺼져 있거나 역할이 서버와 다르면 서버를 부르지 않고 거부한다 (서버도 같은 규칙으로 거부한다).
 */

import {
  createGuardedTripService, createMemoryRepository, FEATURES_ALL_OFF,
  type Actor, type FeatureKey, type FeatureState, type GuardedTripService, type HolidayCalendar, type IsoDate, type RepositorySnapshot,
  type Result, type ServiceDeps, type TripAccessGate, type TripCalcRecord, type TripClaimRecord,
} from '../data'
import { fail, ok, type TripBackend } from './backend'
import {
  ADJUSTMENT_COLUMNS, CALC_COLUMNS, CLAIM_COLUMNS, DAY_COLUMNS, EMPLOYEE_COLUMNS, REVIEW_COLUMNS, VIEW_GRANT_COLUMNS,
  toAdjustment, toCalc, toClaim, toDay, toReview, toRole, toViewGrant,
  type AdjustmentRow, type CalcRow, type ClaimRow, type DayRow, type EmployeeRow, type FeatureFlagRow, type ReviewRow, type ViewGrantRow,
} from './rows'
import type { ComputeSummary, SyncInfo, TripClientService, ViewGrantRecord } from './types'

export interface TripClientOptions {
  /** 검증된 공휴일 달력. 거울 저장소의 읽기(주간 점검 등)에 쓴다. 계산 자체는 서버가 한다 */
  calendar: HolidayCalendar
  /** 거울 저장소의 시각·id — 읽기 전용이라 실제로는 쓰이지 않지만 ServiceDeps 가 요구한다 */
  now?: () => string
  /** 한 번에 in(...) 으로 묻는 id 수 (URL 길이 방어) */
  chunkSize?: number
}

const FLAG_KEY: Record<FeatureFlagRow['key'], FeatureKey> = { employee_form: 'employeeForm', admin_review: 'adminReview', payroll_apply: 'payrollApply' }

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export function createTripClient(backend: TripBackend, opts: TripClientOptions): TripClientService {
  const chunkSize = opts.chunkSize ?? 40
  const now = opts.now ?? (() => '1970-01-01T00:00:00Z')

  // ── 거울 상태 ──
  let flags: Record<FeatureKey, boolean> = { ...FEATURES_ALL_OFF }
  let flagSource = 'code-default'
  let sessionActor: Actor | null = null
  let sessionUnknown = false
  let inner: GuardedTripService = emptyService()
  /** 조회 권한자용 읽기 전용 서비스 — 같은 거울 위에서 세션 사용자를 '관리자 읽기' 로 본다. 쓰기는 노출하지 않는다 */
  let viewerInner: GuardedTripService = emptyService()
  let grants: ViewGrantRecord[] = []
  let hasGrant = false
  /** 부여 후보 (admin 세션일 때만 서버에서 받는다) */
  let candidates: string[] = []
  const issues = new Map<string, { code: string; message: string }>()

  function emptyService(): GuardedTripService {
    return buildService(createMemoryRepository(), false)
  }

  function buildService(repo: ReturnType<typeof createMemoryRepository>, asViewer: boolean): GuardedTripService {
    const deps: ServiceDeps = { repo, calendar: opts.calendar, now, newId: (p) => `${p}-local` }
    const gate: TripAccessGate = {
      feature: (key) => ({ enabled: key === 'payrollApply' ? false : flags[key], source: flagSource }),
      resolveActor: (userId) => {
        if (!sessionActor || sessionActor.id !== userId) return null
        return asViewer ? { id: sessionActor.id, role: 'admin' } : sessionActor
      },
    }
    return createGuardedTripService(deps, gate)
  }

  /** 전체 조회 자격: admin 이거나 서버가 준 조회 권한이 있고 검토 스위치가 켜져 있다 (서버 RLS 와 같은 조건) */
  function admitViewer(claimed: Actor): Result<Actor> {
    if (sessionUnknown) return fail('UNAUTHENTICATED', '로그인이 필요합니다')
    if (!sessionActor || sessionActor.id !== claimed.id) return fail('UNKNOWN_USER', '사용자를 확인할 수 없습니다. 다시 로그인하세요')
    if (sessionActor.role !== claimed.role) return fail('ROLE_MISMATCH', '권한 정보가 서버와 다릅니다. 다시 로그인하세요')
    if (!flags.adminReview) return fail('FEATURE_DISABLED', '출장수당 기능이 아직 열리지 않았습니다')
    if (sessionActor.role !== 'admin' && !hasGrant) return fail('VIEW_NOT_GRANTED', '전체 출장 내역 조회 권한이 없습니다')
    return ok(sessionActor)
  }

  /** 기능 스위치 + 서버 역할 확인 (gate.admit 과 같은 코드). 서버를 부르기 전에 거른다 */
  function admit(key: FeatureKey, claimed: Actor, requiredRole?: Actor['role']): Result<Actor> {
    if (sessionUnknown) return fail('UNAUTHENTICATED', '로그인이 필요합니다')
    if (!flags[key] || key === 'payrollApply') return fail('FEATURE_DISABLED', '출장수당 기능이 아직 열리지 않았습니다')
    if (!sessionActor || sessionActor.id !== claimed.id) return fail('UNKNOWN_USER', '사용자를 확인할 수 없습니다. 다시 로그인하세요')
    if (sessionActor.role !== claimed.role) return fail('ROLE_MISMATCH', '권한 정보가 서버와 다릅니다. 다시 로그인하세요')
    if (requiredRole && sessionActor.role !== requiredRole) return fail('FORBIDDEN', '관리자만 할 수 있습니다')
    return ok(sessionActor)
  }

  // ── 동기화 ──
  async function refresh(): Promise<Result<SyncInfo>> {
    const uid = await backend.sessionUserId()
    if (!uid) {
      sessionUnknown = true
      sessionActor = null
      inner = emptyService()
      return fail('UNAUTHENTICATED', '로그인이 필요합니다')
    }
    sessionUnknown = false

    const flagRows = await backend.select<FeatureFlagRow>('trip_feature_flags', { columns: ['key', 'enabled'] })
    if (!flagRows.ok) return flagRows
    const next = { ...FEATURES_ALL_OFF }
    for (const r of flagRows.value) if (r.key in FLAG_KEY) next[FLAG_KEY[r.key]] = r.enabled === true
    next.payrollApply = false   // 코드에서는 어떤 값으로도 켜지지 않는다
    flags = next
    flagSource = 'trip_feature_flags'

    const emp = await backend.select<EmployeeRow>('employees', { columns: EMPLOYEE_COLUMNS, filter: { id: uid } })
    if (!emp.ok) return emp
    const me = emp.value[0]
    sessionActor = me && me.is_active !== false ? { id: me.id, role: toRole(me.role) } : null
    if (!sessionActor) {
      inner = emptyService()
      return fail('UNKNOWN_USER', '직원 정보가 없습니다')
    }

    // 조회 권한 (RLS: 본인 행 + admin 전체). 스위치와 무관하게 읽는다 — 메뉴 표시용
    const grantRows = await backend.select<ViewGrantRow>('trip_view_grants', { columns: VIEW_GRANT_COLUMNS, order: 'granted_at.asc' })
    if (!grantRows.ok) return grantRows
    grants = grantRows.value.map(toViewGrant)
    // 본인 행은 RLS 가 "유효할 때(활성 manager)" 만 돌려주므로, 행이 보이면 곧 유효한 권한이다
    hasGrant = sessionActor.role !== 'admin' && grants.some((g) => g.employeeId === uid)
    candidates = []
    if (sessionActor.role === 'admin') {
      const cand = await backend.rpc<{ employee_id: string }[]>('trip_view_grant_candidates', {})
      if (!cand.ok) return cand
      candidates = (cand.value ?? []).map((r) => r.employee_id)
    }

    // 어느 화면 스위치도 꺼져 있으면 읽을 것이 없다 (RLS 도 0행을 준다)
    if (!flags.employeeForm && !flags.adminReview) {
      inner = emptyService()
      viewerInner = emptyService()
      return ok({ actor: sessionActor, claims: 0, at: now() })
    }

    const claims = await backend.select<ClaimRow>('trip_claims', { columns: CLAIM_COLUMNS, order: 'created_at.asc' })
    if (!claims.ok) return claims
    const ids = claims.value.map((c) => c.id)

    const snapshot: RepositorySnapshot = { claims: claims.value.map(toClaim), days: [], calcs: [], adjustments: [], reviews: [] }
    for (const part of chunk(ids, chunkSize)) {
      const days = await backend.select<DayRow>('trip_claim_days', { columns: DAY_COLUMNS, filter: { claim_id: part, is_removed: false }, order: 'work_date.asc' })
      if (!days.ok) return days
      snapshot.days.push(...days.value.map(toDay))
      const calcs = await backend.select<CalcRow>('trip_day_calcs', { columns: CALC_COLUMNS, filter: { claim_id: part }, order: 'seq.asc' })
      if (!calcs.ok) return calcs
      snapshot.calcs.push(...calcs.value.map(toCalc))
      const adjustments = await backend.select<AdjustmentRow>('trip_adjustments', { columns: ADJUSTMENT_COLUMNS, filter: { claim_id: part }, order: 'created_at.asc' })
      if (!adjustments.ok) return adjustments
      snapshot.adjustments.push(...adjustments.value.map(toAdjustment))
      const reviews = await backend.select<ReviewRow>('trip_reviews', { columns: REVIEW_COLUMNS, filter: { claim_id: part }, order: 'created_at.asc' })
      if (!reviews.ok) return reviews
      snapshot.reviews.push(...reviews.value.map(toReview))
    }
    // 빠진 근무일을 가리키는 옛 계산은 거울에 담지 않는다 (승인 묶음은 활성 근무일의 계산만 참조한다)
    const dayIds = new Set(snapshot.days.map((d) => d.id))
    snapshot.calcs = snapshot.calcs.filter((c) => dayIds.has(c.dayId))

    inner = buildService(createMemoryRepository(snapshot), false)
    viewerInner = buildService(createMemoryRepository(snapshot), true)
    return ok({ actor: sessionActor, claims: ids.length, at: now() })
  }

  /** 쓰기 뒤 거울 갱신. 실패하면 그 사유를 돌려준다 (쓰기 자체는 서버에 반영돼 있다) */
  async function resync<T>(after: () => Result<T>): Promise<Result<T>> {
    const r = await refresh()
    if (!r.ok) return fail(r.code, `저장은 됐지만 다시 불러오지 못했습니다: ${r.message}`)
    return after()
  }

  async function computeInternal(claimId: string): Promise<Result<ComputeSummary>> {
    const r = await backend.compute(claimId)
    if (!r.ok) {
      issues.set(claimId, { code: r.code, message: r.message })
      return r
    }
    issues.delete(claimId)
    return ok(r.value)
  }

  const claimFromMirror = (claimId: string): Result<TripClaimRecord> => {
    const c = findClaim(claimId)
    return c ? ok(c) : fail('NOT_FOUND', '저장 뒤 신청을 다시 찾지 못했습니다')
  }
  function findClaim(claimId: string): TripClaimRecord | undefined {
    // 거울 저장소에는 볼 수 있는 건만 있다. 직원·관리자 어느 쪽 조회로든 같은 기록이다
    const mine = sessionActor ? inner.myClaims(sessionActor) : null
    if (mine?.ok) {
      const c = mine.value.find((x) => x.id === claimId)
      if (c) return c
    }
    if (sessionActor?.role === 'admin') {
      const q = inner.reviewQueue(sessionActor)
      if (q.ok) return q.value.find((x) => x.id === claimId)
    }
    return undefined
  }

  // ── 쓰기 ──
  const createClaim: TripClientService['createClaim'] = async (actor, args) => {
    const a = admit('employeeForm', actor)
    if (!a.ok) return a
    const r = await backend.rpc<{ id: string; version: number }>('trip_create_claim', {
      p_header: args.header, p_entries: args.entries, ...(args.employeeId ? { p_employee_id: args.employeeId } : {}),
    })
    if (!r.ok) return r
    await computeInternal(r.value.id)
    return resync(() => claimFromMirror(r.value.id))
  }

  const updateDraft: TripClientService['updateDraft'] = async (actor, claimId, expectedVersion, args) => {
    const a = admit('employeeForm', actor)
    if (!a.ok) return a
    const r = await backend.rpc<{ id: string; version: number }>('trip_update_draft', {
      p_claim_id: claimId, p_expected_version: expectedVersion,
      ...(args.header ? { p_header: args.header } : {}), ...(args.entries ? { p_entries: args.entries } : {}),
    })
    if (!r.ok) return r
    await computeInternal(claimId)
    return resync(() => claimFromMirror(claimId))
  }

  const submit: TripClientService['submit'] = async (actor, claimId, expectedVersion) => {
    const a = admit('employeeForm', actor)
    if (!a.ok) return a
    let r = await backend.rpc<ClaimRow>('trip_submit', { p_claim_id: claimId, p_expected_version: expectedVersion })
    if (!r.ok && r.code === 'CALC_STALE_OR_UNTRUSTED') {
      // 계산이 없거나 오래됨 → 한 번 다시 계산하고 재시도 (저장 RPC 는 신청 version 을 올리지 않는다)
      const c = await computeInternal(claimId)
      if (!c.ok) return c
      r = await backend.rpc<ClaimRow>('trip_submit', { p_claim_id: claimId, p_expected_version: expectedVersion })
    }
    if (!r.ok) return r
    const row = r.value
    return resync(() => ok(toClaim(row)))
  }

  const cancel: TripClientService['cancel'] = async (actor, claimId, expectedVersion) => {
    const a = admit('employeeForm', actor)
    if (!a.ok) return a
    const r = await backend.rpc<ClaimRow>('trip_cancel', { p_claim_id: claimId, p_expected_version: expectedVersion })
    if (!r.ok) return r
    const row = r.value
    return resync(() => ok(toClaim(row)))
  }

  const inviteCompanions: TripClientService['inviteCompanions'] = async (actor, claimId, companionIds) => {
    const a = admit('employeeForm', actor)
    if (!a.ok) return a
    const r = await backend.rpc<{ created: string[]; skipped: { employeeId: string; reason: string }[] }>('trip_invite_companions', {
      p_claim_id: claimId, p_companion_ids: companionIds,
    })
    if (!r.ok) return r
    const v = r.value
    return resync(() => ok(v))
  }

  const adminAdjustDay: TripClientService['adminAdjustDay'] = async (actor, claimId, dayId, expectedRevision, entry, reason) => {
    const a = admit('adminReview', actor, 'admin')
    if (!a.ok) return a
    const r = await backend.rpc<{ claimId: string; dayId: string; revision: number; version: number }>('trip_admin_adjust_day', {
      p_claim_id: claimId, p_day_id: dayId, p_expected_revision: expectedRevision, p_entry: entry, p_reason: reason,
    })
    if (!r.ok) return r
    const c = await computeInternal(claimId)
    const synced = await refresh()
    if (!synced.ok) return fail(synced.code, `수정은 됐지만 다시 불러오지 못했습니다: ${synced.message}`)
    if (!c.ok) return fail(c.code, `수정은 저장됐지만 서버 계산이 실패했습니다: ${c.message}`)
    const calc = latestCalcOf(claimId, dayId)
    return calc ? ok(calc) : fail('CALC_STALE_OR_UNTRUSTED', '수정한 근무일의 계산 결과를 찾지 못했습니다')
  }

  function latestCalcOf(claimId: string, dayId: string): TripCalcRecord | undefined {
    if (!sessionActor) return undefined
    const calcs = inner.latestCalcs(sessionActor, claimId)
    return calcs.ok ? calcs.value.find((c) => c.dayId === dayId) : undefined
  }

  const review: TripClientService['review'] = async (actor, claimId, args) => {
    const a = admit('adminReview', actor, 'admin')
    if (!a.ok) return a
    const r = await backend.rpc<ClaimRow>('trip_review', {
      p_claim_id: claimId, p_action: args.action, p_expected_calc_ids: args.expectedCalcIds,
      p_flag_decisions: args.flagDecisions ?? [], ...(args.reason ? { p_reason: args.reason } : {}),
    })
    if (!r.ok) return r
    const row = r.value
    return resync(() => ok(toClaim(row)))
  }

  const compute: TripClientService['compute'] = async (actor, claimId) => {
    const a = actor.role === 'admin' ? admit('adminReview', actor, 'admin') : admit('employeeForm', actor)
    if (!a.ok) return a
    const c = await computeInternal(claimId)
    if (!c.ok) return c
    const v = c.value
    return resync(() => ok(v))
  }

  // ── 전체 조회 권한 (읽기 전용) ──
  const asAdminReader = (a: Actor): Actor => ({ id: a.id, role: 'admin' })
  const viewerQueue: TripClientService['viewerQueue'] = (actor, status) => {
    const a = admitViewer(actor)
    if (!a.ok) return a
    return a.value.role === 'admin' ? inner.reviewQueue(a.value, status) : viewerInner.reviewQueue(asAdminReader(a.value), status)
  }
  const viewerDetail: TripClientService['viewerDetail'] = (actor, claimId) => {
    const a = admitViewer(actor)
    if (!a.ok) return a
    return a.value.role === 'admin' ? inner.claimDetail(a.value, claimId) : viewerInner.claimDetail(asAdminReader(a.value), claimId)
  }
  const viewGrantsRead: TripClientService['viewGrants'] = (actor) => {
    if (sessionUnknown) return fail('UNAUTHENTICATED', '로그인이 필요합니다')
    if (!sessionActor || sessionActor.id !== actor.id) return fail('UNKNOWN_USER', '사용자를 확인할 수 없습니다. 다시 로그인하세요')
    if (sessionActor.role !== actor.role) return fail('ROLE_MISMATCH', '권한 정보가 서버와 다릅니다. 다시 로그인하세요')
    return ok(sessionActor.role === 'admin' ? grants : grants.filter((g) => g.employeeId === sessionActor!.id))
  }
  const viewGrantCandidates: TripClientService['viewGrantCandidates'] = (actor) => {
    if (sessionUnknown) return fail('UNAUTHENTICATED', '로그인이 필요합니다')
    if (!sessionActor || sessionActor.id !== actor.id) return fail('UNKNOWN_USER', '사용자를 확인할 수 없습니다. 다시 로그인하세요')
    if (sessionActor.role !== actor.role) return fail('ROLE_MISMATCH', '권한 정보가 서버와 다릅니다. 다시 로그인하세요')
    if (sessionActor.role !== 'admin') return fail('FORBIDDEN', '관리자만 할 수 있습니다')
    return ok([...candidates])
  }
  const setViewGrant: TripClientService['setViewGrant'] = async (actor, employeeId, enabled, note) => {
    if (sessionUnknown) return fail('UNAUTHENTICATED', '로그인이 필요합니다')
    if (!sessionActor || sessionActor.id !== actor.id) return fail('UNKNOWN_USER', '사용자를 확인할 수 없습니다. 다시 로그인하세요')
    if (sessionActor.role !== actor.role) return fail('ROLE_MISMATCH', '권한 정보가 서버와 다릅니다. 다시 로그인하세요')
    if (sessionActor.role !== 'admin') return fail('FORBIDDEN', '관리자만 할 수 있습니다')
    if (!note.trim()) return fail('REASON_REQUIRED', '부여·회수 사유를 입력하세요')
    const r = await backend.rpc<{ employeeId: string; enabled: boolean; changed: boolean }>('trip_set_view_grant', { p_employee_id: employeeId, p_enabled: enabled, p_note: note })
    if (!r.ok) return r
    const v = r.value
    return resync(() => ok(v))
  }

  // ── 읽기: 거울 저장소 위의 GuardedTripService 에 위임 ──
  const reads = {
    myClaims: (actor: Actor) => inner.myClaims(actor),
    myClaim: (actor: Actor, claimId: string) => inner.myClaim(actor, claimId),
    latestCalcs: (actor: Actor, claimId: string) => inner.latestCalcs(actor, claimId),
    weeklyCheck: (actor: Actor, anyDateInWeek: IsoDate, otherWorkHours?: number) => inner.weeklyCheck(actor, anyDateInWeek, otherWorkHours),
    reviewQueue: (actor: Actor, status?: TripClaimRecord['status']) => inner.reviewQueue(actor, status),
    claimDetail: (actor: Actor, claimId: string) => inner.claimDetail(actor, claimId),
    settlementPreview: (actor: Actor, claimId: string) => inner.settlementPreview(actor, claimId),
    groupMismatches: (actor: Actor, groupId: string) => inner.groupMismatches(actor, groupId),
    featureState: (key: FeatureKey): FeatureState => ({ enabled: key === 'payrollApply' ? false : flags[key], source: flagSource }),
  }

  return {
    ...reads,
    createClaim, updateDraft, submit, cancel, inviteCompanions, adminAdjustDay, review,
    compute, refresh,
    computeIssue: (claimId) => issues.get(claimId),
    viewGrantState: (actor) => ({ granted: !!sessionActor && sessionActor.id === actor.id && hasGrant, source: flagSource }),
    viewerQueue, viewerDetail, viewGrants: viewGrantsRead, viewGrantCandidates, setViewGrant,
  }
}

import { describe, expect, it } from 'vitest'
import { reviewItems } from '../../data'
import { MON, TEST_CALENDAR, TUE, alice, bob, boss, dayHeader, siteEntry, stayHeader, unwrap } from '../../data/__tests__/fixtures'
import { createTripClient } from '../trip-client'
import { createFakeServer, type FakeServer } from './fake-backend'

const EMPLOYEES = [
  { id: alice.id, role: 'employee' as const },
  { id: bob.id, role: 'employee' as const },
  { id: boss.id, role: 'admin' as const },
  { id: 'mgr-hr', role: 'manager' as const },
]

function setup(flags: Partial<Record<'employee_form' | 'admin_review', boolean>> = { employee_form: true, admin_review: true }, session: string | null = alice.id) {
  const server = createFakeServer({ employees: EMPLOYEES, flags, calendar: TEST_CALENDAR, otherRequestLookup: (emp, date) => (emp === alice.id && date === TUE ? ['야근 18:00~21:00 (approved)'] : []) })
  server.session = session
  let tick = 0
  const client = createTripClient(server, { calendar: TEST_CALENDAR, now: () => `2026-11-10T10:00:${String(tick++).padStart(2, '0')}Z` })
  return { server, client }
}

const claimArgs = { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }
const rpcNames = (s: FakeServer) => s.calls.filter((c) => c.kind === 'rpc').map((c) => c.name)
const computeCount = (s: FakeServer) => s.calls.filter((c) => c.kind === 'compute').length

describe('동기화: 서버가 보는 범위만 거울에 담긴다', () => {
  it('직원은 본인 건만, 관리자는 전부', async () => {
    const { server, client } = setup()
    server.server.createClaim(alice, claimArgs)
    server.server.createClaim(bob, { header: dayHeader(['부산'], TUE), entries: [siteEntry(TUE, '09:00', '18:00')] })

    expect(unwrap(await client.refresh())).toMatchObject({ actor: alice, claims: 1 })
    expect(unwrap(client.myClaims(alice)).map((c) => c.employeeId)).toEqual([alice.id])

    server.session = boss.id
    expect(unwrap(await client.refresh())).toMatchObject({ actor: boss, claims: 2 })
    expect(unwrap(client.reviewQueue(boss)).length).toBe(2)
  })

  it('manager 는 출장 기능에서 직원으로 취급된다 (api/trip-compute 와 같은 규칙)', async () => {
    const { client } = setup({ employee_form: true, admin_review: true }, 'mgr-hr')
    expect(unwrap(await client.refresh()).actor).toEqual({ id: 'mgr-hr', role: 'employee' })
    expect(await client.review({ id: 'mgr-hr', role: 'admin' }, 'x', { action: 'approve', expectedCalcIds: [] })).toMatchObject({ ok: false, code: 'ROLE_MISMATCH' })
  })

  it('거울에는 최신 계산·검토·조정 이력이 함께 들어온다', async () => {
    const { server, client } = setup()
    const c = unwrap(server.server.createClaim(alice, claimArgs))
    unwrap(server.server.submit(alice, c.id, c.version))
    const calcs = server.server.latestCalcs(c.id)
    const day = server.server.latestCalcs(c.id)[0].dayId
    unwrap(server.server.adminAdjustDay(boss, c.id, day, 1, siteEntry(MON, '07:00', '17:00'), '완료보고 기준'))
    const after = server.server.latestCalcs(c.id)
    unwrap(server.server.review(boss, c.id, { action: 'approve', expectedCalcIds: after.map((x) => x.id), flagDecisions: after.flatMap((x) => reviewItems(x).map((code) => ({ calcId: x.id, code, decision: 'acknowledged' as const }))) }))

    server.session = boss.id
    await client.refresh()
    const detail = unwrap(client.claimDetail(boss, c.id))
    expect(detail.claim.status).toBe('approved')
    expect(detail.adjustments).toHaveLength(1)
    expect(detail.reviews).toHaveLength(1)
    expect(detail.approvedCalcs.map((x) => x.id)).toEqual(after.map((x) => x.id))
    expect(detail.calcs[0].id).not.toBe(calcs[0].id)   // 수정 뒤 새 계산
    expect(unwrap(client.settlementPreview(boss, c.id)).payrollApplicable).toBe(false)
  })
})

describe('기능 스위치 OFF — 서버를 부르지 않고 거부한다', () => {
  it('읽기·쓰기·계산 전부 FEATURE_DISABLED, RPC·compute 호출 0건', async () => {
    const { server, client } = setup({})
    await client.refresh()
    expect(client.featureState('employeeForm')).toEqual({ enabled: false, source: 'trip_feature_flags' })
    expect(client.myClaims(alice)).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
    expect(await client.createClaim(alice, claimArgs)).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
    expect(await client.compute(alice, 'claim-1')).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
    server.session = boss.id
    await client.refresh()
    expect(await client.review(boss, 'claim-1', { action: 'approve', expectedCalcIds: [] })).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
    expect(rpcNames(server)).toEqual([])
    expect(computeCount(server)).toBe(0)
    // 스위치가 꺼져 있으면 자료 표도 읽지 않는다
    expect(server.calls.filter((c) => c.kind === 'select').map((c) => c.name)).toEqual(['trip_feature_flags', 'employees', 'trip_feature_flags', 'employees'])
  })

  it('급여 반영 스위치는 서버가 true 를 줘도 꺼진 채다', async () => {
    const { server, client } = setup()
    server.flags.payroll_apply = true
    await client.refresh()
    expect(client.featureState('payrollApply').enabled).toBe(false)
  })

  it('서버 플래그가 바뀌면 다음 refresh 에서 따라간다 (코드 기본값은 전부 OFF)', async () => {
    const { server, client } = setup({})
    expect(client.featureState('employeeForm')).toEqual({ enabled: false, source: 'code-default' })
    server.flags.employee_form = true
    await client.refresh()
    expect(client.featureState('employeeForm').enabled).toBe(true)
  })
})

describe('인증·역할·본인 건', () => {
  it('미로그인: refresh 는 UNAUTHENTICATED, 쓰기도 서버를 부르지 않는다', async () => {
    const { server, client } = setup(undefined, null)
    expect(await client.refresh()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' })
    expect(await client.createClaim(alice, claimArgs)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' })
    expect(rpcNames(server)).toEqual([])
  })

  it('세션 사용자와 다른 actor 로 부르면 UNKNOWN_USER, 역할이 다르면 ROLE_MISMATCH', async () => {
    const { client } = setup()
    await client.refresh()
    expect(await client.createClaim(bob, claimArgs)).toMatchObject({ ok: false, code: 'UNKNOWN_USER' })
    expect(await client.createClaim({ id: alice.id, role: 'admin' }, claimArgs)).toMatchObject({ ok: false, code: 'ROLE_MISMATCH' })
    expect(client.myClaims(bob)).toMatchObject({ ok: false, code: 'UNKNOWN_USER' })
  })

  it('직원은 관리자 기능을 못 쓰고, 다른 직원 건은 거울에 없어 NOT_FOUND', async () => {
    const { server, client } = setup()
    const other = unwrap(server.server.createClaim(bob, { header: dayHeader(['부산'], TUE), entries: [siteEntry(TUE, '09:00', '18:00')] }))
    await client.refresh()
    expect(await client.review(alice, other.id, { action: 'approve', expectedCalcIds: [] })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(client.myClaim(alice, other.id)).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await client.cancel(alice, other.id, 1)).toMatchObject({ ok: false, code: 'FORBIDDEN' })   // 서버 RPC 가 거부
  })

  it('비활성 직원은 UNKNOWN_USER', async () => {
    const server = createFakeServer({ employees: [{ id: 'gone', role: 'employee', is_active: false }], flags: { employee_form: true }, calendar: TEST_CALENDAR })
    server.session = 'gone'
    const client = createTripClient(server, { calendar: TEST_CALENDAR })
    expect(await client.refresh()).toMatchObject({ ok: false, code: 'UNKNOWN_USER' })
  })
})

describe('직원 흐름: 저장 → 서버 계산 → 제출', () => {
  it('createClaim 은 입력 원본만 보내고, 계산을 부르고, 거울을 갱신한다', async () => {
    const { server, client } = setup()
    await client.refresh()
    const r = unwrap(await client.createClaim(alice, claimArgs))
    expect(r).toMatchObject({ employeeId: alice.id, status: 'draft', version: 1 })
    const call = server.calls.find((c) => c.kind === 'rpc' && c.name === 'trip_create_claim')!
    expect(Object.keys(call.args as object).sort()).toEqual(['p_entries', 'p_header'])   // 계산 결과·규칙 버전·역할 없음
    expect(computeCount(server)).toBe(1)
    expect(unwrap(client.latestCalcs(alice, r.id))[0].result).toMatchObject({ ok: true, trip: { hours: 4 } })
    expect(client.computeIssue(r.id)).toBeUndefined()
  })

  it('계산이 실패해도 입력은 저장되고 사유가 남는다', async () => {
    const { server, client } = setup()
    await client.refresh()
    server.failNext('compute', 'RULE_VERSION_MISMATCH', '규칙 버전이 다릅니다')
    const r = unwrap(await client.createClaim(alice, claimArgs))
    expect(r.status).toBe('draft')
    expect(client.computeIssue(r.id)).toEqual({ code: 'RULE_VERSION_MISMATCH', message: '규칙 버전이 다릅니다' })
    expect(unwrap(await client.compute(alice, r.id)).calcIds).toBeTruthy()
    expect(client.computeIssue(r.id)).toBeUndefined()
  })

  it('제출이 CALC_STALE_OR_UNTRUSTED 면 한 번 다시 계산하고 재시도한다', async () => {
    const { server, client } = setup()
    await client.refresh()
    const c = unwrap(await client.createClaim(alice, claimArgs))
    server.failNext('trip_submit', 'CALC_STALE_OR_UNTRUSTED')
    const r = unwrap(await client.submit(alice, c.id, c.version))
    expect(r.status).toBe('submitted')
    expect(rpcNames(server).filter((n) => n === 'trip_submit')).toHaveLength(2)
    expect(computeCount(server)).toBe(2)   // 저장 때 1 + 재시도 전 1
  })

  it('재계산도 실패하면 그 코드가 그대로 온다 (제출 안 됨)', async () => {
    const { server, client } = setup()
    await client.refresh()
    const c = unwrap(await client.createClaim(alice, claimArgs))
    server.failNext('trip_submit', 'CALC_STALE_OR_UNTRUSTED')
    server.failNext('compute', 'RULE_VERSION_MISMATCH')
    expect(await client.submit(alice, c.id, c.version)).toMatchObject({ ok: false, code: 'RULE_VERSION_MISMATCH' })
    expect(unwrap(client.myClaim(alice, c.id)).claim.status).toBe('draft')
  })

  it('updateDraft: 옛 version 이면 VERSION_CONFLICT (서버가 거부, 거울은 그대로)', async () => {
    const { client } = setup()
    await client.refresh()
    const c = unwrap(await client.createClaim(alice, claimArgs))
    unwrap(await client.updateDraft(alice, c.id, c.version, { entries: [siteEntry(MON, '07:00', '17:00')] }))
    expect(await client.updateDraft(alice, c.id, c.version, { entries: [siteEntry(MON, '08:00', '18:00')] })).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
    expect(unwrap(client.myClaim(alice, c.id)).claim.version).toBe(2)
  })

  it('같은 날짜 다른 신청은 DUPLICATE_DAY, 같은 날 야근은 관리자 확인 항목으로 온다', async () => {
    const { client } = setup()
    await client.refresh()
    unwrap(await client.createClaim(alice, claimArgs))
    expect(await client.createClaim(alice, claimArgs)).toMatchObject({ ok: false, code: 'DUPLICATE_DAY' })
    const withOt = unwrap(await client.createClaim(alice, { header: dayHeader(['대전'], TUE), entries: [siteEntry(TUE, '08:00', '17:00')] }))
    const calc = unwrap(client.latestCalcs(alice, withOt.id))[0]
    expect(calc.classification.notices.map((n) => n.code)).toContain('OTHER_REQUEST_SAME_DAY')
  })

  it('취소·동행 초안', async () => {
    const { client } = setup()
    await client.refresh()
    const c = unwrap(await client.createClaim(alice, { header: stayHeader(['대전'], MON, TUE), entries: [siteEntry(MON, '08:00', '17:00'), siteEntry(TUE, '08:00', '17:00')] }))
    const inv = unwrap(await client.inviteCompanions(alice, c.id, [bob.id, alice.id]))
    expect(inv.created).toHaveLength(1)
    const cancelled = unwrap(await client.cancel(alice, c.id, c.version))
    expect(cancelled.status).toBe('cancelled')
    expect(unwrap(client.myClaims(alice)).find((x) => x.id === c.id)?.status).toBe('cancelled')
  })
})

describe('관리자 흐름: 수정 → 재계산 → 승인', () => {
  async function submitted() {
    const { server, client } = setup()
    const c = unwrap(server.server.createClaim(alice, claimArgs))
    unwrap(server.server.submit(alice, c.id, c.version))
    server.session = boss.id
    await client.refresh()
    return { server, client, claim: unwrap(client.reviewQueue(boss, 'submitted'))[0] }
  }

  it('승인은 화면이 본 계산 id 집합과 확인 표시를 그대로 보낸다', async () => {
    const { server, client, claim } = await submitted()
    const detail = unwrap(client.claimDetail(boss, claim.id))
    const ids = detail.calcs.map((x) => x.id)
    const decisions = detail.calcs.flatMap((x) => reviewItems(x).map((code) => ({ calcId: x.id, code, decision: 'acknowledged' as const })))
    const r = unwrap(await client.review(boss, claim.id, { action: 'approve', expectedCalcIds: ids, flagDecisions: decisions }))
    expect(r.status).toBe('approved')
    const call = server.calls.find((c) => c.kind === 'rpc' && c.name === 'trip_review')!
    expect(call.args).toMatchObject({ p_claim_id: claim.id, p_action: 'approve', p_expected_calc_ids: ids, p_flag_decisions: decisions })
    expect(unwrap(client.settlementPreview(boss, claim.id)).days).toHaveLength(1)
  })

  it('수정하면 새 계산이 오고, 옛 계산 id 로 승인하면 STALE_CALC', async () => {
    const { client, claim } = await submitted()
    const before = unwrap(client.claimDetail(boss, claim.id))
    const day = before.days[0]
    const calc = unwrap(await client.adminAdjustDay(boss, claim.id, day.id, day.revision, siteEntry(MON, '07:00', '17:00'), '완료보고 07시'))
    expect(calc.dayRevision).toBe(2)
    expect(calc.result).toMatchObject({ ok: true })
    expect(await client.review(boss, claim.id, { action: 'approve', expectedCalcIds: before.calcs.map((x) => x.id) })).toMatchObject({ ok: false, code: 'STALE_CALC' })
    expect(await client.adminAdjustDay(boss, claim.id, day.id, day.revision, siteEntry(MON, '06:00', '17:00'), '다시')).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
  })

  it('수정 뒤 계산이 실패하면 수정은 남고 실패 코드가 온다', async () => {
    const { server, client, claim } = await submitted()
    const day = unwrap(client.claimDetail(boss, claim.id)).days[0]
    server.failNext('compute', 'RULE_VERSION_MISMATCH')
    expect(await client.adminAdjustDay(boss, claim.id, day.id, day.revision, siteEntry(MON, '07:00', '17:00'), '사유')).toMatchObject({ ok: false, code: 'RULE_VERSION_MISMATCH' })
    expect(unwrap(client.claimDetail(boss, claim.id)).adjustments).toHaveLength(1)
    expect(client.computeIssue(claim.id)).toBeTruthy()
  })

  it('본인 건 검토는 SELF_REVIEW, 사유 없는 반려는 REASON_REQUIRED (서버 코드가 그대로 온다)', async () => {
    const { server, client } = setup()
    server.session = boss.id
    await client.refresh()
    const own = unwrap(await client.createClaim(boss, claimArgs))
    unwrap(await client.submit(boss, own.id, own.version))
    const ids = unwrap(client.latestCalcs(boss, own.id)).map((x) => x.id)
    expect(await client.review(boss, own.id, { action: 'approve', expectedCalcIds: ids })).toMatchObject({ ok: false, code: 'SELF_REVIEW' })
    const { server: s2, client: c2 } = setup()
    const c = unwrap(s2.server.createClaim(alice, claimArgs)); unwrap(s2.server.submit(alice, c.id, c.version))
    s2.session = boss.id; await c2.refresh()
    expect(await c2.review(boss, c.id, { action: 'reject', expectedCalcIds: unwrap(c2.latestCalcs(boss, c.id)).map((x) => x.id) })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
  })

  it('동기화가 실패하면 저장은 됐다는 안내와 함께 그 코드를 돌려준다', async () => {
    const { server, client } = setup()
    await client.refresh()
    server.failNext('select:trip_claims', 'NETWORK', '끊김')
    const r = await client.createClaim(alice, claimArgs)
    expect(r).toMatchObject({ ok: false, code: 'NETWORK' })
    if (!r.ok) expect(r.message).toContain('저장은 됐지만')
    expect(unwrap(await client.refresh()).claims).toBe(1)
  })
})

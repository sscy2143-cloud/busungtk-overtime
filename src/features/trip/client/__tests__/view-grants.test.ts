import { describe, expect, it } from 'vitest'
import { MON, TEST_CALENDAR, TUE, alice, bob, boss, dayHeader, siteEntry, unwrap } from '../../data/__tests__/fixtures'
import { createTripClient } from '../trip-client'
import { createFakeServer } from './fake-backend'

const LEAD = 'emp-lead'      // 부여 후보 = role 'manager' (출장 기능 안에서는 직원과 같은 actor 역할)
const LEAD2 = 'emp-lead2'
const EMPLOYEES = [
  { id: alice.id, role: 'employee' as const }, { id: bob.id, role: 'employee' as const },
  { id: LEAD, role: 'manager' as const }, { id: LEAD2, role: 'manager' as const }, { id: boss.id, role: 'admin' as const },
]
const lead = { id: LEAD, role: 'employee' as const }
const lead2 = { id: LEAD2, role: 'employee' as const }

function setup() {
  // 역할을 바꾸는 테스트가 있으므로 명부는 복사해 넘긴다
  const server = createFakeServer({ employees: EMPLOYEES.map((e) => ({ ...e })), flags: { employee_form: true, admin_review: true }, calendar: TEST_CALENDAR })
  const c1 = unwrap(server.server.createClaim(alice, { header: dayHeader(['대전'], MON), entries: [siteEntry(MON, '08:00', '17:00')] }))
  unwrap(server.server.submit(alice, c1.id, c1.version))
  unwrap(server.server.createClaim(bob, { header: dayHeader(['부산'], TUE), entries: [siteEntry(TUE, '09:00', '18:00')] }))
  const client = createTripClient(server, { calendar: TEST_CALENDAR })
  return { server, client, c1 }
}

describe('전체 출장 내역 조회 권한 — admin 지정', () => {
  it('권한 없는 팀장은 본인 건만, 전체 조회는 VIEW_NOT_GRANTED', async () => {
    const { server, client } = setup()
    server.session = LEAD
    await client.refresh()
    expect(client.viewGrantState(lead)).toMatchObject({ granted: false })
    expect(unwrap(client.myClaims(lead))).toEqual([])
    expect(client.viewerQueue(lead)).toMatchObject({ ok: false, code: 'VIEW_NOT_GRANTED' })
    expect(client.viewerDetail(lead, 'claim-1')).toMatchObject({ ok: false, code: 'VIEW_NOT_GRANTED' })
  })

  it('admin 이 부여하면 전체 목록·상세를 읽을 수 있고, 다른 팀장에게는 전파되지 않는다', async () => {
    const { server, client, c1 } = setup()
    server.session = boss.id
    await client.refresh()
    const r = unwrap(await client.setViewGrant(boss, LEAD, true, '영업1팀 팀장'))
    expect(r).toEqual({ employeeId: LEAD, enabled: true, changed: true })
    const call = server.calls.find((c) => c.kind === 'rpc' && c.name === 'trip_set_view_grant')!
    expect(call.args).toEqual({ p_employee_id: LEAD, p_enabled: true, p_note: '영업1팀 팀장' })
    expect(unwrap(client.viewGrants(boss)).map((g) => g.employeeId)).toEqual([LEAD])

    server.session = LEAD
    await client.refresh()
    expect(client.viewGrantState(lead).granted).toBe(true)
    expect(unwrap(client.viewerQueue(lead)).map((c) => c.employeeId).sort()).toEqual([alice.id, bob.id])
    const detail = unwrap(client.viewerDetail(lead, c1.id))
    expect(detail.claim.status).toBe('submitted')
    expect(detail.calcs.length).toBe(1)
    // 거울 자료(RLS)는 전체지만, 본인 신청 목록은 여전히 본인 것만
    expect(unwrap(client.myClaims(lead))).toEqual([])
    // 본인 행만 보인다
    expect(unwrap(client.viewGrants(lead)).map((g) => g.employeeId)).toEqual([LEAD])

    server.session = LEAD2
    await client.refresh()
    expect(client.viewGrantState(lead2).granted).toBe(false)
    expect(client.viewerQueue(lead2)).toMatchObject({ ok: false, code: 'VIEW_NOT_GRANTED' })
    expect(unwrap(client.viewGrants(lead2))).toEqual([])
  })

  it('조회 권한이 있어도 쓰기·승인·수정·권한 변경은 전부 거부된다 (서버 FORBIDDEN)', async () => {
    const { server, client, c1 } = setup()
    server.session = boss.id; await client.refresh()
    unwrap(await client.setViewGrant(boss, LEAD, true, '팀장'))
    server.session = LEAD; await client.refresh()
    const detail = unwrap(client.viewerDetail(lead, c1.id))
    expect(await client.review(lead, c1.id, { action: 'approve', expectedCalcIds: detail.calcs.map((x) => x.id) })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await client.adminAdjustDay(lead, c1.id, detail.days[0].id, detail.days[0].revision, siteEntry(MON, '07:00', '17:00'), '사유')).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await client.setViewGrant(lead, LEAD2, true, 'x')).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await client.cancel(lead, c1.id, 1)).toMatchObject({ ok: false, code: 'FORBIDDEN' })   // 남의 건
    expect(client.claimDetail(lead, c1.id)).toMatchObject({ ok: false, code: 'FORBIDDEN' })        // 관리자용 읽기도 역할로 거부
    expect(server.calls.filter((c) => c.kind === 'rpc' && c.name === 'trip_set_view_grant').length).toBe(1)   // 팀장의 권한 변경 시도는 서버로 가지 않았다
  })

  it('회수하면 다음 refresh 부터 즉시 차단, 이미 같은 상태면 changed=false', async () => {
    const { server, client } = setup()
    server.session = boss.id; await client.refresh()
    unwrap(await client.setViewGrant(boss, LEAD, true, '팀장'))
    expect(unwrap(await client.setViewGrant(boss, LEAD, true, '다시'))).toMatchObject({ changed: false })
    expect(unwrap(await client.setViewGrant(boss, LEAD, false, '보직 해제'))).toMatchObject({ enabled: false, changed: true })
    server.session = LEAD; await client.refresh()
    expect(client.viewGrantState(lead).granted).toBe(false)
    expect(client.viewerQueue(lead)).toMatchObject({ ok: false, code: 'VIEW_NOT_GRANTED' })
  })

  it('사유 없음·본인·관리자 대상·비활성·role=employee 는 거부 (대상은 활성 manager 뿐)', async () => {
    const server = createFakeServer({ employees: [...EMPLOYEES, { id: 'gone', role: 'manager' as const, is_active: false }], flags: { admin_review: true }, calendar: TEST_CALENDAR })
    server.session = boss.id
    const client = createTripClient(server, { calendar: TEST_CALENDAR })
    await client.refresh()
    expect(await client.setViewGrant(boss, LEAD, true, '  ')).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect(await client.setViewGrant(boss, boss.id, true, 'x')).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    expect(await client.setViewGrant(boss, 'gone', true, 'x')).toMatchObject({ ok: false, code: 'NOT_ELIGIBLE' })
    expect(await client.setViewGrant(boss, alice.id, true, 'x')).toMatchObject({ ok: false, code: 'NOT_ELIGIBLE' })
    expect(unwrap(client.viewGrants(boss))).toEqual([])
    expect(server.calls.filter((c) => c.kind === 'rpc' && c.name === 'trip_set_view_grant').length).toBe(3)   // 사유 없음은 서버로 가지 않음
  })

  it('부여 후보는 admin 만 받고, 서버 판정(활성 manager)과 같은 명단이다', async () => {
    const { server, client } = setup()
    server.session = boss.id; await client.refresh()
    expect(unwrap(client.viewGrantCandidates(boss)).sort()).toEqual([LEAD, LEAD2].sort())
    expect(server.calls.filter((c) => c.kind === 'rpc' && c.name === 'trip_view_grant_candidates').length).toBe(1)
    server.session = LEAD; await client.refresh()
    expect(client.viewGrantCandidates(lead)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(server.calls.filter((c) => c.kind === 'rpc' && c.name === 'trip_view_grant_candidates').length).toBe(1)   // 직원 세션은 서버를 부르지 않는다
  })

  it('역할이 manager 에서 employee 로 바뀌면 행이 남아 있어도 즉시 막히고, admin 화면에서는 후보 밖 권한으로 보인다', async () => {
    const { server, client } = setup()
    server.session = boss.id; await client.refresh()
    unwrap(await client.setViewGrant(boss, LEAD, true, '팀장'))
    server.employees.get(LEAD)!.role = 'employee'
    server.session = LEAD; await client.refresh()
    expect(client.viewGrantState(lead).granted).toBe(false)
    expect(client.viewerQueue(lead)).toMatchObject({ ok: false, code: 'VIEW_NOT_GRANTED' })
    expect(unwrap(client.viewGrants(lead))).toEqual([])
    expect(unwrap(client.myClaims(lead))).toEqual([])
    server.session = boss.id; await client.refresh()
    expect(unwrap(client.viewGrants(boss)).map((g) => g.employeeId)).toEqual([LEAD])          // 행은 남아 admin 이 회수로 정리
    expect(unwrap(client.viewGrantCandidates(boss))).toEqual([LEAD2])
    expect(unwrap(await client.setViewGrant(boss, LEAD, false, '역할 변경 정리'))).toMatchObject({ enabled: false, changed: true })
  })

  it('검토 스위치가 꺼지면 권한이 있어도 전체 조회가 막힌다 (admin 포함)', async () => {
    const { server, client } = setup()
    server.session = boss.id; await client.refresh()
    unwrap(await client.setViewGrant(boss, LEAD, true, '팀장'))
    server.flags.admin_review = false
    server.session = LEAD; await client.refresh()
    expect(client.viewGrantState(lead).granted).toBe(true)                 // 권한 자체는 남아 있지만
    expect(client.viewerQueue(lead)).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
    server.session = boss.id; await client.refresh()
    expect(client.viewerQueue(boss)).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
  })

  it('admin 은 권한 없이도 조회 화면(viewerQueue)을 쓸 수 있다', async () => {
    const { server, client } = setup()
    server.session = boss.id; await client.refresh()
    expect(client.viewGrantState(boss).granted).toBe(false)
    expect(unwrap(client.viewerQueue(boss, 'submitted')).length).toBe(1)
  })
})

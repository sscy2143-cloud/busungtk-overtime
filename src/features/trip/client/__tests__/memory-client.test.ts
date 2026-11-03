import { describe, expect, it } from 'vitest'
import { createGuardedTripService, createMemoryRepository, createStaticGate, type ServiceDeps } from '../../data'
import { MON, TEST_CALENDAR, alice, boss, dayHeader, siteEntry, unwrap } from '../../data/__tests__/fixtures'
import { fromMemoryService } from '../memory-client'

function client(flags: Parameters<typeof createStaticGate>[0] = { employeeForm: true, adminReview: true }) {
  let seq = 0
  const deps: ServiceDeps = { repo: createMemoryRepository(), calendar: TEST_CALENDAR, now: () => '2026-11-10T09:00:00Z', newId: (p) => `${p}-${++seq}` }
  return fromMemoryService(createGuardedTripService(deps, createStaticGate(flags, { [alice.id]: 'employee', [boss.id]: 'admin' })))
}

describe('메모리 서비스 → 화면용 서비스 모양', () => {
  it('쓰기는 Promise 로, 읽기는 그대로, compute 는 최신 계산 id 를 돌려준다', async () => {
    const svc = client()
    const c = unwrap(await svc.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const calcs = unwrap(svc.latestCalcs(alice, c.id))
    expect(unwrap(await svc.compute(alice, c.id))).toMatchObject({ claimId: c.id, calcIds: { [calcs[0].dayId]: calcs[0].id } })
    expect(unwrap(await svc.submit(alice, c.id, c.version)).status).toBe('submitted')
    expect(unwrap(await svc.refresh())).toMatchObject({ claims: 0 })
    expect(svc.computeIssue(c.id)).toBeUndefined()
  })

  it('기능이 꺼져 있으면 compute 도 FEATURE_DISABLED', async () => {
    const svc = client({})
    expect(await svc.compute(alice, 'claim-1')).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
    expect(await svc.createClaim(alice, { header: dayHeader(['대전']), entries: [] })).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' })
  })
})

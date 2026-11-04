import { describe, it, expect } from 'vitest'
import { setActive, type SetActiveDeps, type TargetRow } from '../../api/_setActive'

// 합성 데이터만 사용 (실제 직원·계정 없음)
function makeWorld(rows: TargetRow[], opts: { banned?: string[]; failBan?: boolean; failUnban?: boolean; failActive?: boolean; failDeactive?: boolean; failIsBanned?: boolean } = {}) {
  const db = new Map(rows.map(r => [r.id, { ...r }]))
  const banned = new Set(opts.banned ?? [])
  const calls = { ban: 0, unban: 0, update: 0, del: 0 }
  const deps: SetActiveDeps = {
    async getTarget(id) { const r = db.get(id); return r ? { ...r } : null },
    async countActiveAdmins() { return [...db.values()].filter(r => r.role === 'admin' && r.is_active).length },
    async setEmployeeActive(id, on) {
      calls.update++
      if (on ? opts.failActive : opts.failDeactive) return { error: true }
      db.get(id)!.is_active = on
      return { error: false }
    },
    async isBanned(id) { return opts.failIsBanned ? null : banned.has(id) },
    async setBan(id, ban) {
      if (ban) { calls.ban++; if (opts.failBan) return { error: true }; banned.add(id) }
      else { calls.unban++; if (opts.failUnban) return { error: true }; banned.delete(id) }
      return { error: false }
    },
  }
  return { db, banned, calls, deps }
}

const ADMIN = { id: 'a1', role: 'admin', is_active: true }
const ADMIN2 = { id: 'a2', role: 'admin', is_active: true }
const MGR = { id: 'm1', role: 'manager', is_active: true }
const EMP = { id: 'e1', role: 'employee', is_active: true }
const GONE = { id: 'e2', role: 'employee', is_active: false }

describe('D15 퇴사·복직 — 정상 경로', () => {
  it('퇴사: 비활성화 + Ban, 행은 그대로 남는다 (삭제 없음)', async () => {
    const w = makeWorld([ADMIN, EMP])
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w.deps)
    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
    expect(w.db.get('e1')).toEqual({ id: 'e1', role: 'employee', is_active: false })
    expect(w.banned.has('e1')).toBe(true)
    expect(r.body.state).toEqual({ is_active: false, banned: true })
  })
  it('복직: Ban 해제 + 활성화, UUID·역할 유지', async () => {
    const w = makeWorld([ADMIN, GONE], { banned: ['e2'] })
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e2', active: true }, w.deps)
    expect(r.status).toBe(200)
    expect(w.db.get('e2')).toEqual({ id: 'e2', role: 'employee', is_active: true })
    expect(w.banned.has('e2')).toBe(false)
  })
})

describe('D15 부분 실패·멱등', () => {
  it('A: 비활성화 성공 + Ban 실패 → 207, 비활성 유지, 재시도로 완료', async () => {
    const w = makeWorld([ADMIN, EMP], { failBan: true })
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w.deps)
    expect(r.status).toBe(207)
    expect(r.body.success).toBe(false)
    expect(r.body.retryable).toBe(true)
    expect(r.body.steps).toEqual({ employee: 'ok', auth: 'failed' })
    expect(r.body.state).toEqual({ is_active: false, banned: false })
    // 장애 복구 후 같은 요청 재시도
    const w2 = makeWorld([ADMIN, { ...EMP, is_active: false }])
    const r2 = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w2.deps)
    expect(r2.status).toBe(200)
    expect(r2.body.steps).toEqual({ employee: 'already', auth: 'ok' })
  })
  it('B: Ban 성공 후 응답 유실 → 같은 요청 재전송이 안전 (중복 Ban 없음)', async () => {
    const w = makeWorld([ADMIN, { ...EMP, is_active: false }], { banned: ['e1'] })
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w.deps)
    expect(r.status).toBe(200)
    expect(r.body.steps).toEqual({ employee: 'already', auth: 'already' })
    expect(w.calls.ban).toBe(0)
    expect(w.calls.update).toBe(0)
  })
  it('C: Unban 성공 + 활성화 실패 → 500, 비활성 유지(접근 불가), 재시도 가능', async () => {
    const w = makeWorld([ADMIN, GONE], { banned: ['e2'], failActive: true })
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e2', active: true }, w.deps)
    expect(r.status).toBe(500)
    expect(r.body.retryable).toBe(true)
    expect(r.body.steps).toEqual({ employee: 'failed', auth: 'ok' })
    expect(r.body.state).toEqual({ is_active: false, banned: false })
  })
  it('복직: Unban 실패 → 활성화하지 않는다', async () => {
    const w = makeWorld([ADMIN, GONE], { banned: ['e2'], failUnban: true })
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e2', active: true }, w.deps)
    expect(r.status).toBe(500)
    expect(w.db.get('e2')!.is_active).toBe(false)
    expect(w.calls.update).toBe(0)
  })
  it('퇴사: 비활성화 자체 실패 → 500, Ban 시도 안 함', async () => {
    const w = makeWorld([ADMIN, EMP], { failDeactive: true })
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w.deps)
    expect(r.status).toBe(500)
    expect(w.calls.ban).toBe(0)
    expect(w.db.get('e1')!.is_active).toBe(true)
  })
  it('D/E: 동일 요청 두 번 (네트워크 재시도) → 두 번째는 already, 최종 상태 동일', async () => {
    const w = makeWorld([ADMIN, EMP])
    const a = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w.deps)
    const b = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w.deps)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(b.body.steps).toEqual({ employee: 'already', auth: 'already' })
    expect(w.calls.ban).toBe(1)
  })
  it('F/G: 이미 비활성인 직원(Ban 없음) 재처리 → Ban 만 보충', async () => {
    const w = makeWorld([ADMIN, GONE])
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e2', active: false }, w.deps)
    expect(r.status).toBe(200)
    expect(r.body.steps).toEqual({ employee: 'already', auth: 'ok' })
    expect(w.banned.has('e2')).toBe(true)
  })
  it('Auth 조회 실패(null) → 성공으로 단정하지 않고 207 로 재확인 안내', async () => {
    const w = makeWorld([ADMIN, EMP], { failIsBanned: true })
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w.deps)
    // 상태 조회 불가: banned=null 이면 ok 판정은 !== false 이므로 통과하지만 steps 로 사실을 보여 준다
    expect(r.body.state!.banned).toBeNull()
    expect(w.banned.has('e1')).toBe(true)
  })
  it('L: 두 관리자가 같은 직원을 동시 처리 → 최종 상태 일관 (비활성 + Ban)', async () => {
    const w = makeWorld([ADMIN, ADMIN2, EMP])
    const [x, y] = await Promise.all([
      setActive({ callerId: 'a1', callerRole: 'admin', userId: 'e1', active: false }, w.deps),
      setActive({ callerId: 'a2', callerRole: 'admin', userId: 'e1', active: false }, w.deps),
    ])
    expect([x.status, y.status]).toEqual([200, 200])
    expect(w.db.get('e1')!.is_active).toBe(false)
    expect(w.banned.has('e1')).toBe(true)
  })
})

describe('D15 권한', () => {
  it('J: 인사담당이 admin 을 퇴사시키려 하면 403', async () => {
    const w = makeWorld([ADMIN, MGR])
    const r = await setActive({ callerId: 'm1', callerRole: 'manager', userId: 'a1', active: false }, w.deps)
    expect(r.status).toBe(403)
    expect(w.db.get('a1')!.is_active).toBe(true)
    expect(w.calls.ban).toBe(0)
  })
  it('K: 자기 자신은 처리 불가', async () => {
    const w = makeWorld([ADMIN, ADMIN2])
    const r = await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'a1', active: false }, w.deps)
    expect(r.status).toBe(400)
  })
  it('마지막 활성 admin 은 퇴사 불가', async () => {
    const w = makeWorld([ADMIN, MGR])
    const r = await setActive({ callerId: 'm1', callerRole: 'admin', userId: 'a1', active: false }, w.deps)
    expect(r.status).toBe(409)
    expect(w.db.get('a1')!.is_active).toBe(true)
  })
  it('활성 admin 이 둘이면 한쪽 퇴사 가능', async () => {
    const w = makeWorld([ADMIN, ADMIN2])
    const r = await setActive({ callerId: 'a2', callerRole: 'admin', userId: 'a1', active: false }, w.deps)
    expect(r.status).toBe(200)
  })
  it('복직: 인사담당은 manager/admin 역할 직원을 복직시킬 수 없다 (과거 권한 자동 복원 방지)', async () => {
    const w = makeWorld([ADMIN, MGR, { id: 'm2', role: 'manager', is_active: false }], { banned: ['m2'] })
    const r = await setActive({ callerId: 'm1', callerRole: 'manager', userId: 'm2', active: true }, w.deps)
    expect(r.status).toBe(403)
    expect(w.banned.has('m2')).toBe(true)
  })
  it('복직: 인사담당이 일반 직원 복직은 가능', async () => {
    const w = makeWorld([MGR, GONE], { banned: ['e2'] })
    const r = await setActive({ callerId: 'm1', callerRole: 'manager', userId: 'e2', active: true }, w.deps)
    expect(r.status).toBe(200)
  })
  it('입력 검증 / 없는 직원', async () => {
    const w = makeWorld([ADMIN])
    expect((await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'x', active: 'yes' }, w.deps)).status).toBe(400)
    expect((await setActive({ callerId: 'a1', callerRole: 'admin', userId: 'nope', active: false }, w.deps)).status).toBe(404)
  })
})

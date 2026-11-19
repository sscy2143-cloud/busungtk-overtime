/**
 * 기존 화면에 끼워 넣은 출장 안내(T10 안 A+B, 직원 신청 화면 안내) — 스위치·권한·충돌 경고를 고정한다.
 * 기존 야근 승인·신청 화면의 동작은 바꾸지 않는다(OFF 면 아무것도 그리지 않음).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

const flags = vi.hoisted(() => ({ on: false }))
vi.mock('../../../features/trip/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../features/trip/ui')>()
  return { ...mod, TRIP_FEATURE: { get employeeForm() { return flags.on }, get adminReview() { return flags.on } } }
})
const from = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ employee: { id: 'emp-1', name: '김직원', role: 'employee' } as { id: string; name: string; role: string } | null }))
vi.mock('../../../lib/supabase', () => ({ isDemoMode: false, supabase: { auth: { getSession: vi.fn() }, from } }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('react-router-dom', () => ({ Link: ({ to, children, ...r }: { to: string; children: ReactNode }) => <a href={to} {...r}>{children}</a>, useNavigate: () => () => {} }))

import { TripContext, type TripScreenContext } from '../../../features/trip/screens/context'
import { TripPendingNotice, PendingList } from '../TripPendingNotice'
import { TripRequestHint, HintBody } from '../TripRequestHint'
import { tripClaimsOnDate, scheduleCovers } from '../trip-glue'

const claim = (over: Record<string, unknown>) => ({
  id: 'c1', employeeId: 'emp-1', groupId: 'g', initiatorId: 'emp-1', origin: 'self', status: 'submitted', version: 1,
  createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z', submittedAt: '2026-11-10T01:00:00Z',
  header: { regions: ['busan'], schedule: { kind: 'day', date: '2026-11-10' } }, ...over,
})
const ctx = (service: Record<string, unknown>, actorRole: 'admin' | 'employee' = 'admin'): TripScreenContext => ({
  service: service as never, actor: { id: actorRole === 'admin' ? 'boss' : 'emp-1', role: actorRole },
  employees: [{ id: 'emp-1', name: '김직원' }, { id: 'emp-2', name: '박직원' }, { id: 'boss', name: '대표' }],
  calendar: { verified: false } as never, today: '2026-11-12', revision: 0, bump: () => {},
})
const wrap = (value: TripScreenContext, node: ReactNode) => renderToStaticMarkup(<TripContext.Provider value={value}>{node}</TripContext.Provider>)

describe('출장 대기 알림 (승인함)', () => {
  it('코드 스위치 OFF 면 아무것도 그리지 않고 서버를 부르지 않는다', () => {
    flags.on = false; auth.employee = { id: 'boss', name: '대표', role: 'admin' }
    expect(renderToStaticMarkup(<TripPendingNotice />)).toBe('')
    expect(from).not.toHaveBeenCalled()
  })
  it('스위치 ON 이어도 대표(admin)가 아니면 그리지 않는다 (manager·직원)', () => {
    flags.on = true
    for (const role of ['manager', 'employee']) {
      auth.employee = { id: 'x', name: 'x', role }
      expect(renderToStaticMarkup(<TripPendingNotice />)).toBe('')
    }
    expect(from).not.toHaveBeenCalled()
  })
  it('admin + ON 이면 연결 단계로 들어가지만 불러오는 동안·실패 시에는 아무 문구도 그리지 않는다 (quiet)', () => {
    flags.on = true; auth.employee = { id: 'boss', name: '대표', role: 'admin' }
    const html = renderToStaticMarkup(<TripPendingNotice />)
    expect(html).not.toContain('불러오는 중')
    expect(html).toBe('')
  })
  it('대기 건이 있으면 건수·신청자·날짜와 검토 화면 링크를 보여 주고, 승인 버튼은 없다', () => {
    const rows = [claim({ id: 'b', employeeId: 'emp-2', submittedAt: '2026-11-11T00:00:00Z', header: { regions: [], schedule: { kind: 'stay', startDate: '2026-11-03', endDate: '2026-11-05' } } }), claim({ id: 'a' })]
    const html = wrap(ctx({ reviewQueue: () => ({ ok: true, value: rows }) }), <PendingList />)
    expect(html).toContain('2</span>')
    expect(html).toContain('건의 출장 신청이 검토 대기 중')
    expect(html.indexOf('김직원')).toBeLessThan(html.indexOf('박직원')) // 제출 순
    expect(html).toContain('2026-11-03 ~ 2026-11-05')
    expect(html).toContain('href="/admin/trip"')
    expect(html).not.toMatch(/승인하기|반려하기|<button/)
  })
  it('대기 0건·서버가 거부(스위치 OFF 등)하면 아무것도 그리지 않는다', () => {
    expect(wrap(ctx({ reviewQueue: () => ({ ok: true, value: [] }) }), <PendingList />)).toBe('')
    expect(wrap(ctx({ reviewQueue: () => ({ ok: false, code: 'FEATURE_DISABLED', message: '' }) }), <PendingList />)).toBe('')
  })
  it('6건 이상이면 5건만 나열하고 나머지는 건수로 표시한다', () => {
    const rows = Array.from({ length: 7 }, (_, i) => claim({ id: `c${i}`, submittedAt: `2026-11-1${i}T00:00:00Z` }))
    const html = wrap(ctx({ reviewQueue: () => ({ ok: true, value: rows }) }), <PendingList />)
    expect(html).toContain('외 2건')
  })
})

describe('출장 안내 (직원 야근 신청 화면)', () => {
  it('OFF 면 아무것도 그리지 않는다', () => {
    flags.on = false; auth.employee = { id: 'emp-1', name: '김직원', role: 'employee' }
    expect(renderToStaticMarkup(<TripRequestHint date="2026-11-10" />)).toBe('')
  })
  it('같은 날 유효한 출장 신청이 있으면 중복 인정 경고를, 없으면 링크만 보여 준다', () => {
    const svc = (claims: unknown[]) => ({ myClaims: () => ({ ok: true, value: claims }) })
    const warn = wrap(ctx(svc([claim({})]), 'employee'), <HintBody date="2026-11-10" />)
    expect(warn).toContain('이미 출장 신청이 있습니다')
    expect(warn).toContain('role="alert"')
    const none = wrap(ctx(svc([claim({})]), 'employee'), <HintBody date="2026-11-11" />)
    expect(none).not.toContain('이미 출장 신청')
    expect(none).toContain('출장으로 신청하기')
  })
  it('날짜 판정: 숙박 출장의 첫날·마지막날 포함, 취소·반려 건은 제외, 다른 날은 제외', () => {
    const stay = claim({ id: 's', header: { regions: [], schedule: { kind: 'stay', startDate: '2026-11-03', endDate: '2026-11-05' } } }) as never
    expect(scheduleCovers((stay as { header: { schedule: never } }).header.schedule, '2026-11-03')).toBe(true)
    expect(scheduleCovers((stay as { header: { schedule: never } }).header.schedule, '2026-11-05')).toBe(true)
    expect(scheduleCovers((stay as { header: { schedule: never } }).header.schedule, '2026-11-06')).toBe(false)
    const cs = [claim({ id: '1', status: 'cancelled' }), claim({ id: '2', status: 'rejected' }), claim({ id: '3', status: 'draft' }), claim({ id: '4', status: 'approved' })] as never[]
    expect(tripClaimsOnDate(cs, '2026-11-10').map((c: { id: string }) => c.id)).toEqual(['3', '4'])
    expect(tripClaimsOnDate(cs, '')).toEqual([])
  })
})

/**
 * 글루 페이지 — 코드 스위치가 꺼진 상태(TRIP_FEATURE 전부 false 로 가짜 주입). 운영 기본값은 2026-11-25 부터 켜짐.
 * 기존 앱 컨텍스트·DB 클라이언트는 가짜로 바꾸고, react-dom/server 로 그려 서버 호출이 전혀 없는지 본다.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { getSession, from, auth } = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: 'token' } } })),
  from: vi.fn(),
  auth: { employee: { id: 'emp-1', name: '김직원', role: 'employee' as 'employee' | 'manager' | 'admin' } },
}))
vi.mock('../../../features/trip/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../features/trip/ui')>()
  return { ...mod, TRIP_FEATURE: Object.freeze({ employeeForm: false, adminReview: false }) }
})
vi.mock('../../../lib/supabase', () => ({ isDemoMode: false, supabase: { auth: { getSession }, from } }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

import { TripEmployeePage } from '../TripEmployeePage'
import { AdminTripPage } from '../AdminTripPage'
import { TRIP_ROUTES, todayIso, tripActorOf, tripScreenOpen } from '../trip-glue'

describe('코드 스위치 OFF', () => {
  it('스위치 상수는 전부 꺼져 있다', () => {
    expect(tripScreenOpen('employeeForm')).toBe(false)
    expect(tripScreenOpen('adminReview')).toBe(false)
  })

  it('/trip 은 안내만 보여 주고 세션·DB 를 건드리지 않는다', () => {
    const html = renderToStaticMarkup(<TripEmployeePage />)
    expect(html).toContain('아직 열리지 않았습니다')
    expect(html).not.toContain('근무 신청')
    expect(getSession).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('/admin/trip 도 역할과 무관하게 안내만', () => {
    auth.employee.role = 'admin'
    const html = renderToStaticMarkup(<AdminTripPage />)
    expect(html).toContain('아직 열리지 않았습니다')
    expect(html).not.toContain('출장 검토 기능')
    expect(from).not.toHaveBeenCalled()
  })
})

describe('글루 도우미', () => {
  it('역할 매핑: admin 만 관리자, manager 는 직원', () => {
    expect(tripActorOf({ id: 'a', role: 'admin' })).toEqual({ id: 'a', role: 'admin' })
    expect(tripActorOf({ id: 'm', role: 'manager' })).toEqual({ id: 'm', role: 'employee' })
    expect(tripActorOf({ id: 'e', role: 'employee' })).toEqual({ id: 'e', role: 'employee' })
  })
  it('오늘 날짜는 로컬 기준 YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 10, 9, 23, 30))).toBe('2026-11-09')
    expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })
  it('라우트 상수', () => {
    expect(TRIP_ROUTES).toEqual({ employee: '/request?type=trip', admin: '/admin/trip' })
  })
})

describe('조회 권한자 화면 (코드 스위치 OFF)', () => {
  it('/trip/all 도 안내만, 서버 호출 없음', async () => {
    const { TripViewerPage } = await import('../TripViewerPage')
    const html = renderToStaticMarkup(<TripViewerPage />)
    expect(html).toContain('아직 열리지 않았습니다')
    expect(from).not.toHaveBeenCalled()
  })
})

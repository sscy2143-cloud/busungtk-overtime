/**
 * 글루 페이지 — 코드 스위치를 켠 경우(모듈 가짜). 서버 스위치는 여전히 꺼져 있을 수 있으므로
 * 여기서 보는 것은 "누가 어느 화면까지 들어가는가" 와 "정적 렌더 단계에서 서버를 부르지 않는가" 뿐이다.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../../features/trip/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../features/trip/ui')>()
  return { ...mod, TRIP_FEATURE: Object.freeze({ employeeForm: true, adminReview: true }) }
})
const { getSession, from, auth } = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: 'token' } } })),
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) })),
  auth: { employee: { id: 'emp-1', name: '김직원', role: 'employee' } as { id: string; name: string; role: 'employee' | 'manager' | 'admin' } | null },
}))
vi.mock('../../../lib/supabase', () => ({ isDemoMode: false, supabase: { auth: { getSession }, from } }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

import { TripEmployeePage } from '../TripEmployeePage'
import { AdminTripPage } from '../AdminTripPage'

describe('코드 스위치 ON — 접근 분리', () => {
  it('직원: /trip 은 연결 단계(직원 목록 불러오는 중)로 들어간다. 정적 렌더에서는 효과가 돌지 않아 서버 호출 0', () => {
    const html = renderToStaticMarkup(<TripEmployeePage />)
    expect(html).toContain('불러오는 중')
    expect(getSession).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('manager 는 /admin/trip 에서 대표 전용 안내만 본다 (서버도 FORBIDDEN 으로 거부)', () => {
    auth.employee = { id: 'mgr', name: '인사', role: 'manager' }
    const html = renderToStaticMarkup(<AdminTripPage />)
    expect(html).toContain('대표(admin) 계정만')
    expect(from).not.toHaveBeenCalled()
  })

  it('admin 은 /admin/trip 연결 단계로 들어간다', () => {
    auth.employee = { id: 'boss', name: '대표', role: 'admin' }
    const html = renderToStaticMarkup(<AdminTripPage />)
    expect(html).toContain('불러오는 중')
    expect(html).not.toContain('대표(admin) 계정만')
  })

  it('세션 직원 정보가 없으면 아무것도 그리지 않는다', () => {
    auth.employee = null
    expect(renderToStaticMarkup(<TripEmployeePage />)).toBe('')
  })
})

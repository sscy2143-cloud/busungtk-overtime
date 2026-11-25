/**
 * 연장근무 신청 화면의 근무 장소 선택(사무실·외부 현장·출장) — 2026-11-25.
 * 사무실·외부 현장은 기존 야근 양식 그대로, 출장만 출장수당 양식. 코드 스위치 OFF 면 예전 화면과 같다.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

const flags = vi.hoisted(() => ({ on: true, type: null as string | null }))
vi.mock('../../../features/trip/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../features/trip/ui')>()
  return { ...mod, TRIP_FEATURE: { get employeeForm() { return flags.on }, get adminReview() { return flags.on } } }
})
const from = vi.hoisted(() => vi.fn(() => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) })))
vi.mock('../../../lib/supabase', () => ({ isDemoMode: false, supabase: { auth: { getSession: vi.fn() }, from, rpc: vi.fn() } }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ employee: { id: 'emp-1', name: '김직원', role: 'employee' } }) }))
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => () => {},
  useSearchParams: () => [new URLSearchParams(flags.type ? { type: flags.type } : {}), () => {}],
}))

import { RequestPage } from '../../RequestPage'
import { parseWorkKind } from '../trip-glue'

const page = (type: string | null, on = true) => { flags.on = on; flags.type = type; return renderToStaticMarkup(<RequestPage />) }

describe('연장근무 신청 — 근무 장소 선택', () => {
  it('스위치 OFF: 선택 없이 예전 야근 화면 그대로', () => {
    const html = page(null, false)
    expect(html).toContain('야근 제출')
    expect(html).not.toContain('어디서 일했나요')
  })

  it('기본은 사무실: 세 가지 선택이 보이고 아래는 기존 야근 양식', () => {
    const html = page(null)
    expect(html).toContain('어디서 일했나요')
    for (const label of ['사무실', '외부 현장', '출장']) expect(html).toContain(`${label}</button>`)
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('근무 날짜')
    expect(html).not.toContain('야근 제출') // 제목은 '연장근무 신청' 하나
  })

  it('외부 현장: 출장수당 대상이 아니라는 안내 + 기존 야근 양식', () => {
    const html = page('field')
    expect(html).toContain('출장수당 대상이 아닙니다')
    expect(html).toContain('근무 날짜')
  })

  it('출장: 야근 양식 대신 출장수당 화면(연결 단계)으로 바뀐다', () => {
    const html = page('trip')
    expect(html).toContain('출장수당 대상 출장입니다')
    expect(html).not.toContain('근무 날짜')
    expect(html).toContain('불러오는 중')
  })

  it('알 수 없는 값은 사무실로', () => {
    expect(parseWorkKind('xyz')).toBe('office')
    expect(parseWorkKind(null)).toBe('office')
    expect(parseWorkKind('trip')).toBe('trip')
  })
})

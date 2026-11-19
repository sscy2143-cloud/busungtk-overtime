/**
 * 회귀: 같은 저장소를 쓰는 제공자가 다시 올라와도(샌드박스에서 사용자를 바꾸면 key 가 바뀌어 새로 올라온다) 신청 ID 가 겹치지 않는다.
 * 예전에는 순번이 0부터 다시 시작해 두 번째 신청 저장이 DUPLICATE_ID("claim-1")로 막혔다.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRepository } from '../../data'
import { siteEntry, dayHeader, alice } from '../../data/__tests__/fixtures'
import { TripScreenProvider } from '../TripScreenProvider'
import { useTrip, type TripScreenContext } from '../context'

const EMPLOYEES = [{ id: alice.id, name: '김직원', role: 'employee' as const }, { id: 'admin-boss', name: '대표', role: 'admin' as const }]
const flags = { employeeForm: true, adminReview: true }

function mount(repo: ReturnType<typeof createMemoryRepository>): TripScreenContext {
  // 렌더 중에 바깥 변수를 바꾸지 않고, 컨텍스트 값을 담는 상자에 넣어 꺼낸다
  const ctxRef: { current: TripScreenContext | null } = { current: null }
  // 정적 렌더 한 번으로 제공자가 만든 서비스를 꺼내기 위한 시험용 탐침 — 렌더 중 대입이 이 시험의 목적이다
  // eslint-disable-next-line react-hooks/immutability
  const Probe = () => { const c = useTrip(); ctxRef.current = c; return null }
  renderToStaticMarkup(<TripScreenProvider actor={alice} employees={EMPLOYEES} today="2026-11-19" repo={repo} flags={flags}><Probe /></TripScreenProvider>)
  return ctxRef.current as TripScreenContext
}

describe('메모리 제공자의 신청 ID', () => {
  it('같은 저장소 위에 제공자를 다시 올려도 두 번째 신청이 저장되고 ID 가 다르다', async () => {
    const repo = createMemoryRepository()
    const first = mount(repo)
    const a = await first.service.createClaim(alice, { header: dayHeader(['서울'], '2026-11-18'), entries: [siteEntry('2026-11-18', '09:00', '18:00')] })
    expect(a.ok).toBe(true)
    const second = mount(repo) // 사용자 전환으로 제공자가 새로 올라온 상황
    const b = await second.service.createClaim(alice, { header: dayHeader(['서울'], '2026-11-17'), entries: [siteEntry('2026-11-17', '09:00', '18:00')] })
    expect(b.ok, JSON.stringify(b)).toBe(true)
    if (a.ok && b.ok) expect(b.value.id).not.toBe(a.value.id)
  })

  it('저장소가 새로 만들어지면 순번은 항상 1부터다 (결정적)', async () => {
    const r1 = await mount(createMemoryRepository()).service.createClaim(alice, { header: dayHeader(['서울'], '2026-11-18'), entries: [siteEntry('2026-11-18', '09:00', '18:00')] })
    const r2 = await mount(createMemoryRepository()).service.createClaim(alice, { header: dayHeader(['서울'], '2026-11-18'), entries: [siteEntry('2026-11-18', '09:00', '18:00')] })
    expect(r1.ok && r2.ok && r1.value.id === r2.value.id).toBe(true)
  })
})

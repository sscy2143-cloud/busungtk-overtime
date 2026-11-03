import { describe, expect, it } from 'vitest'
import { FINAL_CASES } from './final-cases.fixture'
import { hoursOf, run } from './helpers'

describe('최종본 9절 검증 사례 19건', () => {
  it('사례가 19건이다', () => {
    expect(FINAL_CASES).toHaveLength(19)
  })

  it.each(FINAL_CASES)('$no번 $title', ({ input, expected }) => {
    const r = run(input)
    expect(hoursOf(r)).toEqual(expected)
    // 최종본 규정만으로 계산되는 사례이므로 제안값이 아니어야 한다
    expect(r.status).toBe('confirmed')
    expect(r.flags.filter((f) => f.kind === 'undecided_rule')).toEqual([])
  })
})

describe('팀장님 기준 사례 (사용자 확정)', () => {
  it('대전(편도 2시간), 현장 08~17, 점심 1시간 → 출장 4시간', () => {
    const r = run(FINAL_CASES[0].input)
    expect(r.trip.hours).toBe(4)
    expect(r.overtime.hours).toBe(0)
    expect(r.status).toBe('confirmed')
    // 조기 시작(9 − 8 = 1)과 조기 종료(17 − 18 = −1)가 상계되어 현장조정 0
    expect(r.trace.adjustmentHours).toBe(0)
    expect(r.trace.travel).toEqual([{ start: 6, end: 8 }, { start: 17, end: 19 }])
  })
})

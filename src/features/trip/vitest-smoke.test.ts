import { describe, expect, it } from 'vitest'

// T0: 테스트 실행 환경 확인용. T1에서 계산 엔진 테스트가 생기면 삭제한다.
describe('vitest 실행 환경', () => {
  it('테스트가 실행된다', () => {
    expect(1 + 1).toBe(2)
  })

  it('DB 접속 정보 없이 실행된다', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'

// 엔진 소스(테스트 제외)를 문자열로 읽어 외부 의존이 없는지 확인한다
const sources = import.meta.glob<string>('../*.ts', { query: '?raw', import: 'default', eager: true })

describe('계산 엔진은 순수 함수다', () => {
  it('엔진 파일을 찾았다', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(6)
  })

  it.each(Object.entries(sources))('%s: DB·화면·기존 계산 코드·시각·난수에 의존하지 않는다', (_file, src) => {
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const spec of imports) expect(spec).toMatch(/^\.\/[a-z-]+$/)
    for (const banned of ['supabase', 'react', 'fetch(', 'localStorage', 'Date.now', 'new Date', 'Math.random', 'overtime-calc']) {
      expect(src).not.toContain(banned)
    }
  })
})

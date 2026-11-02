import { describe, expect, it } from 'vitest'

// 출장 기능 소스(테스트 제외)를 문자열로 읽어 기존 앱 코드·DB·브라우저 저장소·현재 시각에 기대지 않는지 확인한다
const sources = import.meta.glob<string>(['../data/*.ts', '../ui/*.ts'], { query: '?raw', import: 'default', eager: true })

describe('출장 데이터·화면 모듈은 독립 모듈이다 (기존 근태 기능에 영향 없음)', () => {
  it('검사할 파일을 찾았다', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(12)
  })

  it.each(Object.entries(sources))('%s', (_file, src) => {
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    // 같은 폴더, 또는 출장 기능의 engine·data 만 참조
    for (const spec of imports) expect(spec).toMatch(/^(\.\/[a-z-]+|\.\.\/(engine|data))$/)
    for (const banned of ['supabase', 'react', 'fetch(', 'localStorage', 'sessionStorage', 'Date.now', 'Math.random', 'import.meta.env']) {
      expect(src).not.toContain(banned)
    }
  })
})

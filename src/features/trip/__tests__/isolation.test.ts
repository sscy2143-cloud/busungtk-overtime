import { describe, expect, it } from 'vitest'

// 출장 기능 소스(테스트 제외)를 문자열로 읽어 기존 앱 코드·DB·브라우저 저장소·현재 시각에 기대지 않는지 확인한다
const pure = import.meta.glob<string>(['../data/*.ts', '../ui/*.ts'], { query: '?raw', import: 'default', eager: true })
const screens = import.meta.glob<string>(['../screens/*.ts', '../screens/*.tsx', '../screens/admin/*.tsx'], { query: '?raw', import: 'default', eager: true })

const importsOf = (src: string) => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('출장 데이터·화면 모델은 독립 모듈이다 (기존 근태 기능에 영향 없음)', () => {
  it('검사할 파일을 찾았다', () => {
    expect(Object.keys(pure).length).toBeGreaterThanOrEqual(15)
  })

  it.each(Object.entries(pure))('%s', (_file, src) => {
    // 같은 폴더, 또는 출장 기능의 engine·data 만 참조
    for (const spec of importsOf(src)) expect(spec).toMatch(/^(\.\/[a-z-]+|\.\.\/(engine|data))$/)
    for (const banned of ['supabase', 'react', 'fetch(', 'localStorage', 'sessionStorage', 'Date.now', 'Math.random', 'import.meta.env']) {
      expect(src).not.toContain(banned)
    }
  })
})

describe('출장 화면은 기존 앱의 컨텍스트·supabase·라우터를 쓰지 않는다', () => {
  it('검사할 화면 파일을 찾았다', () => {
    expect(Object.keys(screens).length).toBeGreaterThanOrEqual(10)
  })

  it.each(Object.entries(screens))('%s', (_file, src) => {
    for (const spec of importsOf(src)) {
      // 출장 기능 안 + react + 아이콘만. 기존 앱 모듈(contexts, lib, pages, components)은 금지
      expect(spec).toMatch(/^(\.\/(admin\/)?[A-Za-z-]+|\.\.\/[A-Za-z-]+|\.\.\/(engine|data|ui)|\.\.\/\.\.\/(engine|data|ui)|react|lucide-react)$/)
    }
    for (const banned of ['supabase', 'react-router', 'contexts/', 'lib/', 'fetch(', 'localStorage', 'sessionStorage', 'Date.now', 'new Date(', 'Math.random', 'import.meta.env', 'window.', 'document.']) {
      expect(src).not.toContain(banned)
    }
  })
})

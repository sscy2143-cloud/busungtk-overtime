import { describe, expect, it } from 'vitest'

// 출장 기능 소스(테스트 제외)를 문자열로 읽어 기존 앱 코드·DB·브라우저 저장소·현재 시각에 기대지 않는지 확인한다
const pure = import.meta.glob<string>(['../data/*.ts', '../ui/*.ts', '../server/*.ts'], { query: '?raw', import: 'default', eager: true })
// T6 연결 계층: DB SDK·브라우저 저장소·현재 시각에 기대지 않는다. 네트워크는 fetch-backend.ts 한 곳에서만
const client = import.meta.glob<string>(['../client/*.ts'], { query: '?raw', import: 'default', eager: true })
// T9 시범 운영 비교(pilot/): 순수 함수 — 같은 폴더만 참조하고 DB·화면·네트워크·저장소·현재 시각에 기대지 않는다
const pilot = import.meta.glob<string>(['../pilot/*.ts'], { query: '?raw', import: 'default', eager: true })
const screens = import.meta.glob<string>(['../screens/*.ts', '../screens/*.tsx', '../screens/admin/*.tsx'], { query: '?raw', import: 'default', eager: true })

// 서버 함수(api/trip-compute.ts)가 쓰는 폴더: Node ESM 은 상대 import 에 확장자를 요구한다.
// 빠지면 배포 후 ERR_MODULE_NOT_FOUND 로 함수가 죽는다 (11-04 admin-user 사고와 같은 종류)
const serverClosure = import.meta.glob<string>(['../engine/*.ts', '../data/*.ts', '../server/*.ts'], { query: '?raw', import: 'default', eager: true })

const importsOf = (src: string) => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('출장 데이터·화면 모델은 독립 모듈이다 (기존 근태 기능에 영향 없음)', () => {
  it('검사할 파일을 찾았다', () => {
    expect(Object.keys(pure).length).toBeGreaterThanOrEqual(15)
  })

  it.each(Object.entries(pure))('%s', (_file, src) => {
    // 같은 폴더, 또는 출장 기능의 engine·data 만 참조
    // 서버 함수가 쓰는 폴더는 Node ESM 규칙으로 `.js` 확장자를 붙이므로 허용한다 (아래 serverClosure 검사가 강제)
    for (const spec of importsOf(src)) expect(spec).toMatch(/^(\.\/[a-z-]+|\.\.\/(engine|data|pilot))(\/index)?(\.js)?$/)
    for (const banned of ['supabase', 'react', 'fetch(', 'localStorage', 'sessionStorage', 'Date.now', 'Math.random', 'import.meta.env']) {
      expect(src).not.toContain(banned)
    }
  })
})

describe('출장 연결 계층(client/)은 supabase-js·react·브라우저 저장소를 쓰지 않는다', () => {
  it('검사할 파일을 찾았다', () => {
    expect(Object.keys(client).length).toBeGreaterThanOrEqual(6)
  })

  it.each(Object.entries(client))('%s', (file, src) => {
    for (const spec of importsOf(src)) expect(spec).toMatch(/^(\.\/[a-z-]+|\.\.\/(engine|data|server))$/)
    for (const banned of ['supabase-js', 'react', 'localStorage', 'sessionStorage', 'Date.now', 'Math.random', 'import.meta.env', 'SERVICE_ROLE', 'service_role_key']) {
      expect(src).not.toContain(banned)
    }
    if (!file.endsWith('fetch-backend.ts')) expect(src).not.toContain('fetch(')
  })
})

describe('출장 화면은 기존 앱의 컨텍스트·supabase·라우터를 쓰지 않는다', () => {
  it('검사할 화면 파일을 찾았다', () => {
    expect(Object.keys(screens).length).toBeGreaterThanOrEqual(10)
  })

  it.each(Object.entries(screens))('%s', (_file, src) => {
    for (const spec of importsOf(src)) {
      // 출장 기능 안 + react + 아이콘만. 기존 앱 모듈(contexts, lib, pages, components)은 금지
      expect(spec).toMatch(/^(\.\/(admin\/)?[A-Za-z-]+|\.\.\/[A-Za-z-]+|\.\.\/(engine|data|ui|client)|\.\.\/\.\.\/(engine|data|ui|client|pilot)|react|lucide-react)$/)
    }
    for (const banned of ['supabase', 'react-router', 'contexts/', 'lib/', 'fetch(', 'localStorage', 'sessionStorage', 'Date.now', 'new Date(', 'Math.random', 'import.meta.env', 'window.', 'document.']) {
      expect(src).not.toContain(banned)
    }
  })
})

describe('시범 운영 비교(pilot/)는 순수 함수다 (급여·DB·화면·네트워크와 무관)', () => {
  it('검사할 파일을 찾았다', () => {
    expect(Object.keys(pilot).length).toBeGreaterThanOrEqual(3)
  })

  it.each(Object.entries(pilot))('%s', (_file, src) => {
    for (const spec of importsOf(src)) expect(spec).toMatch(/^\.\/[a-z-]+$/)
    for (const banned of ['supabase', 'react', 'fetch(', 'localStorage', 'sessionStorage', 'Date.now', 'Math.random', 'import.meta.env', 'PAYROLL', 'payroll_', 'hourly_wage']) {
      expect(src).not.toContain(banned)
    }
  })
})

describe('서버 함수가 쓰는 폴더(engine·data·server)의 상대 import 는 모두 Node ESM 확장자(.js)로 끝난다', () => {
  it('검사할 파일을 찾았다', () => {
    expect(Object.keys(serverClosure).length).toBeGreaterThanOrEqual(15)
  })

  it.each(Object.entries(serverClosure))('%s', (_file, src) => {
    const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)].map((m) => m[1])
    for (const spec of specs) expect(spec, spec).toMatch(/\.js$/)
  })
})

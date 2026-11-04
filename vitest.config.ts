import { defineConfig } from 'vitest/config'

// 출장수당 계산 엔진·데이터 계층·화면 테스트용. 앱 빌드(vite.config.ts)와 분리해 PWA 플러그인을 거치지 않는다.
// 화면(.tsx)은 DOM 없이 react-dom/server 로 그려서 확인한다 (추가 의존성 없음).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // PGlite(WASM) 데이터베이스를 테스트마다 띄우는 시험이 있어 병렬 실행 부하에서 기본 5초를 넘길 수 있다
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})

import { defineConfig } from 'vitest/config'

// 출장수당 계산 엔진 등 순수 함수 테스트용. 앱 빌드(vite.config.ts)와 분리해 PWA 플러그인을 거치지 않는다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

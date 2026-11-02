import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 출장수당 화면 샌드박스 전용. 앱 빌드(vite.config.ts)와 분리 — PWA·API 플러그인 없음, 환경변수 없음.
// 실행: npx vite --config src/features/trip/sandbox/vite.config.ts   (프로젝트 루트에서)
export default defineConfig({
  root: 'src/features/trip/sandbox',
  envDir: false,
  plugins: [react(), tailwindcss()],
  server: { port: 5199, open: false },
})

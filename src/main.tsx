import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from './contexts/AuthContext'
import App from './App'
import './index.css'

// 배포 후 예전 버전이 계속 캐시되는 문제 방지: 새 서비스워커가 감지되면 자동으로
// 새로고침해서 항상 최신 버전을 쓰도록 함 (내부 관리 도구라 별도 확인 프롬프트 없이 즉시 반영)
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    registration.update()
    setInterval(() => registration.update(), 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update()
    })
  },
  onNeedRefresh() {
    updateSW(true)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './contexts/AuthContext'
import App from './App'
import './index.css'

// 앱 렌더링을 최우선으로 처리 — 서비스워커 등록에서 어떤 문제가 생기더라도
// 화면 자체는 항상 뜨도록 아래 PWA 로직보다 먼저, 그리고 독립적으로 실행함
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)

// 배포 후 예전 버전이 계속 캐시되는 문제 방지: 새 서비스워커가 감지되면 자동으로
// 새로고침해서 항상 최신 버전을 쓰도록 함 (내부 관리 도구라 별도 확인 프롬프트 없이 즉시 반영)
// 이 블록에서 어떤 오류가 나도 위 앱 렌더링에는 영향이 없도록 완전히 분리·방어적으로 처리
;(async () => {
  try {
    const { registerSW } = await import('virtual:pwa-register')
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!registration) return
        registration.update().catch(() => {})
        setInterval(() => registration.update().catch(() => {}), 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {})
        })
      },
      onNeedRefresh() {
        updateSW(true)
      },
      onRegisterError() {
        // 서비스워커 등록 실패는 무시 — 앱 자체 동작에는 지장 없음
      },
    })
  } catch {
    // PWA 등록 실패해도 앱은 정상 동작해야 하므로 조용히 무시
  }
})()

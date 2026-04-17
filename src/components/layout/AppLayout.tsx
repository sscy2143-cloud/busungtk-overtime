import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { OnboardingTour } from '../common/OnboardingTour'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* PC: 좌측 사이드바 */}
      <Sidebar />

      {/* 모바일: 상단 헤더 */}
      <Header />

      {/* 메인 콘텐츠 */}
      <main className="md:ml-64 pt-14 md:pt-0 pb-16 md:pb-0">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>

      {/* 모바일: 하단 탭바 */}
      <BottomNav />

      {/* 온보딩 투어 (전체 페이지 걸쳐 동작) */}
      <OnboardingTour />
    </div>
  )
}

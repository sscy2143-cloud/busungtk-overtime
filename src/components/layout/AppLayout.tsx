import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { OnboardingTour } from '../common/OnboardingTour'

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed'

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* PC: 좌측 사이드바 */}
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />

      {/* 모바일: 상단 헤더 */}
      <Header />

      {/* 메인 콘텐츠 */}
      <main className={`pt-14 md:pt-0 pb-16 md:pb-0 transition-[margin] duration-200 ${collapsed ? 'md:ml-0' : 'md:ml-64'}`}>
        <div className="max-w-7xl mx-auto px-2 py-6">
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

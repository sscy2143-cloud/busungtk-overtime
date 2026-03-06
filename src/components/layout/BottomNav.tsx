import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Home, FileText, MoreHorizontal, Shield, Calendar, Bell, Settings, X, DollarSign, Receipt } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export function BottomNav() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const isAdmin = employee?.role === 'manager' || employee?.role === 'admin'

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-xs transition-colors ${
      isActive ? 'text-primary-600' : 'text-gray-400 hover:text-gray-600'
    }`

  return (
    <>
      {/* 드롭업 오버레이 */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* 드롭업 메뉴 */}
      {moreOpen && (
        <div className="md:hidden fixed bottom-16 right-4 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden w-48">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-700">더보기</span>
            <button onClick={() => setMoreOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <button
            className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => { navigate('/leave'); setMoreOpen(false) }}
          >
            <Calendar size={18} className="text-primary-500" />
            휴가 관리
          </button>
          <button
            className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => { navigate('/notifications'); setMoreOpen(false) }}
          >
            <Bell size={18} className="text-primary-500" />
            알림
          </button>
          <button
            className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => { navigate('/expenses'); setMoreOpen(false) }}
          >
            <Receipt size={18} className="text-primary-500" />
            경비 제출
          </button>
          {isAdmin && (
            <>
              <button
                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => { navigate('/admin/expenses'); setMoreOpen(false) }}
              >
                <Receipt size={18} className="text-primary-500" />
                경비 관리
              </button>
              <button
                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => { navigate('/admin/payroll'); setMoreOpen(false) }}
              >
                <DollarSign size={18} className="text-primary-500" />
                급여 계산
              </button>
            </>
          )}
          <button
            className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => { setMoreOpen(false) }}
          >
            <Settings size={18} className="text-primary-500" />
            설정
          </button>
        </div>
      )}

      {/* 하단 탭바 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex">
        <NavLink to="/" end className={navItemClass}>
          <Home size={20} />
          <span>홈</span>
        </NavLink>

        <NavLink to="/requests" className={navItemClass}>
          <FileText size={20} />
          <span>제출</span>
        </NavLink>

        {isAdmin && (
          <NavLink to="/admin" className={navItemClass}>
            <Shield size={20} />
            <span>관리</span>
          </NavLink>
        )}

        <button
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-xs text-gray-400 hover:text-gray-600"
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal size={20} />
          <span>더보기</span>
        </button>
      </nav>
    </>
  )
}

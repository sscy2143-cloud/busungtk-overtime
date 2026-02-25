import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FilePlus,
  FileText,
  Clock,
  Calendar,
  Shield,
  CheckSquare,
  CalendarCheck,
  LogOut,
  Users,
  DollarSign,
  Receipt,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

export function Sidebar() {
  const { employee, signOut } = useAuth()
  const isAdmin = employee?.role === 'manager' || employee?.role === 'admin'
  const isSuperAdmin = employee?.role === 'admin'

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary-50 text-primary-700'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`

  const mainNav: NavItem[] = [
    { to: '/', label: '대시보드', icon: <LayoutDashboard size={18} /> },
    { to: '/request', label: '야근 제출', icon: <FilePlus size={18} /> },
    { to: '/requests', label: '내 제출 목록', icon: <FileText size={18} /> },
    { to: '/timesheet', label: '근무 기록', icon: <Clock size={18} /> },
    { to: '/leave', label: '휴가 관리', icon: <Calendar size={18} /> },
    { to: '/expenses', label: '경비 제출', icon: <Receipt size={18} /> },
  ]

  const adminNav: NavItem[] = [
    { to: '/admin', label: '관리자 대시보드', icon: <Shield size={18} /> },
    { to: '/admin/approvals', label: '승인 관리', icon: <CheckSquare size={18} /> },
    { to: '/admin/leave', label: '휴가 승인', icon: <CalendarCheck size={18} /> },
    { to: '/admin/payroll', label: '급여 계산', icon: <DollarSign size={18} /> },
  ]

  const superAdminNav: NavItem[] = [
    { to: '/admin/users', label: '사용자 관리', icon: <Users size={18} /> },
  ]

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen fixed left-0 top-0 bg-white border-r border-gray-200 z-30">
      {/* 로고 */}
      <div className="px-5 py-5 border-b border-gray-100">
        <span className="text-lg font-bold text-primary-700">부성TK 근태관리</span>
      </div>

      {/* 메뉴 */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1">
        {mainNav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <div className="mt-4 mb-2 px-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">관리자</p>
            </div>
            {adminNav.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
            {isSuperAdmin && (
              <>
                <div className="mt-4 mb-2 px-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">시스템</p>
                </div>
                {superAdminNav.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navLinkClass}>
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </>
            )}
          </>
        )}
      </nav>

      {/* 프로필 + 로그아웃 */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          {employee?.avatar_url ? (
            <img
              src={employee.avatar_url}
              alt={employee.name}
              className="w-9 h-9 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
              {employee?.name?.charAt(0) ?? 'U'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{employee?.name ?? '사용자'}</p>
            <p className="text-xs text-gray-400 truncate">{employee?.email ?? ''}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 hover:text-danger-600 hover:bg-danger-50 rounded-lg transition-colors"
        >
          <LogOut size={16} />
          로그아웃
        </button>
      </div>
    </aside>
  )
}

import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  FilePlus,
  Calendar,
  Shield,
  CheckSquare,
  CalendarCheck,
  LogOut,
  DollarSign,
  Receipt,
  ChevronDown,
  Settings,
  FolderOpen,
  Archive,
  Clock,
  UserSquare2,
  Banknote,
  Contact,
  RefreshCw,
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
  const [workOpen, setWorkOpen] = useState(true)
  const [overtimeOpen, setOvertimeOpen] = useState(true)
  const [leaveOpen, setLeaveOpen] = useState(true)
  const [leaveEmployeeOpen, setLeaveEmployeeOpen] = useState(true)
  const [etcOpen, setEtcOpen] = useState(true)
  const [payOpen, setPayOpen] = useState(true)

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary-50 text-primary-600'
        : 'text-dark-500 hover:bg-dark-50 hover:text-dark-800'
    }`

  const subNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary-50 text-primary-600'
        : 'text-dark-400 hover:bg-dark-50 hover:text-dark-700'
    }`

  const groupBtnClass = (open: boolean) =>
    `flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
      open ? 'bg-dark-50 text-dark-800' : 'text-dark-600 hover:bg-dark-50'
    }`

  const adminGroupBtnClass = (open: boolean) =>
    `flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
      open ? 'bg-primary-50 text-dark-800' : 'text-dark-700 hover:bg-primary-50/50'
    }`

  const adminNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
      isActive
        ? 'bg-primary-50 text-dark-800'
        : 'text-dark-700 hover:bg-primary-50/50'
    }`

  const mainNav: NavItem[] = [
    { to: '/', label: '대시보드', icon: <LayoutDashboard size={18} /> },
  ]

  const adminNavBefore: NavItem[] = [
    { to: '/admin', label: '관리자 대시보드', icon: <Shield size={18} /> },
    { to: '/admin/employee-management', label: '직원 관리', icon: <Contact size={18} /> },
  ]

  const adminNavAfter: NavItem[] = [
    { to: '/admin/expenses', label: '경비 관리', icon: <Receipt size={18} /> },
    { to: '/admin/payroll', label: '급여 계산', icon: <DollarSign size={18} /> },
  ]

  const superAdminNav: NavItem[] = []

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen fixed left-0 top-0 bg-white border-r border-dark-100 z-30">
      {/* 로고 */}
      <div className="px-5 py-5 border-b border-dark-100">
        <span className="text-lg font-bold text-dark-900">부성TK <span className="text-primary-500">근태관리</span></span>
      </div>

      {/* 메뉴 */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1">
        {mainNav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}

        {/* 근무 관리 */}
        <div>
          <button
            data-tour="nav-work"
            onClick={() => setWorkOpen(o => !o)}
            className={groupBtnClass(workOpen)}
          >
            <div className="flex items-center gap-3">
              <FileText size={18} />
              근무 관리
            </div>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${workOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {workOpen && (
            <div className="ml-4 mt-0.5 space-y-0.5 border-l border-dark-100 pl-3">
              <NavLink to="/requests" className={subNavLinkClass}>
                <FileText size={16} />
                근무 현황
              </NavLink>
              <NavLink to="/request" className={subNavLinkClass}>
                <FilePlus size={16} />
                연장근무 신청
              </NavLink>
            </div>
          )}
        </div>

        {/* 연차 관리 (직원용) */}
        <div>
          <button
            data-tour="nav-leave"
            onClick={() => setLeaveEmployeeOpen(o => !o)}
            className={groupBtnClass(leaveEmployeeOpen)}
          >
            <div className="flex items-center gap-3">
              <Calendar size={18} />
              연차 관리
            </div>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${leaveEmployeeOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {leaveEmployeeOpen && (
            <div className="ml-4 mt-0.5 space-y-0.5 border-l border-dark-100 pl-3">
              <NavLink to="/leave" end className={subNavLinkClass}>
                <CalendarCheck size={16} />
                연차현황
              </NavLink>
              <NavLink to="/leave/request" className={subNavLinkClass}>
                <FileText size={16} />
                연차신청
              </NavLink>
            </div>
          )}
        </div>

        <NavLink to="/expenses" className={navLinkClass} data-tour="nav-expense">
          <Receipt size={18} />
          경비 제출
        </NavLink>

        {isAdmin && (
          <>
            <div className="mt-10 mb-3 px-3 pt-5 border-t border-dark-100">
              <p className="text-xs font-extrabold text-dark-800 tracking-wide">관리자</p>
            </div>
            {adminNavBefore.map((item) => (
              <div key={item.to}>
                <NavLink to={item.to} className={adminNavLinkClass}>
                  {item.icon}
                  {item.label}
                </NavLink>
                <div className="mx-6 my-2 border-b border-dark-50" />
              </div>
            ))}

            {/* 야근 관리 */}
            <div>
              <button
                onClick={() => setOvertimeOpen(o => !o)}
                className={adminGroupBtnClass(overtimeOpen)}
              >
                <div className="flex items-center gap-3">
                  <CheckSquare size={18} />
                  야근 관리
                </div>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${overtimeOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {overtimeOpen && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-dark-100 pl-3">
                  <NavLink to="/admin/overtime" end className={subNavLinkClass}>
                    <Clock size={16} />
                    대시보드
                  </NavLink>
                  <NavLink to="/admin/approvals" className={subNavLinkClass}>
                    <CheckSquare size={16} />
                    승인 관리
                  </NavLink>
                  <NavLink to="/admin/overtime/employees" className={subNavLinkClass}>
                    <UserSquare2 size={16} />
                    직원별 현황
                  </NavLink>
                  <div>
                    <button
                      onClick={() => setPayOpen(o => !o)}
                      className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${payOpen ? 'bg-primary-50 text-dark-800' : 'text-dark-700 hover:bg-primary-50/50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <Banknote size={16} />
                        수당계산
                      </div>
                      <ChevronDown
                        size={12}
                        className={`transition-transform duration-200 ${payOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {payOpen && (
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-dark-100 pl-3">
                        <NavLink to="/admin/overtime/pay" className={subNavLinkClass}>
                          <Banknote size={14} />
                          연장근무수당
                        </NavLink>
                        <NavLink to="/admin/overtime/leave-pay" className={subNavLinkClass}>
                          <Banknote size={14} />
                          연차수당
                        </NavLink>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="mx-6 my-2 border-b border-dark-50" />

            {/* 연차 관리 (관리자) */}
            <div>
              <button
                onClick={() => setLeaveOpen(o => !o)}
                className={adminGroupBtnClass(leaveOpen)}
              >
                <div className="flex items-center gap-3">
                  <CalendarCheck size={18} />
                  연차 관리
                </div>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${leaveOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {leaveOpen && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-dark-100 pl-3">
                  <NavLink to="/admin/leave" end className={subNavLinkClass}>
                    <CheckSquare size={16} />
                    승인 관리
                  </NavLink>
                  <NavLink to="/admin/leave/balance" className={subNavLinkClass}>
                    <Calendar size={16} />
                    직원별 연차
                  </NavLink>
                  <NavLink to="/admin/leave/comp" className={subNavLinkClass}>
                    <RefreshCw size={16} />
                    대체휴가 현황
                  </NavLink>
                  <NavLink to="/admin/leave-types" className={subNavLinkClass}>
                    <Settings size={16} />
                    종류 설정
                  </NavLink>
                </div>
              )}
            </div>
            <div className="mx-6 my-2 border-b border-dark-50" />

            {adminNavAfter.map((item) => (
              <div key={item.to}>
                <NavLink to={item.to} className={adminNavLinkClass}>
                  {item.icon}
                  {item.label}
                </NavLink>
                <div className="mx-6 my-2 border-b border-dark-50" />
              </div>
            ))}

            {/* 기타 */}
            <div>
              <button
                onClick={() => setEtcOpen(o => !o)}
                className={adminGroupBtnClass(etcOpen)}
              >
                <div className="flex items-center gap-3">
                  <Archive size={18} />
                  기타
                </div>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${etcOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {etcOpen && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-dark-100 pl-3">
                  <NavLink to="/admin/documents" className={subNavLinkClass}>
                    <FolderOpen size={16} />
                    자료실
                  </NavLink>
                  <NavLink to="/admin/payslips" className={subNavLinkClass}>
                    <FileText size={16} />
                    급여명세서
                  </NavLink>
                  <NavLink to="/admin/notices" className={subNavLinkClass}>
                    <FileText size={16} />
                    공지사항
                  </NavLink>
                </div>
              )}
            </div>

            {isSuperAdmin && (
              <>
                <div className="mt-5 mb-2 px-3">
                  <p className="text-[11px] font-bold text-dark-300 uppercase tracking-wider">시스템</p>
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
      <div className="px-4 py-4 border-t border-dark-100">
        <div className="flex items-center gap-3 mb-3">
          {employee?.avatar_url ? (
            <img
              src={employee.avatar_url}
              alt={employee.name}
              className="w-9 h-9 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
              {employee?.name?.charAt(0) ?? 'U'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-dark-800 truncate">{employee?.name ?? '사용자'}</p>
            <p className="text-xs text-dark-400 truncate">{employee?.department ?? ''}</p>
          </div>
        </div>
        <NavLink
          to="/settings"
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-dark-400 hover:text-dark-700 hover:bg-dark-50 rounded-lg transition-colors mb-1"
        >
          <Settings size={16} />
          설정
        </NavLink>
        <button
          onClick={signOut}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-dark-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
        >
          <LogOut size={16} />
          로그아웃
        </button>
      </div>
    </aside>
  )
}

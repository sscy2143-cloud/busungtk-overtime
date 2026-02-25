import { Bell } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export function Header() {
  const { employee } = useAuth()

  return (
    <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 h-14 flex items-center justify-between px-4">
      <span className="text-base font-bold text-primary-700">부성TK 근태관리</span>

      <div className="flex items-center gap-3">
        {/* 알림 벨 */}
        <button className="relative p-1.5 text-gray-500 hover:text-gray-700">
          <Bell size={20} />
          {/* 미읽음 배지 */}
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* 프로필 아바타 */}
        {employee?.avatar_url ? (
          <img
            src={employee.avatar_url}
            alt={employee.name}
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-semibold">
            {employee?.name?.charAt(0) ?? 'U'}
          </div>
        )}
      </div>
    </header>
  )
}

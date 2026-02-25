import { LogOut, ShieldAlert } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export function PendingApprovalPage() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm text-center">
        <div className="w-16 h-16 bg-warning-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ShieldAlert className="w-8 h-8 text-warning-500" />
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-2">
          권한 부여가 필요합니다
        </h1>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          관리자가 아직 귀하의 계정에 포지션을 배정하지 않았습니다.
          <br />
          관리자에게 문의해 주세요.
        </p>

        <div className="bg-gray-50 rounded-xl px-4 py-3 mb-6">
          <p className="text-xs text-gray-400 mb-0.5">로그인 계정</p>
          <p className="text-sm font-medium text-gray-700">{user?.email ?? '-'}</p>
        </div>

        <button
          onClick={signOut}
          className="flex items-center justify-center gap-2 w-full py-3 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
        >
          <LogOut size={16} />
          로그아웃
        </button>
      </div>
    </div>
  )
}

import { useAuth } from '../contexts/AuthContext'

export function SettingsPage() {
  const { employee } = useAuth()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">설정</h1>
        <p className="text-sm text-gray-500 mt-0.5">계정 설정을 관리합니다</p>
      </div>

      {/* 내 정보 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">내 정보</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">이름</span>
            <span className="font-medium text-gray-900">{employee?.name ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">부서</span>
            <span className="font-medium text-gray-900">{employee?.department ?? '-'}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm text-gray-500">
          비밀번호 변경이 필요한 경우 인사담당자에게 문의하세요.
        </p>
      </div>
    </div>
  )
}

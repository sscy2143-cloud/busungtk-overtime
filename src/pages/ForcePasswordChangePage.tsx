import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export function ForcePasswordChangePage() {
  const { changePassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!newPassword || !confirmPassword) {
      setError('새 비밀번호를 입력하세요')
      return
    }
    if (newPassword.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다')
      return
    }

    setLoading(true)
    const result = await changePassword(newPassword)
    if (result.success) {
      navigate('/', { replace: true })
    } else {
      setError(result.error ?? '비밀번호 변경에 실패했습니다')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-warning-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-8 h-8 text-warning-500" />
          </div>
          <h1 className="text-xl font-bold text-dark-900">비밀번호 변경 필요</h1>
          <p className="text-sm text-dark-500 mt-2 leading-relaxed">
            임시 비밀번호로 로그인하셨습니다.<br />
            보안을 위해 새 비밀번호를 설정해주세요.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1">새 비밀번호</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setError('') }}
              placeholder="6자 이상"
              className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
              placeholder="비밀번호 재입력"
              className="w-full px-3 py-2.5 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          {error && <p className="text-xs text-danger-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary-500 text-white text-sm font-semibold rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
          >
            {loading ? '변경 중...' : '비밀번호 변경'}
          </button>
        </form>

        <button
          onClick={signOut}
          className="flex items-center justify-center gap-2 w-full mt-4 py-2.5 text-sm text-dark-500 border border-dark-200 rounded-xl hover:bg-dark-50 transition-colors"
        >
          <LogOut size={14} />
          로그아웃
        </button>
      </div>
    </div>
  )
}

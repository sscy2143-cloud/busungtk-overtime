import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Lock } from 'lucide-react'

export function LoginPage() {
  const { user, loading, signInWithGoogle, signInAsDemo } = useAuth()
  const navigate = useNavigate()
  const [devMode, setDevMode] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && user) {
      navigate('/', { replace: true })
    }
  }, [user, loading, navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  function handleDemoLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const success = signInAsDemo(password)
    if (!success) {
      setError('비밀번호가 올바르지 않습니다')
      setPassword('')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        {/* 로고 / 타이틀 */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">부</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">부성TK 근태관리</h1>
          <p className="text-sm text-gray-500 mt-1">야근·휴가 통합 관리 시스템</p>
        </div>

        {/* 구분선 */}
        <div className="border-t border-gray-100 mb-6" />

        {/* 구글 로그인 버튼 */}
        <button
          onClick={signInWithGoogle}
          className="flex items-center justify-center gap-3 w-full py-3 px-4 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors shadow-sm"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" fillRule="evenodd">
              <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
            </g>
          </svg>
          Google 계정으로 로그인
        </button>

        {/* 개발자 데모 모드 */}
        <div className="mt-6 pt-6 border-t border-gray-100">
          <button
            onClick={() => setDevMode(!devMode)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-500 mx-auto"
          >
            <Lock size={12} />
            개발자 모드
          </button>

          {devMode && (
            <form onSubmit={handleDemoLogin} className="mt-3 space-y-2">
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                placeholder="비밀번호 입력"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
                autoFocus
              />
              {error && <p className="text-xs text-danger-500">{error}</p>}
              <button
                type="submit"
                className="w-full py-2 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-900 transition-colors"
              >
                관리자 데모 로그인
              </button>
            </form>
          )}
        </div>

        <p className="text-xs text-center text-gray-400 mt-6">
          부성TK 임직원 전용 서비스입니다
        </p>
      </div>
    </div>
  )
}

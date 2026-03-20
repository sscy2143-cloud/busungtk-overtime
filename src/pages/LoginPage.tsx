import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function LoginPage() {
  const { user, loading, signInWithPassword, signInAsDemo } = useAuth()
  const navigate = useNavigate()
  const [devMode, setDevMode] = useState(false)
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [password, setPassword] = useState('')
  const [demoPassword, setDemoPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 아이콘 3번 클릭 (5초 내) → 개발자 모드
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  function handleLogoClick() {
    clickCountRef.current += 1
    clearTimeout(clickTimerRef.current)

    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0
      setDevMode(prev => !prev)
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0
      }, 5000)
    }
  }

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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!employeeNumber.trim() || !password) return
    setError('')
    setSubmitting(true)

    const result = await signInWithPassword(employeeNumber.trim(), password)
    if (!result.success) {
      setError(result.error ?? '로그인에 실패했습니다')
      setPassword('')
    }
    setSubmitting(false)
  }

  async function handleDemoLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const success = await signInAsDemo(demoPassword)
    if (!success) {
      setError('비밀번호가 올바르지 않습니다')
      setDemoPassword('')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        {/* 로고 / 타이틀 */}
        <div className="text-center mb-8">
          <div
            onClick={handleLogoClick}
            className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 cursor-default select-none"
          >
            <span className="text-white text-2xl font-bold">부</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">부성TK 근태관리</h1>
          <p className="text-sm text-gray-500 mt-1">야근·휴가 통합 관리 시스템</p>
        </div>

        {/* 구분선 */}
        <div className="border-t border-gray-100 mb-6" />

        {/* 사번/비밀번호 로그인 */}
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">사번</label>
            <input
              type="text"
              value={employeeNumber}
              onChange={(e) => { setEmployeeNumber(e.target.value); setError('') }}
              placeholder="사번 입력"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              placeholder="비밀번호 입력"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-xs text-danger-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !employeeNumber.trim() || !password}
            className="w-full py-3 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '로그인 중...' : '로그인'}
          </button>
        </form>

        {/* 개발자 데모 모드 (아이콘 3번 클릭 시 표시) */}
        {devMode && (
          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center mb-3">개발자 모드</p>
            <form onSubmit={handleDemoLogin} className="space-y-2">
              <input
                type="password"
                value={demoPassword}
                onChange={(e) => { setDemoPassword(e.target.value); setError('') }}
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
          </div>
        )}

        <p className="text-xs text-center text-gray-400 mt-6">
          부성TK 임직원 전용 서비스입니다
        </p>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

const PAY_VERIFIED_KEY = 'busungtk_pay_verified'

export function PayPasswordGate({ children }: { children: React.ReactNode }) {
  const { employee } = useAuth()

  // manager(인사담당)만 비밀번호 재확인. admin은 SecondAuthGate로 별도 인증(마이그레이션 적용 후 라우트에 복구 예정)
  const needsGate = employee?.role === 'manager'

  const [verified, setVerified] = useState(() => {
    if (!needsGate) return true
    return sessionStorage.getItem(PAY_VERIFIED_KEY) === employee?.id
  })

  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!needsGate || verified) return <>{children}</>

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!employee || !password) return
    setError('')
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: employee.email,
      password,
    })
    setLoading(false)
    if (authError) {
      setError('비밀번호가 올바르지 않습니다')
      setPassword('')
      return
    }
    sessionStorage.setItem(PAY_VERIFIED_KEY, employee.id)
    setVerified(true)
  }

  return (
    <div className="flex items-center justify-center py-20 px-4">
      <div className="bg-white rounded-2xl border border-dark-100 shadow-lg p-6 w-full max-w-xs space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Lock className="w-7 h-7 text-primary-500" />
          </div>
          <h2 className="text-lg font-bold text-dark-900">급여 정보 접근</h2>
          <p className="text-sm text-dark-500 mt-1">
            비밀번호를 입력하면 급여 정보를 볼 수 있습니다
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
            placeholder="비밀번호 입력"
            autoFocus
            className="w-full px-4 py-3 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={!password || loading}
            className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
          >
            {loading ? '확인 중...' : '확인'}
          </button>
        </form>
      </div>
    </div>
  )
}

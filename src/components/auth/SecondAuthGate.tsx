import { useState, useEffect } from 'react'
import { ShieldCheck, KeyRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

const SESSION_KEY = 'busungtk_2fa_verified'

export function SecondAuthGate({ children }: { children: React.ReactNode }) {
  const { employee, signOut } = useAuth()
  // manager는 마이그레이션(20260812010000) 적용 후 이 게이트로 전환 예정 — 그 전까진 PayPasswordGate가 대신 막음
  const needsGate = employee?.role === 'admin'

  const [verified, setVerified] = useState(() => {
    if (!needsGate) return true
    return sessionStorage.getItem(SESSION_KEY) === employee?.id
  })

  const [mode, setMode] = useState<'loading' | 'setup' | 'verify'>('loading')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!needsGate) { setVerified(true); return }
    if (sessionStorage.getItem(SESSION_KEY) === employee?.id) { setVerified(true); return }

    supabase.rpc('has_second_auth_password').then(({ data }) => {
      setMode(data ? 'verify' : 'setup')
    })
  }, [employee?.id, needsGate])

  if (!needsGate || verified) return <>{children}</>
  if (mode === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!/^\d{4}$/.test(password)) { setError('숫자 4자리를 입력하세요'); return }
    if (password !== confirmPassword) { setError('비밀번호가 일치하지 않습니다'); return }
    setLoading(true)
    const { error: rpcError } = await supabase.rpc('set_second_auth_password', { p_password: password })
    setLoading(false)
    if (rpcError) { setError(rpcError.message); return }
    sessionStorage.setItem(SESSION_KEY, employee!.id)
    setVerified(true)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!password) return
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('verify_second_auth_password', { p_password: password })
    setLoading(false)
    if (rpcError) { setError(rpcError.message); return }
    if (!data) { setError('비밀번호가 올바르지 않습니다'); setPassword(''); return }
    sessionStorage.setItem(SESSION_KEY, employee!.id)
    setVerified(true)
  }

  const isSetup = mode === 'setup'

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-50 px-4">
      <div className="bg-white rounded-2xl border border-dark-100 shadow-lg p-6 w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            {isSetup
              ? <KeyRound className="w-7 h-7 text-primary-500" />
              : <ShieldCheck className="w-7 h-7 text-primary-500" />
            }
          </div>
          <h2 className="text-lg font-bold text-dark-900">
            {isSetup ? '2차 인증 PIN 설정' : '2차 인증'}
          </h2>
          <p className="text-sm text-dark-500 mt-1">
            {isSetup
              ? '로그인 시 사용할 숫자 4자리 PIN을 설정하세요'
              : '숫자 4자리 PIN을 입력하세요'
            }
          </p>
        </div>

        <form onSubmit={isSetup ? handleSetup : handleVerify} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-dark-600 mb-1">
              {isSetup ? '새 PIN' : 'PIN'}
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              value={password}
              onChange={e => { setPassword(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
              placeholder="4자리 숫자"
              autoFocus
              className="w-full px-4 py-3 text-xl tracking-[0.5em] text-center border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          {isSetup && (
            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">PIN 확인</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoComplete="off"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
                placeholder="4자리 숫자 재입력"
                className="w-full px-4 py-3 text-xl tracking-[0.5em] text-center border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || password.length !== 4 || (isSetup && confirmPassword.length !== 4)}
            className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
          >
            {loading ? '처리 중...' : isSetup ? '비밀번호 설정' : '확인'}
          </button>
        </form>

        <button
          onClick={() => { sessionStorage.removeItem(SESSION_KEY); signOut() }}
          className="w-full py-2 text-xs text-dark-400 hover:text-dark-600"
        >
          로그아웃
        </button>
      </div>
    </div>
  )
}

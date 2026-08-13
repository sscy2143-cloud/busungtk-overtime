import { useState } from 'react'
import { Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface ReauthGateProps {
  onVerified: () => void
  title?: string
  description?: string
  compact?: boolean
}

export function ReauthGate({ onVerified, title = '민감 정보 확인', description = '이 내용을 보려면 로그인 비밀번호를 다시 확인해주세요.', compact = false }: ReauthGateProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setError('')
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('verify_login_password', { p_password: password })
    setLoading(false)
    if (rpcError || !data) { setError('비밀번호가 올바르지 않습니다'); setPassword(''); return }
    onVerified()
  }

  return (
    <div className={compact ? 'p-4' : 'bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5'}>
      <div className="flex items-center gap-2 mb-1">
        <Lock size={14} className="text-dark-400" />
        <h2 className="text-sm font-semibold text-dark-700">{title}</h2>
      </div>
      <p className="text-xs text-dark-400 mb-3">{description}</p>
      <form onSubmit={handleSubmit} className="flex gap-2 max-w-xs">
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError('') }}
          placeholder="로그인 비밀번호"
          autoFocus
          className="flex-1 px-3 py-2 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        <button
          type="submit"
          disabled={loading || !password}
          className="px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '확인 중...' : '확인'}
        </button>
      </form>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  )
}

import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { ReauthGate } from '../components/auth/ReauthGate'

function SecondAuthPinChangeCard() {
  const [oldPassword, setOldPassword] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    if (!/^\d{4}$/.test(newPin)) { setError('새 PIN은 숫자 4자리여야 합니다'); return }
    if (newPin !== confirmPin) { setError('새 PIN이 일치하지 않습니다'); return }
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('change_second_auth_password', {
      p_old_password: oldPassword,
      p_new_password: newPin,
    })
    setLoading(false)
    if (rpcError) { setError(rpcError.message); return }
    if (!data) { setError('기존 비밀번호가 올바르지 않습니다'); return }
    setOldPassword('')
    setNewPin('')
    setConfirmPin('')
    setSuccess(true)
  }

  return (
    <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5">
      <h2 className="text-sm font-semibold text-dark-700 mb-1">2차 인증 PIN 변경</h2>
      <p className="text-xs text-dark-400 mb-3">급여 등 민감한 화면 접근 시 쓰는 2차 인증 PIN을 변경합니다. 기존 비밀번호가 4자리 숫자가 아니었다면 여기서 4자리로 바꿔주세요.</p>
      <form onSubmit={handleSubmit} className="space-y-2.5 max-w-xs">
        <input
          type="password"
          autoComplete="off"
          value={oldPassword}
          onChange={e => { setOldPassword(e.target.value); setError('') }}
          placeholder="기존 비밀번호"
          className="w-full px-3 py-2 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          value={newPin}
          onChange={e => { setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
          placeholder="새 PIN (숫자 4자리)"
          className="w-full px-3 py-2 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 text-center tracking-[0.3em]"
        />
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          value={confirmPin}
          onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
          placeholder="새 PIN 확인"
          className="w-full px-3 py-2 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 text-center tracking-[0.3em]"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        {success && <p className="text-xs text-primary-600">PIN이 변경되었습니다.</p>}
        <button
          type="submit"
          disabled={loading || !oldPassword || newPin.length !== 4 || confirmPin.length !== 4}
          className="w-full py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '변경 중...' : 'PIN 변경'}
        </button>
      </form>
    </div>
  )
}

export function SettingsPage() {
  const { employee } = useAuth()
  const [pinCardUnlocked, setPinCardUnlocked] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-dark-900">설정</h1>
        <p className="text-sm text-dark-500 mt-0.5">계정 설정을 관리합니다</p>
      </div>

      {/* 내 정보 */}
      <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5">
        <h2 className="text-sm font-semibold text-dark-700 mb-3">내 정보</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-dark-500">이름</span>
            <span className="font-medium text-dark-900">{employee?.name ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-500">부서</span>
            <span className="font-medium text-dark-900">{employee?.department ?? '-'}</span>
          </div>
        </div>
      </div>

      {/* manager는 마이그레이션(20260812010000) 적용 후 노출 예정 — 그 전엔 RPC가 admin만 허용 */}
      {employee?.role === 'admin' && (
        pinCardUnlocked
          ? <SecondAuthPinChangeCard />
          : <ReauthGate title="2차 인증 PIN 변경" onVerified={() => setPinCardUnlocked(true)} />
      )}

      <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5">
        <p className="text-sm text-dark-500">
          비밀번호 변경이 필요한 경우 인사담당자에게 문의하세요.
        </p>
      </div>
    </div>
  )
}

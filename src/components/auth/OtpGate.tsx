import { useState, useEffect, useRef } from 'react'
import { ShieldCheck, Send } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

const OTP_SESSION_KEY = 'busungtk_otp_verified'

export function OtpGate({ children }: { children: React.ReactNode }) {
  const { employee, signOut } = useAuth()
  // manager(인사담당)는 급여 탭 진입 시 PayPasswordGate로 별도 인증
  const needsOtp = employee?.role === 'admin'

  const [verified, setVerified] = useState(() => {
    if (!needsOtp) return true
    return sessionStorage.getItem(OTP_SESSION_KEY) === employee?.id
  })

  const [step, setStep] = useState<'idle' | 'sent' | 'verifying'>('idle')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [timestamp, setTimestamp] = useState(0)
  const [cooldown, setCooldown] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!needsOtp) { setVerified(true); return }
    if (sessionStorage.getItem(OTP_SESSION_KEY) === employee?.id) {
      setVerified(true)
    }
  }, [employee?.id, needsOtp])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendOtp() {
    if (!employee) return
    setError('')
    setStep('verifying')
    try {
      const res = await fetch('/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: employee.id, role: employee.role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'SMS 발송 실패')
      setToken(data.token)
      setTimestamp(data.timestamp)
      setStep('sent')
      setCooldown(60)
      setTimeout(() => inputRef.current?.focus(), 100)
    } catch (e: any) {
      setError(e.message)
      setStep('idle')
    }
  }

  async function verifyOtp() {
    if (!employee || code.length !== 6) return
    setError('')
    setStep('verifying')
    try {
      const res = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, userId: employee.id, token, timestamp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '인증 실패')
      sessionStorage.setItem(OTP_SESSION_KEY, employee.id)
      setVerified(true)
    } catch (e: any) {
      setError(e.message)
      setStep('sent')
      setCode('')
    }
  }

  if (verified) return <>{children}</>

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-50 px-4">
      <div className="bg-white rounded-2xl border border-dark-100 shadow-lg p-6 w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-7 h-7 text-primary-500" />
          </div>
          <h2 className="text-lg font-bold text-dark-900">2차 인증</h2>
          <p className="text-sm text-dark-500 mt-1">
            등록된 휴대폰으로 인증번호를 발송합니다
          </p>
        </div>

        {step === 'idle' && (
          <button
            onClick={sendOtp}
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors"
          >
            <Send className="w-4 h-4" />
            인증번호 전송
          </button>
        )}

        {step === 'sent' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">인증번호 6자리</label>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) verifyOtp() }}
                placeholder="000000"
                className="w-full px-4 py-3 text-center text-xl font-bold tracking-[0.5em] border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <button
              onClick={verifyOtp}
              disabled={code.length !== 6}
              className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              확인
            </button>
            <button
              onClick={sendOtp}
              disabled={cooldown > 0}
              className="w-full py-2.5 text-sm text-dark-500 border border-dark-200 rounded-xl hover:bg-dark-50 transition-colors disabled:opacity-40"
            >
              {cooldown > 0 ? `재전송 (${cooldown}초)` : '인증번호 재전송'}
            </button>
          </div>
        )}

        {step === 'verifying' && (
          <div className="text-center py-4">
            <p className="text-sm text-dark-500">처리 중...</p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-500 text-center">{error}</p>
        )}

        <button
          onClick={() => { sessionStorage.removeItem(OTP_SESSION_KEY); signOut() }}
          className="w-full py-2 text-xs text-dark-400 hover:text-dark-600"
        >
          로그아웃
        </button>
      </div>
    </div>
  )
}

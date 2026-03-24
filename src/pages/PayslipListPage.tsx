import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Eye, Download, X, Lock, ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

interface Payslip {
  id: string
  period: string
  file_path: string
  file_name: string
  message: string | null
  work_start: string | null
  work_end: string | null
}

export function PayslipListPage() {
  const { employee, user } = useAuth()
  const navigate = useNavigate()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ slip: Payslip; signedUrl: string } | null>(null)

  // 본인 확인 (이메일 재입력)
  const [verified, setVerified] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [verifyError, setVerifyError] = useState('')

  function handleVerify() {
    const userEmail = user?.email?.toLowerCase().trim()
    if (!userEmail) return
    if (emailInput.toLowerCase().trim() === userEmail) {
      setVerified(true)
      setVerifyError('')
    } else {
      setVerifyError('이메일이 일치하지 않습니다.')
    }
  }

  useEffect(() => {
    if (!employee?.id || !verified) return
    async function fetch() {
      const { data } = await supabase
        .from('payslips')
        .select('id, period, file_path, file_name, message, work_start, work_end')
        .eq('employee_id', employee!.id)
        .order('period', { ascending: false })
      if (data) setPayslips(data)
      setLoading(false)
    }
    fetch()
  }, [employee?.id, verified])

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 hover:bg-dark-100 rounded-lg transition-colors"
        >
          <ChevronLeft size={20} className="text-dark-500" />
        </button>
        <h1 className="text-xl font-bold text-dark-900">급여명세서</h1>
      </div>

      {/* 본인 확인 */}
      {!verified ? (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-8 max-w-md mx-auto text-center">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 bg-primary-50 rounded-full flex items-center justify-center">
              <Lock size={24} className="text-primary-600" />
            </div>
          </div>
          <h2 className="text-lg font-bold text-dark-900 mb-1">본인 확인</h2>
          <p className="text-sm text-dark-500 mb-6">
            급여명세서는 개인정보이므로 본인 확인이 필요합니다.<br />
            로그인에 사용한 이메일을 입력해주세요.
          </p>
          <form onSubmit={e => { e.preventDefault(); handleVerify() }} className="space-y-3">
            <input
              type="email"
              value={emailInput}
              onChange={e => { setEmailInput(e.target.value); setVerifyError('') }}
              placeholder="example@gmail.com"
              className="w-full px-4 py-3 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 text-center"
              autoFocus
            />
            {verifyError && (
              <p className="text-xs text-primary-500 font-medium">{verifyError}</p>
            )}
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
            >
              <ShieldCheck size={16} />
              확인
            </button>
          </form>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-dark-400">불러오는 중...</p>
        </div>
      ) : payslips.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] py-16 text-center">
          <p className="text-sm text-dark-400">등록된 급여명세서가 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-100 bg-dark-50">
                <th className="px-4 py-3 text-center text-xs font-semibold text-dark-400 w-12">No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">지급월</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-dark-400">실근로일</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">파일명</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400">전달 문구</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-dark-400 w-16">보기</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-50">
              {payslips.map((slip, idx) => {
                const [y, m] = slip.period.split('-')
                return (
                  <tr key={slip.id} className="hover:bg-dark-50 transition-colors">
                    <td className="px-4 py-3 text-center text-xs text-dark-400">{idx + 1}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-dark-800">{y}년 {parseInt(m)}월</td>
                    <td className="px-4 py-3 text-center text-xs text-dark-500">
                      {slip.work_start && slip.work_end
                        ? `${slip.work_start.slice(5).replace('-', '/')} ~ ${slip.work_end.slice(5).replace('-', '/')}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-dark-500 truncate max-w-[180px]">{slip.file_name}</td>
                    <td className="px-4 py-3 text-xs text-dark-500 truncate max-w-[150px]">{slip.message ?? '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={async () => {
                          const { data } = await supabase.storage.from('payslips').createSignedUrl(slip.file_path, 300)
                          if (data?.signedUrl) setModal({ slip, signedUrl: data.signedUrl })
                        }}
                        className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 상세 팝업 */}
      {modal && (() => {
        const { slip, signedUrl } = modal
        const [y, m] = slip.period.split('-')
        const isPdf = slip.file_name.toLowerCase().endsWith('.pdf')
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setModal(null)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-dark-100">
                <h3 className="text-base font-bold text-dark-900">급여명세서 상세</h3>
                <button onClick={() => setModal(null)} className="p-1 hover:bg-dark-100 rounded-lg">
                  <X size={20} className="text-dark-400" />
                </button>
              </div>
              <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
                <div className="w-full md:w-72 flex-shrink-0 p-6 border-b md:border-b-0 md:border-r border-dark-100 space-y-4 overflow-y-auto">
                  <div>
                    <p className="text-xs font-medium text-dark-400 mb-1">지급월</p>
                    <p className="text-lg font-bold text-dark-900">{y}년 {parseInt(m)}월</p>
                  </div>
                  {slip.work_start && slip.work_end && (
                    <div>
                      <p className="text-xs font-medium text-dark-400 mb-1">실근로일</p>
                      <p className="text-sm text-dark-700">{slip.work_start} ~ {slip.work_end}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium text-dark-400 mb-1">파일명</p>
                    <p className="text-sm text-dark-700">{slip.file_name}</p>
                  </div>
                  {slip.message && (
                    <div>
                      <p className="text-xs font-medium text-dark-400 mb-1">전달 문구</p>
                      <p className="text-sm text-primary-700 bg-primary-50 rounded-lg p-3">{slip.message}</p>
                    </div>
                  )}
                  <button
                    onClick={() => window.open(signedUrl, '_blank', 'noopener,noreferrer')}
                    className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
                  >
                    <Download size={14} />
                    다운로드
                  </button>
                </div>
                <div className="flex-1 bg-dark-50 flex items-center justify-center p-4 min-h-[400px]">
                  {isPdf ? (
                    <iframe
                      src={signedUrl}
                      className="w-full h-full min-h-[500px] rounded-lg border border-dark-200"
                      title="PDF 미리보기"
                    />
                  ) : (
                    <img
                      src={signedUrl}
                      alt="급여명세서"
                      className="max-w-full max-h-[70vh] rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] object-contain"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

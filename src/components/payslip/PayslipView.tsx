import { Printer } from 'lucide-react'

export interface PayslipLineItem {
  label: string
  amount: number
}

export interface PayslipCalcMethod {
  label: string
  formula: string
}

export interface PayslipWorkStats {
  totalWorkDays?: string | null
  totalMinutes?: number | null
  baseMinutes?: number | null
  extendedMinutes?: number | null
  nightMinutes?: number | null
  holidayMinutes?: number | null
  leaveMinutes?: number | null
  etcMinutes?: number | null
}

export interface PayslipViewProps {
  companyName?: string
  period: string // 'YYYY-MM'
  payDate?: string | null
  employeeName: string
  department?: string | null
  position?: string | null
  hireDate?: string | null
  workStart?: string | null
  workEnd?: string | null
  payments: PayslipLineItem[]
  deductions: PayslipLineItem[]
  workStats?: PayslipWorkStats | null
  calcMethods?: PayslipCalcMethod[]
  message?: string | null
  showPrintButton?: boolean
}

function fmtWon(n: number) {
  return Math.round(n).toLocaleString('ko-KR')
}

function fmtDateKo(dateStr?: string | null) {
  if (!dateStr) return '-'
  const [y, m, d] = dateStr.split('-')
  if (!y || !m || !d) return dateStr
  return `${y}년 ${m}월 ${d}일`
}

function fmtHMS(minutes?: number | null) {
  if (minutes == null) return '00h00m00s'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}m00s`
}

export function Watermark({ text, size = 'normal' }: { text: string; size?: 'normal' | 'small' }) {
  if (!text) return null
  const small = size === 'small'
  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none">
      <div
        className={small ? 'flex flex-wrap content-start gap-x-4 gap-y-4' : 'flex flex-wrap content-start gap-x-12 gap-y-16'}
        style={{ width: '160%', marginLeft: '-30%', marginTop: '-20%', transform: 'rotate(-28deg)', transformOrigin: 'center' }}
      >
        {Array.from({ length: small ? 150 : 60 }).map((_, i) => (
          <span
            key={i}
            className={small ? 'text-dark-300 text-[8px] font-medium whitespace-nowrap' : 'text-dark-300 text-xs font-medium whitespace-nowrap'}
            style={{ opacity: 0.35 }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  )
}

export function PayslipView({
  companyName = '부성티케이',
  period,
  payDate,
  employeeName,
  department,
  position,
  hireDate,
  workStart,
  workEnd,
  payments,
  deductions,
  workStats,
  calcMethods,
  message,
  showPrintButton = true,
}: PayslipViewProps) {
  const [y, m] = period.split('-')
  const totalPayment = payments.reduce((s, p) => s + p.amount, 0)
  const totalDeduction = deductions.reduce((s, d) => s + d.amount, 0)
  const netPay = totalPayment - totalDeduction

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #payslip-print-root, #payslip-print-root * { visibility: visible; }
          #payslip-print-root { position: absolute; left: 0; top: 0; width: 100%; }
          .payslip-no-print { display: none !important; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      {showPrintButton && (
        <div className="payslip-no-print flex justify-end mb-3">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors"
          >
            <Printer size={13} />
            인쇄 / PDF 저장
          </button>
        </div>
      )}

      <div id="payslip-print-root" className="relative bg-white text-dark-900">
        <Watermark text={employeeName} />
        <div className="relative z-10">
        <p className="text-xs text-dark-500 mb-2">{companyName}</p>

        <div className="border border-dark-300 rounded-lg overflow-hidden">
          {/* 제목 + 지급일/입사일 */}
          <div className="flex items-start justify-between px-6 py-5 border-b border-dark-200">
            <h1 className="text-xl font-bold text-dark-900">{y}년 {parseInt(m, 10)}월 급여명세서</h1>
            <div className="text-right text-sm space-y-1">
              <p><span className="text-dark-500 mr-3">급여지급일</span><span className="font-medium">{fmtDateKo(payDate)}</span></p>
              <p><span className="text-dark-500 mr-3">입사일자</span><span className="font-medium">{fmtDateKo(hireDate)}</span></p>
            </div>
          </div>

          {/* 이름/부서/직위 */}
          <div className="px-6 py-4 border-b border-dark-200 text-sm space-y-1">
            <p><span className="inline-block w-14 text-dark-500">이름</span>{employeeName}</p>
            <p><span className="inline-block w-14 text-dark-500">부서</span>{department || ''}<span className="inline-block w-14 text-dark-500 ml-6">직위</span>{position || ''}</p>
          </div>

          {/* 실지급액 */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-dark-200">
            <span className="font-bold text-dark-900">실지급액</span>
            <span className="text-lg font-bold text-dark-900">{fmtWon(netPay)}</span>
          </div>

          {/* 지급항목 / 공제항목 */}
          <div className="grid grid-cols-2">
            <div className="border-r border-dark-200">
              <div className="flex items-center justify-between px-6 py-3 border-b border-dark-100">
                <span className="font-bold text-dark-900">지급항목</span>
                <span className="font-bold text-dark-900">{fmtWon(totalPayment)}</span>
              </div>
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-2 text-sm">
                  <span className="text-dark-600">{p.label}</span>
                  <span className="text-dark-800">{fmtWon(p.amount)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center justify-between px-6 py-3 border-b border-dark-100">
                <span className="font-bold text-dark-900">공제항목</span>
                <span className="font-bold text-dark-900">{fmtWon(totalDeduction)}</span>
              </div>
              {deductions.map((d, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-2 text-sm">
                  <span className="text-dark-600">{d.label}</span>
                  <span className="text-dark-800">{fmtWon(d.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 급여 산정 근로기간 + 근로시간 통계 */}
        {workStats && (
          <div className="border border-dark-300 rounded-lg overflow-hidden mt-4">
            <div className="flex items-center justify-between px-6 py-3 border-b border-dark-200 bg-dark-50">
              <span className="text-sm font-semibold text-dark-700">급여 산정 근로기간</span>
              <span className="text-sm text-dark-700">{workStart || '-'} ~ {workEnd || '-'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-center">
                <thead>
                  <tr className="border-b border-dark-100">
                    <th className="px-2 py-2 font-semibold text-dark-500">총 근무일수</th>
                    <th className="px-2 py-2 font-semibold text-dark-500">총 근로시간</th>
                    <th className="px-2 py-2 font-semibold text-dark-500">기본근로시간</th>
                    <th className="px-2 py-2 font-semibold text-dark-500">연장근로시간</th>
                    <th className="px-2 py-2 font-semibold text-dark-500">야간근로시간</th>
                    <th className="px-2 py-2 font-semibold text-dark-500">휴일근로시간</th>
                    <th className="px-2 py-2 font-semibold text-dark-500">휴가</th>
                    <th className="px-2 py-2 font-semibold text-dark-500">기타</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-2 py-2">{workStats.totalWorkDays ?? '-'}</td>
                    <td className="px-2 py-2">{fmtHMS(workStats.totalMinutes)}</td>
                    <td className="px-2 py-2">{fmtHMS(workStats.baseMinutes)}</td>
                    <td className="px-2 py-2">{fmtHMS(workStats.extendedMinutes)}</td>
                    <td className="px-2 py-2">{fmtHMS(workStats.nightMinutes)}</td>
                    <td className="px-2 py-2">{fmtHMS(workStats.holidayMinutes)}</td>
                    <td className="px-2 py-2">{fmtHMS(workStats.leaveMinutes)}</td>
                    <td className="px-2 py-2">{fmtHMS(workStats.etcMinutes)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 급여 계산 방법 */}
        {calcMethods && calcMethods.length > 0 && (
          <div className="border border-dark-300 rounded-lg overflow-hidden mt-4">
            <div className="px-6 py-3 border-b border-dark-200 bg-dark-50 text-center">
              <span className="text-sm font-semibold text-dark-700">급여 계산 방법</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-100">
                  <th className="px-4 py-2 text-left font-semibold text-dark-500 w-32">구분</th>
                  <th className="px-4 py-2 text-left font-semibold text-dark-500">산출식 또는 산출방법</th>
                </tr>
              </thead>
              <tbody>
                {calcMethods.map((c, i) => (
                  <tr key={i} className="border-b border-dark-50 last:border-0">
                    <td className="px-4 py-2.5 text-dark-700">{c.label}</td>
                    <td className="px-4 py-2.5 text-dark-600">{c.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {message && (
          <div className="mt-4 px-4 py-3 text-sm text-primary-700 bg-primary-50 rounded-lg">{message}</div>
        )}
        </div>
      </div>
    </div>
  )
}

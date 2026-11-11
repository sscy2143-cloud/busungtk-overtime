// 상여·성과급이 포함된 명세서의 근로소득세 계산 자료 입력 (시행령 195조)
// 이 화면의 입력은 공제항목을 직접 바꾸지 않는다 — 계산이 되면 [계산값 적용]을 눌러야 반영된다.
import type { BonusSlipCalc, MonthRecord } from '../../utils/bonus-withholding'

export interface HistoryRow extends MonthRecord {
  /** 'saved' = 저장된 명세서에서 불러옴(미확인으로 시작), 'edited' = 직접 입력, 'none' = 자료 없음 */
  source: 'saved' | 'edited' | 'none'
  flags: string[]
}

const numOrNull = (s: string) => {
  const d = s.replace(/[^0-9]/g, '')
  return d === '' ? null : Number(d)
}
const fmt = (n: number | null) => (n == null ? '' : n.toLocaleString('ko-KR'))

export function BonusTaxInputs({
  bonusLabels, bonusPayDate, onBonusPayDateChange, periods, onPeriodsChange, accrualConfirmed, onAccrualConfirmedChange, history, onHistoryChange, calc,
}: {
  bonusLabels: string[]
  bonusPayDate: string
  onBonusPayDateChange: (v: string) => void
  periods: Record<string, number | null>
  onPeriodsChange: (v: Record<string, number | null>) => void
  accrualConfirmed: boolean
  onAccrualConfirmedChange: (v: boolean) => void
  history: HistoryRow[]
  onHistoryChange: (rows: HistoryRow[]) => void
  calc: BonusSlipCalc
}) {
  const update = (month: string, patch: Partial<HistoryRow>) =>
    onHistoryChange(history.map(r => (r.month === month ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-2 rounded-lg border border-dark-200 p-3" data-testid="bonus-tax-inputs">
      <div className="font-semibold text-dark-700">상여·성과급 포함 달 계산 자료 (소득세법 시행령 195조)</div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-dark-500">상여·성과급 실제 지급일</span>
          <input type="date" aria-label="상여 실제 지급일" value={bonusPayDate} onChange={e => onBonusPayDateChange(e.target.value)} className="px-2 py-1 border border-dark-200 rounded-lg" />
        </label>
        {bonusLabels.map(label => (
          <label key={label} className="flex items-center gap-1.5">
            <span className="text-dark-500">{label} 지급대상기간</span>
            <select
              aria-label={`${label} 지급대상기간`}
              value={periods[label] == null ? '' : String(periods[label])}
              onChange={e => onPeriodsChange({ ...periods, [label]: e.target.value === '' ? null : Number(e.target.value) })}
              className="px-2 py-1 border border-dark-200 rounded-lg bg-white"
            >
              <option value="">없음(명절상여·연간 성과금 등)</option>
              {[1, 2, 3, 4, 6, 12].map(m => <option key={m} value={m}>{m}개월</option>)}
            </select>
          </label>
        ))}
      </div>

      {calc.needsAccrualJudgment && (
        <label className="flex items-start gap-1.5 rounded border border-warning-200 bg-warning-50 px-2 py-1.5 text-warning-700" data-testid="accrual-gate">
          <input type="checkbox" aria-label="귀속월 기준 세무 확인" checked={accrualConfirmed} onChange={e => onAccrualConfirmedChange(e.target.checked)} className="mt-0.5" />
          <span>
            상여 지급일과 이 달 일반 급여 지급일(위 '급여지급일')이 다릅니다. 지급대상기간에 넣을 일반 급여·기원천징수세액 범위는 세무 판단 사항입니다.
            세무사가 <b>귀속월 기준</b>(1월~이 명세서 귀속월 급여와 그 급여의 원천징수세액)으로 처리하도록 확인한 경우에만 체크하세요. 체크하지 않으면 계산하지 않습니다.
          </span>
        </label>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-dark-500">
            <tr>
              <th className="text-left font-medium py-1">귀속월</th>
              <th className="text-right font-medium">과세급여(상여 제외)</th>
              <th className="text-right font-medium">실제 원천징수 소득세</th>
              <th className="text-right font-medium">그 달 상여</th>
              <th className="text-center font-medium">실제 자료와 대조</th>
              <th className="text-left font-medium pl-2">참고</th>
            </tr>
          </thead>
          <tbody>
            {history.map(r => (
              <tr key={r.month} className="border-t border-dark-100" data-testid={`history-${r.month}`}>
                <td className="py-1">{r.month}</td>
                <td className="text-right">
                  <input aria-label={`${r.month} 과세급여`} value={fmt(r.regularTaxable)} onChange={e => update(r.month, { regularTaxable: numOrNull(e.target.value), source: 'edited', verified: false })} className="w-28 px-1.5 py-0.5 border border-dark-200 rounded text-right" />
                </td>
                <td className="text-right">
                  <input aria-label={`${r.month} 원천징수세액`} value={fmt(r.regularTaxWithheld)} onChange={e => update(r.month, { regularTaxWithheld: numOrNull(e.target.value), source: 'edited', verified: false })} className="w-24 px-1.5 py-0.5 border border-dark-200 rounded text-right" />
                </td>
                <td className="text-right">
                  <input aria-label={`${r.month} 상여`} value={fmt(r.bonusPaid)} onChange={e => update(r.month, { bonusPaid: numOrNull(e.target.value) ?? 0, source: 'edited', verified: false })} className="w-24 px-1.5 py-0.5 border border-dark-200 rounded text-right" />
                </td>
                <td className="text-center">
                  <input type="checkbox" aria-label={`${r.month} 확인`} checked={r.verified} onChange={e => update(r.month, { verified: e.target.checked })} />
                </td>
                <td className="pl-2 text-dark-400">{r.flags.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-dark-400">저장된 명세서 값은 '미확인'으로 불러옵니다. 원천세 신고서·확정 급여대장과 맞는지 확인한 달만 체크하세요.</p>

      {calc.errors.length > 0 && (
        <ul className="list-disc pl-4 text-red-600" data-testid="bonus-errors">
          {calc.errors.map(e => <li key={e}>{e}</li>)}
        </ul>
      )}
      {calc.steps.length > 0 && (
        <ol className="list-decimal pl-4 text-dark-600" data-testid="bonus-steps">
          {calc.steps.map(s => <li key={s}>{s}</li>)}
        </ol>
      )}
      {calc.warnings.length > 0 && (
        <ul className="list-disc pl-4 text-warning-700" data-testid="bonus-warnings">
          {calc.warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  )
}

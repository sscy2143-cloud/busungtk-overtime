import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Save, AlertTriangle, X, ChevronUp, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { calculateOvertimeBreakdown } from '../../utils/overtime-calc'
import { monthRange, countBusinessDays, formatHours } from './payslip-constants'
import type { InsuranceRow } from '../../utils/insurance-csv'
import { STORED_TAX_STATUS_LABEL, WITHHOLDING_MULTIPLIER, applyIncomeTax, calcIncomeTax, classifyStoredTax, isBonusLabel, isTaxFreeCandidateLabel } from '../../utils/payroll-deductions'
import { calcBonusSlipTax, neededHistoryMonths, ymAdd } from '../../utils/bonus-withholding'
import { BonusTaxInputs, type HistoryRow } from './BonusTaxInputs'
import { PayslipView, Watermark, type PayslipLineItem } from './PayslipView'
import { DEFAULT_CALC_FORMULAS } from './payslip-constants'

export interface GeneratorEmployee {
  id: string
  name: string
  department: string
  hourly_wage: number
  hire_date: string | null
}

interface PayslipGeneratorPanelProps {
  employees: GeneratorEmployee[]
  period: string
  onSaved?: () => void
  /** 제공하면 직원 선택 드롭다운 대신 외부(예: 급여대장 목록)에서 선택을 제어 */
  empId?: string
  onEmpIdChange?: (id: string) => void
  /** 외부(급여대장 상단)에서 한 번 업로드한 4대보험 고지내역 — 직원명으로 매칭돼 공제항목에 자동입력 */
  healthInsuranceData?: Record<string, InsuranceRow>
  /** 어떤 4대보험 고지내역 CSV가 업로드됐는지 — 업로드 안 된 항목은 추정하지 않고 "자료 없음"으로 표시,
   *  고용보험은 업로드됐는데 그 직원이 명단에 없으면 비대상으로 간주해 0원 처리 */
  insuranceCsvStatus?: { nationalPension: boolean; health: boolean; employment: boolean }
  /** 저장 안 된 변경사항 여부가 바뀔 때마다 알려줌 — 외부에서 직원 전환 시 확인창 띄우는 용도 */
  onDirtyChange?: (dirty: boolean) => void
}

interface OvertimeRequestRow {
  id: string
  date: string
  planned_start: string
  planned_end: string
  site_name?: string | null
  reason?: string | null
}

interface DrillPopupState {
  type: 'extended' | 'night' | 'holiday'
  records: Array<{
    r: OvertimeRequestRow
    bd: ReturnType<typeof calculateOvertimeBreakdown>
    minutes: number
  }>
}

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토']
const DRILL_LABEL: Record<string, DrillPopupState['type']> = {
  '연장근로수당': 'extended',
  '야간근로수당': 'night',
  '휴일근로수당': 'holiday',
}
const DRILL_TYPE_LABEL: Record<DrillPopupState['type'], string> = {
  extended: '연장근로',
  night: '야간근로',
  holiday: '휴일근로',
}

interface GeneratedPayslipRow {
  id: string
  work_start: string | null
  work_end: string | null
  message: string | null
  file_path: string | null
  admin_note: string | null
  유형?: string
  지급내역?: Array<{ 항목: string; 금액: number; 시간?: number }>
  공제내역?: SavedDeductionLine[]
}

// 근로소득세 줄의 상여 계산 근거 (공제내역 JSON에 함께 저장 — 스키마 변경 없음)
interface BonusTaxBasis {
  방식: '상여(시행령195조)'
  비율: number
  상여지급일: string
  지급대상기간: Record<string, number | null>
  /** 일반 급여 지급일 */
  급여지급일?: string
  /** 상여·급여 지급일이 달라 귀속월 기준 계산을 세무사가 확인했다고 체크했는가 */
  귀속월기준_세무확인?: boolean
  일반: number
  상여: number
  기준자료: Array<{ month: string; regularTaxable: number | null; regularTaxWithheld: number | null; bonusPaid: number; verified: boolean }>
}
interface SavedDeductionLine { 항목: string; 금액: number; 산출근거?: BonusTaxBasis }

/**
 * 이전 달 저장 명세서 → 상여 계산용 자료 한 줄. 저장값이 실제 원천징수·신고액이라는 보장이 없으므로 항상 미확인으로 시작한다.
 * 그 달에 상여가 있었는데 일반·상여 세액 구분 근거가 없으면 일반급여분 세액을 알 수 없으므로 비워 둔다(직접 입력).
 */
function slipToHistoryRow(month: string, slip: { 지급내역: Array<{ 항목: string; 금액: number }> | null; 공제내역: SavedDeductionLine[] | null } | undefined): HistoryRow {
  if (!slip?.지급내역?.length) {
    return { month, regularTaxable: null, regularTaxWithheld: null, bonusPaid: 0, verified: false, source: 'none', flags: ['저장된 명세서 없음 — 실제 급여대장·원천세 신고 자료로 입력'] }
  }
  const regularTaxable = slip.지급내역.filter(p => !isBonusLabel(p.항목)).reduce((s, p) => s + (p.금액 || 0), 0)
  const bonusPaid = slip.지급내역.filter(p => isBonusLabel(p.항목)).reduce((s, p) => s + (p.금액 || 0), 0)
  const taxLine = (slip.공제내역 ?? []).find(d => d.항목 === '근로소득세')
  const regularTaxWithheld = taxLine == null ? null : taxLine.산출근거 ? taxLine.산출근거.일반 : bonusPaid > 0 ? null : taxLine.금액
  const flags = ['저장된 명세서 값']
  if (taxLine == null) flags.push('근로소득세 줄 없음')
  else if (regularTaxWithheld == null) flags.push('상여 있던 달 — 일반급여분 세액 직접 입력')
  if (regularTaxWithheld === 0 && regularTaxable >= 10_000_000) flags.push('0원 저장(1천만원 이상 오류 의심)')
  const taxFree = slip.지급내역.filter(p => (p.금액 || 0) !== 0 && isTaxFreeCandidateLabel(p.항목)).map(p => p.항목)
  if (taxFree.length) flags.push(`비과세 가능 항목(${taxFree.join(', ')}) 포함 — 과세급여에서 비과세 금액을 빼고 입력`)
  return { month, regularTaxable, regularTaxWithheld, bonusPaid, verified: false, source: 'saved', flags }
}

const DEFAULT_DEDUCTION_LABELS = ['근로소득세', '근로지방소득세', '국민연금', '건강보험', '장기요양보험', '고용보험']

const wonText = (n: number | null) => n == null ? '—' : `${n.toLocaleString('ko-KR')}원`

function defaultPayDate(period: string) {
  const [y, m] = period.split('-').map(Number)
  const payY = m === 12 ? y + 1 : y
  const payM = m === 12 ? 1 : m + 1
  return `${payY}-${String(payM).padStart(2, '0')}-15`
}

function numOrNull(s: string): number | null {
  const n = Number(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

// 시간 스테퍼로 조절 가능한 항목의 시간당 배율 (연장/휴일 150%, 야간 200% — 근로기준법 가산율 기준)
const HOURLY_RATE_MULTIPLIER: Record<string, number> = {
  '연장근로수당': 1.5,
  '야간근로수당': 2.0,
  '휴일근로수당': 1.5,
}

function LineItemEditor({
  title, items, onChange, employeeName, onDrill, hourlyWage, originalHours, noDataLabels, checkLabels,
}: { title: string; items: PayslipLineItem[]; onChange: (items: PayslipLineItem[]) => void; employeeName?: string; onDrill?: (label: string) => void; hourlyWage?: number; originalHours?: Record<string, number>; noDataLabels?: Record<string, boolean>; checkLabels?: Record<string, boolean> }) {
  const total = items.reduce((s, i) => s + (i.amount || 0), 0)

  function adjustHours(i: number, delta: number) {
    const item = items[i]
    const rate = HOURLY_RATE_MULTIPLIER[item.label]
    if (!rate) return
    const nextHours = Math.max(0, Math.round(((item.hours ?? 0) + delta) * 2) / 2)
    const nextAmount = Math.round(nextHours * rate * (hourlyWage ?? 0))
    onChange(items.map((it, idx) => idx === i ? { ...it, hours: nextHours, amount: nextAmount } : it))
  }

  return (
    <div className="relative border border-dark-200 rounded-xl overflow-hidden">
      <Watermark text={employeeName ?? ''} size="small" />
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-2.5 bg-dark-50 border-b border-dark-100">
          <span className="text-sm font-semibold text-dark-700">{title}</span>
          <span className="text-sm font-bold text-dark-800">{total.toLocaleString('ko-KR')}</span>
        </div>
        <div className="divide-y divide-dark-50">
          {items.map((item, i) => {
            const hasRate = !!HOURLY_RATE_MULTIPLIER[item.label]
            const isModified = hasRate && Math.abs((item.hours ?? 0) - (originalHours?.[item.label] ?? 0)) > 0.001
            return (
            <div key={i} className="flex items-center gap-2 px-3 py-2">
              <input
                type="text"
                value={item.label}
                onChange={e => onChange(items.map((it, idx) => idx === i ? { ...it, label: e.target.value } : it))}
                placeholder="항목명"
                className="flex-1 min-w-0 basis-0 px-2 py-1.5 text-xs border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
              {hasRate ? (
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`w-10 text-right text-xs tabular-nums ${isModified ? 'text-amber-500' : 'text-dark-600'}`}>{(item.hours ?? 0).toFixed(1)}h</span>
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => adjustHours(i, 0.5)}
                      className="p-0.5 text-dark-400 hover:text-primary-600 hover:bg-primary-50 rounded-t"
                    >
                      <ChevronUp size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustHours(i, -0.5)}
                      className="p-0.5 text-dark-400 hover:text-primary-600 hover:bg-primary-50 rounded-b"
                    >
                      <ChevronDown size={11} />
                    </button>
                  </div>
                </div>
              ) : (
                <span className="w-[52px] shrink-0" />
              )}
              <input
                type="text"
                inputMode="numeric"
                value={item.amount != null ? item.amount.toLocaleString('ko-KR') : ''}
                onChange={e => {
                  const digits = e.target.value.replace(/[^0-9]/g, '')
                  onChange(items.map((it, idx) => idx === i ? { ...it, amount: digits ? Number(digits) : 0 } : it))
                }}
                placeholder="금액"
                className="flex-1 min-w-0 basis-0 px-2 py-1.5 text-xs border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400 text-right"
              />
              {noDataLabels?.[item.label] && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium text-dark-400 bg-dark-100 rounded whitespace-nowrap" title="고지내역 파일을 아직 업로드하지 않았어요">
                  자료 없음
                </span>
              )}
              {checkLabels?.[item.label] && (
                <span data-testid="tax-check-badge" className="px-1.5 py-0.5 text-[10px] font-medium text-red-600 bg-red-50 rounded whitespace-nowrap" title="자동 계산하지 않은 세액 — 직접 확인 필요">
                  계산 확인 필요
                </span>
              )}
              {onDrill && DRILL_LABEL[item.label] && (
                <button
                  type="button"
                  onClick={() => onDrill(item.label)}
                  className="px-1.5 py-1 text-[10px] font-medium text-primary-600 hover:bg-primary-50 rounded whitespace-nowrap"
                >
                  상세
                </button>
              )}
              <button onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="p-1 text-dark-300 hover:text-primary-500">
                <Trash2 size={13} />
              </button>
            </div>
            )
          })}
        </div>
        <button
          onClick={() => onChange([...items, { label: '', amount: 0 }])}
          className="flex items-center gap-1 w-full justify-center px-3 py-2 text-xs text-dark-400 hover:text-primary-600 hover:bg-primary-50 transition-colors border-t border-dark-50"
        >
          <Plus size={12} /> 항목 추가
        </button>
      </div>
    </div>
  )
}

const NO_INSURANCE_CSV_STATUS = { nationalPension: false, health: false, employment: false }

export function PayslipGeneratorPanel({ employees, period, onSaved, empId: controlledEmpId, onEmpIdChange, healthInsuranceData = {}, insuranceCsvStatus = NO_INSURANCE_CSV_STATUS, onDirtyChange }: PayslipGeneratorPanelProps) {
  const { employee: currentUser } = useAuth()
  const isControlled = controlledEmpId !== undefined
  const [internalEmpId, setInternalEmpId] = useState('')
  const empId = isControlled ? controlledEmpId : internalEmpId
  const setEmpId = onEmpIdChange ?? setInternalEmpId
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [migrationReady, setMigrationReady] = useState<boolean | null>(null)
  const [existingId, setExistingId] = useState<string | null>(null)
  const [existingFilePath, setExistingFilePath] = useState<string | null>(null)

  const [lineItemSplitPct, setLineItemSplitPct] = useState(50)
  const lineItemSplitRef = useRef<HTMLDivElement | null>(null)

  function handleLineItemDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    function onMove(ev: MouseEvent) {
      const el = lineItemSplitRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLineItemSplitPct(Math.min(80, Math.max(20, pct)))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const [payDate, setPayDate] = useState(defaultPayDate(period))
  const [hireDate, setHireDate] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [department, setDepartment] = useState('')
  const [position, setPosition] = useState('')
  const [workStart, setWorkStart] = useState(monthRange(period).start)
  const [workEnd, setWorkEnd] = useState(monthRange(period).end)
  const [message, setMessage] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [payments, setPayments] = useState<PayslipLineItem[]>([{ label: '기본급', amount: 0 }])
  const [deductions, setDeductions] = useState<PayslipLineItem[]>(DEFAULT_DEDUCTION_LABELS.map(label => ({ label, amount: 0 })))
  const [autoOvertime, setAutoOvertime] = useState({ extendedMinutes: 0, nightMinutes: 0, holidayMinutes: 0 })
  const [dependents, setDependents] = useState(1)
  // true = 공제항목의 소득세를 자동으로 바꾸지 않음 (저장된 명세서를 연 경우·세액을 직접 고친 경우)
  const [taxLocked, setTaxLocked] = useState(false)
  // 저장된 명세서를 열었을 때의 근로소득세 (0원 오류 의심 등 상태 표시용 — 저장값은 바꾸지 않음)
  const [savedIncomeTax, setSavedIncomeTax] = useState<number | null>(null)
  const [savedTaxLine, setSavedTaxLine] = useState<SavedDeductionLine | null>(null)
  // 상여·성과급 포함 달 계산 자료 (추정하지 않고 담당자가 입력·확인)
  const [bonusPayDate, setBonusPayDate] = useState('')
  const [bonusPeriods, setBonusPeriods] = useState<Record<string, number | null>>({})
  const [accrualConfirmed, setAccrualConfirmed] = useState(false)
  const [taxHistory, setTaxHistory] = useState<HistoryRow[]>([])
  const [rawOvertimeRecords, setRawOvertimeRecords] = useState<OvertimeRequestRow[]>([])
  const [drillPopup, setDrillPopup] = useState<DrillPopupState | null>(null)

  function openDrill(label: string) {
    const type = DRILL_LABEL[label]
    if (!type) return
    const records = rawOvertimeRecords
      .map(r => {
        const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
        const minutes =
          type === 'extended' ? bd.extendedMinutes :
          type === 'night' ? bd.nightMinutes :
          bd.holidayMinutes + bd.holidayOvertimeMinutes + bd.holidayNightMinutes + bd.holidayOvertimeNightMinutes
        return { r, bd, minutes }
      })
      .filter(({ minutes }) => minutes > 0)
      .sort((a, b) => a.r.date.localeCompare(b.r.date))
    setDrillPopup({ type, records })
  }

  const healthInsuranceDataRef = useRef(healthInsuranceData)
  useEffect(() => { healthInsuranceDataRef.current = healthInsuranceData }, [healthInsuranceData])

  // 저장 안 된 변경사항 추적: load()가 값을 채우는 최초 1회는 무시하고,
  // 그 이후 사용자가 실제로 값을 바꿀 때만 변경사항 있음으로 표시
  const [isDirty, setIsDirty] = useState(false)
  const [changedFieldLabels, setChangedFieldLabels] = useState<string[]>([])
  const justLoadedRef = useRef(true)
  const baselineRef = useRef<{
    payments: PayslipLineItem[]
    deductions: PayslipLineItem[]
    workStart: string
    workEnd: string
    message: string
    adminNote: string
    totalWorkDaysText: string
    baseHoursText: string
    leaveHoursText: string
    etcHoursText: string
  } | null>(null)

  function applyHealthInsurance(items: PayslipLineItem[], match: InsuranceRow): PayslipLineItem[] {
    return items.map(d =>
      d.label === '건강보험' && match.health != null ? { ...d, amount: match.health } :
      d.label === '장기요양보험' && match.longTermCare != null ? { ...d, amount: match.longTermCare } :
      d.label === '국민연금' && match.nationalPension != null ? { ...d, amount: match.nationalPension } :
      d.label === '고용보험' && match.employment != null ? { ...d, amount: match.employment } :
      // 고용보험 파일은 대상자만 명단에 오르므로, 그 파일을 올렸는데 이름이 없으면 비대상자로 보고 0원 처리
      d.label === '고용보험' && insuranceCsvStatus.employment && match.employment == null ? { ...d, amount: 0 } :
      d
    )
  }

  useEffect(() => {
    if (!employee) return
    const match = healthInsuranceData[employee.name]
    if (!match) return
    setDeductions(prev => applyHealthInsurance(prev, match))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId, healthInsuranceData])

  // 지급항목이 바뀔 때마다 소득세만 지급총액 기준으로 자동 재계산
  // (근로소득세는 간이세액표상 그 달 월급여액 기준이라 지급총액 변경에 실시간 반영되는 게 맞음.
  //  반면 4대보험(국민연금/건강보험/장기요양보험/고용보험)은 이미 보수월액 기준으로 미리 고지되는
  //  금액이라 지급항목을 바꿀 때마다 재추정해서 덮어쓰면 안 됨 — 최초 생성 시 1회 추정값만 채우고,
  //  이후엔 직접 수정하거나 4대보험 고지내역 CSV 업로드로만 갱신되도록 둠)
  // 저장된 명세서를 열었거나 세액을 직접 고친 경우(taxLocked)에는 자동으로 덮어쓰지 않고,
  // 계산값과 다르면 아래 '근로소득세 점검'에서 차이를 보여준 뒤 [계산값 적용]으로만 바꾼다.
  // 상여·성과급이 있는 달은 시행령 195조 계산(필요 자료 입력 후). 이 계산은 자동 반영하지 않고 [계산값 적용]으로만 반영.
  const bonusLabels = payments.filter(p => (p.amount || 0) !== 0 && isBonusLabel(p.label)).map(p => p.label)
  const hasBonus = bonusLabels.length > 0
  const bonusCalc = hasBonus
    ? calcBonusSlipTax({ period, payments, dependents, bonusPayDate: bonusPayDate || null, bonusPeriods, hireDate: hireDate || null, history: taxHistory, salaryPayDate: payDate || null, accrualBasisConfirmed: accrualConfirmed })
    : null
  const taxCalc = bonusCalc ?? calcIncomeTax(payments, dependents)
  useEffect(() => {
    if (!empId || taxLocked || hasBonus) return
    setDeductions(prev => applyIncomeTax(prev, calcIncomeTax(payments, dependents)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, dependents, taxLocked, hasBonus])

  const currentIncomeTax = deductions.find(d => d.label === '근로소득세')?.amount ?? null
  const currentLocalTax = deductions.find(d => d.label === '근로지방소득세')?.amount ?? null
  const storedTaxStatus = savedIncomeTax == null ? null : classifyStoredTax(savedIncomeTax, taxCalc.incomeTax)
  const taxMismatch = taxCalc.incomeTax != null && (currentIncomeTax !== taxCalc.incomeTax || currentLocalTax !== taxCalc.localTax)

  function handleDeductionsChange(next: PayslipLineItem[]) {
    const changedTax = ['근로소득세', '근로지방소득세'].some(label =>
      next.find(d => d.label === label)?.amount !== deductions.find(d => d.label === label)?.amount)
    if (changedTax) setTaxLocked(true)
    setDeductions(next)
  }

  function applyCalculatedTax() {
    setDeductions(prev => applyIncomeTax(prev, taxCalc))
    setTaxLocked(false)
  }

  // 저장 시 근로소득세 줄에 남길 상여 계산 근거(지급일·지급대상기간·대조한 이전 달 자료). 스키마 변경 없이 같은 JSON에 저장.
  // 다시 열면 이 근거로 같은 계산을 되살려 저장값과 비교한다.
  function taxLineMeta(d: PayslipLineItem): Partial<SavedDeductionLine> {
    if (d.label !== '근로소득세') return {}
    if (bonusCalc && bonusCalc.incomeTax != null && d.amount === bonusCalc.incomeTax) {
      return {
        산출근거: {
          방식: '상여(시행령195조)', 비율: WITHHOLDING_MULTIPLIER, 상여지급일: bonusPayDate, 지급대상기간: bonusPeriods,
          일반: bonusCalc.regularTax ?? 0, 상여: bonusCalc.bonusTax ?? 0,
          급여지급일: payDate,
          ...(bonusCalc.needsAccrualJudgment ? { 귀속월기준_세무확인: accrualConfirmed } : {}),
          기준자료: taxHistory.map(({ month, regularTaxable, regularTaxWithheld, bonusPaid, verified }) => ({ month, regularTaxable, regularTaxWithheld, bonusPaid, verified })),
        },
      }
    }
    if (savedTaxLine?.산출근거 && d.amount === savedTaxLine.금액) return { 산출근거: savedTaxLine.산출근거 }
    return {}
  }

  // 근로시간 통계 (수동입력 — 근태 데이터 미연동 항목)
  const [totalWorkDaysText, setTotalWorkDaysText] = useState('')
  const [baseHoursText, setBaseHoursText] = useState('')
  const [leaveHoursText, setLeaveHoursText] = useState('')
  const [etcHoursText, setEtcHoursText] = useState('')

  useEffect(() => {
    if (justLoadedRef.current) {
      justLoadedRef.current = false
      baselineRef.current = { payments, deductions, workStart, workEnd, message, adminNote, totalWorkDaysText, baseHoursText, leaveHoursText, etcHoursText }
      setChangedFieldLabels([])
      return
    }
    const b = baselineRef.current
    if (!b) return
    const labels: string[] = []
    if (JSON.stringify(payments) !== JSON.stringify(b.payments)) labels.push('지급항목')
    if (JSON.stringify(deductions) !== JSON.stringify(b.deductions)) labels.push('공제항목')
    if (workStart !== b.workStart || workEnd !== b.workEnd) labels.push('근무기간')
    if (message !== b.message) labels.push('전달 문구')
    if (adminNote !== b.adminNote) labels.push('비고')
    if (
      totalWorkDaysText !== b.totalWorkDaysText || baseHoursText !== b.baseHoursText ||
      leaveHoursText !== b.leaveHoursText || etcHoursText !== b.etcHoursText
    ) labels.push('근로시간 통계')
    setChangedFieldLabels(labels)
    setIsDirty(labels.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, deductions, workStart, workEnd, message, adminNote, totalWorkDaysText, baseHoursText, leaveHoursText, etcHoursText])

  useEffect(() => {
    if (!isDirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])

  const employee = employees.find(e => e.id === empId)

  useEffect(() => {
    supabase.from('payslips').select('유형').limit(1).then(({ error }) => setMigrationReady(!error))
  }, [])

  useEffect(() => {
    setDepartment(employee?.department ?? '')
    setHireDate(employee?.hire_date ?? '')
    setPosition('')
  }, [empId, employee])

  useEffect(() => {
    if (!empId || migrationReady === false) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { start, end } = monthRange(period)
      const historyFrom = ymAdd(period, -11)
      const [{ data: slip }, { data: reqs }, { data: compLeave }, payrollInfo, { data: leaves }, { data: pastSlips }] = await Promise.all([
        supabase.from('payslips').select('*').eq('employee_id', empId).eq('period', period).maybeSingle<GeneratedPayslipRow>(),
        supabase.from('overtime_requests').select('*').eq('employee_id', empId).eq('status', 'approved').gte('date', start).lte('date', end).returns<OvertimeRequestRow[]>(),
        supabase.from('substitute_history').select('related_request_id').not('related_request_id', 'is', null).returns<{ related_request_id: string | null }[]>(),
        supabase.from('employee_payroll_info').select('dependents_count, base_salary, birth_date').eq('employee_id', empId).maybeSingle<{ dependents_count: number; base_salary: number; birth_date: string | null }>(),
        supabase.from('leave_requests').select('days').eq('employee_id', empId).eq('status', 'approved').gte('start_date', start).lte('end_date', end).returns<{ days: number }[]>(),
        // 상여 포함 달 계산용 — 직전 11개월 명세서를 읽기만 한다(수정하지 않음)
        supabase.from('payslips').select('period, 지급내역, 공제내역').eq('employee_id', empId).gte('period', historyFrom).lt('period', period)
          .returns<{ period: string; 지급내역: Array<{ 항목: string; 금액: number }> | null; 공제내역: SavedDeductionLine[] | null }[]>(),
      ])
      if (cancelled) return
      justLoadedRef.current = true
      const empDependents = payrollInfo.data?.dependents_count ?? 1
      setDependents(empDependents)
      setBirthDate(payrollInfo.data?.birth_date ?? '')

      // 이 명세서에 상여 계산 근거가 저장돼 있으면 그때 입력·대조한 자료를 그대로 되살린다
      const savedLine = (slip?.지급내역?.length ? (slip.공제내역 ?? []).find(d => d.항목 === '근로소득세') : undefined) ?? null
      const basis = savedLine?.산출근거
      const pastByMonth = new Map((pastSlips ?? []).map(s => [s.period, s]))
      const snapshot = new Map((basis?.기준자료 ?? []).map(r => [r.month, r]))
      setTaxHistory(Array.from({ length: 11 }, (_, i) => {
        const m = ymAdd(historyFrom, i)
        const snap = snapshot.get(m)
        return snap ? { ...snap, source: 'edited' as const, flags: ['저장된 계산 근거'] } : slipToHistoryRow(m, pastByMonth.get(m))
      }))
      setBonusPayDate(basis?.상여지급일 ?? '')
      setBonusPeriods(basis?.지급대상기간 ?? {})
      setAccrualConfirmed(basis?.귀속월기준_세무확인 ?? false)
      if (basis?.급여지급일) setPayDate(basis.급여지급일)
      setSavedTaxLine(savedLine)

      const compLeaveIds = new Set((compLeave ?? []).map(r => r.related_request_id))
      const filteredReqs = (reqs ?? []).filter(r => !compLeaveIds.has(r.id))
      setRawOvertimeRecords(filteredReqs)
      let extendedMinutes = 0, nightMinutes = 0
      let holiday = 0, holidayOT = 0, holidayNight = 0, holidayOTNight = 0
      for (const r of filteredReqs) {
        const bd = calculateOvertimeBreakdown(r.date, r.planned_start, r.planned_end)
        extendedMinutes += bd.extendedMinutes
        nightMinutes += bd.nightMinutes
        holiday += bd.holidayMinutes
        holidayOT += bd.holidayOvertimeMinutes
        holidayNight += bd.holidayNightMinutes
        holidayOTNight += bd.holidayOvertimeNightMinutes
      }
      const holidayMinutes = holiday + holidayOT + holidayNight + holidayOTNight
      setAutoOvertime({ extendedMinutes, nightMinutes, holidayMinutes })

      setAdminNote(slip?.admin_note ?? '')

      // '미작성으로 되돌리기'는 유형만 비우고 지급/공제 내역은 남겨두므로,
      // 유형이 아니라 실제 저장된 지급내역이 있는지로 복원 여부를 판단함
      const hasSavedContent = !!(slip?.지급내역 && slip.지급내역.length > 0)
      if (hasSavedContent && slip) {
        setExistingId(slip.id)
        setExistingFilePath(null)
        setWorkStart(slip.work_start ?? start)
        setWorkEnd(slip.work_end ?? end)
        setMessage(slip.message ?? '')
        const pays = slip.지급내역 ?? []
        const deds = slip.공제내역 ?? []
        // 시간 스테퍼 기능 이전에 저장된 명세서는 지급내역에 시간이 없으므로,
        // 그 경우엔 승인된 야근신청 기준 자동집계 시간으로 대신 채워줌
        const autoHoursByLabel: Record<string, number> = {
          '연장근로수당': extendedMinutes / 60,
          '야간근로수당': nightMinutes / 60,
          '휴일근로수당': holidayMinutes / 60,
        }
        const loadedPayments = pays.length
          ? pays.map(p => ({ label: p.항목, amount: p.금액, hours: p.시간 ?? autoHoursByLabel[p.항목] }))
          : [{ label: '기본급', amount: 0 }]
        setPayments(loadedPayments)
        const baseDeductions = deds.length ? deds.map(d => ({ label: d.항목, amount: d.금액 })) : DEFAULT_DEDUCTION_LABELS.map(label => ({ label, amount: 0 }))
        // 저장된 명세서는 소득세를 포함해 저장된 값을 그대로 보여준다(열기만 해서는 세액이 바뀌지 않음).
        // (이전에는 열 때마다 소득세를 다시 계산해 덮어써서, 직접 고친 세액이 사라졌음)
        // 계산값과 다르면 '근로소득세 점검'에서 차이를 보여주고 [계산값 적용] → 저장으로만 바뀐다.
        // 공제내역이 비어 있는 명세서만 계산값으로 채운다. 4대보험은 저장값 유지(CSV 매칭은 applyHealthInsurance).
        const savedTaxLine = deds.find(d => d.항목 === '근로소득세')
        setSavedIncomeTax(savedTaxLine ? savedTaxLine.금액 : null)
        setTaxLocked(deds.length > 0)
        const liveDeductions = deds.length ? baseDeductions : applyIncomeTax(baseDeductions, calcIncomeTax(loadedPayments, empDependents))
        const savedHealthMatch = employee ? healthInsuranceDataRef.current[employee.name] : undefined
        setDeductions(savedHealthMatch ? applyHealthInsurance(liveDeductions, savedHealthMatch) : liveDeductions)
      } else {
        setExistingId(slip?.id ?? null)
        setExistingFilePath(slip?.file_path ?? null)
        setWorkStart(start)
        setWorkEnd(end)
        setMessage('')
        const wage = employee?.hourly_wage ?? 0
        const holidayPay = (holiday / 60) * wage * 1.5 + (holidayOT / 60) * wage * 2.0 + (holidayNight / 60) * wage * 2.0 + (holidayOTNight / 60) * wage * 2.5
        const autoPayments: PayslipLineItem[] = [
          { label: '기본급', amount: payrollInfo.data?.base_salary ?? 0 },
          { label: '연장근로수당', amount: Math.round((extendedMinutes / 60) * wage * 1.5), hours: extendedMinutes / 60 },
          { label: '야간근로수당', amount: Math.round((nightMinutes / 60) * wage * 2.0), hours: nightMinutes / 60 },
          { label: '휴일근로수당', amount: Math.round(holidayPay), hours: holidayMinutes / 60 },
        ]
        setPayments(autoPayments)
        setSavedIncomeTax(null)
        setTaxLocked(false)
        // 소득세는 라이브 추정치를 기본값으로 채우되, 4대보험은 실제 고지내역(CSV) 없이는
        // 추정하지 않고 0으로 시작 — 아래 applyHealthInsurance에서 CSV 매칭 시에만 채워짐
        const defaultDeductions = applyIncomeTax(DEFAULT_DEDUCTION_LABELS.map(label => ({ label, amount: 0 })), calcIncomeTax(autoPayments, empDependents))
        const healthMatch = employee ? healthInsuranceDataRef.current[employee.name] : undefined
        setDeductions(healthMatch ? applyHealthInsurance(defaultDeductions, healthMatch) : defaultDeductions)
      }
      // 근태 데이터가 없어 정확한 출퇴근 기록은 없지만, 소정근로일(평일·공휴일 제외)에서
      // 승인된 휴가일수를 뺀 값으로 기본값을 채워줌 (필요시 직접 수정 가능)
      const businessDays = countBusinessDays(start, end)
      const leaveDays = (leaves ?? []).reduce((s, l) => s + (l.days || 0), 0)
      const defaultWorkDays = Math.max(0, businessDays - leaveDays)
      const defaultBaseHours = defaultWorkDays * 8
      setTotalWorkDaysText(`${defaultWorkDays}일`)
      setBaseHoursText(formatHours(defaultBaseHours))
      setLeaveHoursText(leaveDays > 0 ? formatHours(leaveDays * 8) : '')
      setEtcHoursText('')
      setIsDirty(false)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [empId, period, migrationReady])

  const calcMethods = payments
    .filter(p => DEFAULT_CALC_FORMULAS[p.label])
    .map(p => ({ label: p.label, formula: DEFAULT_CALC_FORMULAS[p.label] }))

  const totalPaymentSummary = payments.reduce((s, p) => s + (p.amount || 0), 0)
  const totalDeductionSummary = deductions.reduce((s, d) => s + (d.amount || 0), 0)
  const netPaySummary = totalPaymentSummary - totalDeductionSummary

  // 근로시간 통계: 연장/야간/휴일은 지급항목의 시간 스테퍼 값을 그대로 따라가고,
  // 총 근로시간은 기본근로시간 + 연장 + 휴일로 자동 합산됨(시간 스테퍼 조정 시 실시간 반영)
  const liveExtendedHours = payments.find(p => p.label === '연장근로수당')?.hours ?? 0
  const liveNightHours = payments.find(p => p.label === '야간근로수당')?.hours ?? 0
  const liveHolidayHours = payments.find(p => p.label === '휴일근로수당')?.hours ?? 0
  const liveTotalHours = (Number(baseHoursText) || 0) + liveExtendedHours + liveHolidayHours

  async function handleSave() {
    if (!empId) return
    setSaving(true)
    if (existingFilePath) {
      await supabase.storage.from('payslips').remove([existingFilePath])
    }
    const 지급합계 = payments.reduce((s, p) => s + (p.amount || 0), 0)
    const 공제합계 = deductions.reduce((s, d) => s + (d.amount || 0), 0)
    const payload = {
      employee_id: empId,
      period,
      지급내역: payments.filter(p => p.label).map(p => ({ 항목: p.label, 금액: p.amount || 0, 시간: p.hours })),
      공제내역: deductions.filter(d => d.label).map(d => ({ 항목: d.label, 금액: d.amount || 0, ...taxLineMeta(d) })),
      지급합계,
      공제합계,
      실지급액: 지급합계 - 공제합계,
      유형: 'generated',
      file_path: null,
      file_name: null,
      work_start: workStart || null,
      work_end: workEnd || null,
      message: message.trim() || null,
      admin_note: adminNote.trim() || null,
      uploaded_by: currentUser?.id,
    }
    const { error } = existingId
      ? await supabase.from('payslips').update(payload).eq('id', existingId)
      : await supabase.from('payslips').insert(payload)

    setSaving(false)
    if (error) {
      alert('저장에 실패했습니다. 잠시 후 다시 시도해주세요.')
      return
    }
    setExistingFilePath(null)
    setIsDirty(false)
    setChangedFieldLabels([])
    baselineRef.current = { payments, deductions, workStart, workEnd, message, adminNote, totalWorkDaysText, baseHoursText, leaveHoursText, etcHoursText }
    alert('저장되었습니다.')
    onSaved?.()
  }

  if (migrationReady === false) {
    return (
      <div className="flex items-start gap-2 bg-warning-50 border border-warning-200 rounded-xl px-4 py-3 text-xs text-warning-700">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <span>DB 마이그레이션이 아직 실행되지 않았습니다. <code>supabase/migrations/20260811000000_payslip_generated_fields.sql</code>을 Supabase에서 먼저 실행해주세요.</span>
      </div>
    )
  }

  return (
    <div className="space-y-4 min-w-0 overflow-x-auto">
      {!isControlled && (
        <div className="bg-white rounded-xl border border-dark-200 p-4 flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-dark-600">직원</label>
          <select
            value={empId}
            onChange={e => setEmpId(e.target.value)}
            className="px-3 py-2 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
          >
            <option value="">선택</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.department})</option>)}
          </select>
          {employee && !employee.hourly_wage && (
            <span className="text-xs text-warning-600">시급 미설정 — 수당 자동계산이 0원입니다. 직접 입력해주세요.</span>
          )}
        </div>
      )}
      {isControlled && employee && !employee.hourly_wage && (
        <div className="text-xs text-warning-600">시급 미설정 — 수당 자동계산이 0원입니다. 직접 입력해주세요.</div>
      )}

      {Object.keys(healthInsuranceData).length > 0 && employee && !healthInsuranceData[employee.name] && (
        <div className="text-xs text-warning-600">업로드된 4대보험 고지내역에서 이 직원은 매칭되지 않았어요 — 공제항목을 직접 확인해주세요.</div>
      )}

      {!empId ? (
        <div className="bg-white rounded-2xl border border-dark-100 py-16 text-center text-sm text-dark-400">직원을 선택해주세요</div>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-dark-100 py-16 text-center text-sm text-dark-400">불러오는 중...</div>
      ) : (
        <>
          {existingFilePath && (
            <div className="flex items-start gap-2 bg-warning-50 border border-warning-200 rounded-xl px-4 py-3 text-xs text-warning-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>이 직원·기간에 이미 업로드된 파일 명세서가 있습니다. 저장하면 <b>파일이 삭제되고 생성형으로 대체</b>됩니다.</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-dark-200 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-dark-700">실지급액</span>
            <span className="text-lg font-bold text-dark-900">{netPaySummary.toLocaleString('ko-KR')}원</span>
          </div>

          <div ref={lineItemSplitRef} className="flex items-start w-full">
            <div style={{ width: `${lineItemSplitPct}%` }} className="min-w-0 pr-2">
              <LineItemEditor
                title="지급항목"
                items={payments}
                onChange={setPayments}
                employeeName={employee?.name}
                onDrill={openDrill}
                hourlyWage={employee?.hourly_wage}
                originalHours={{
                  '연장근로수당': autoOvertime.extendedMinutes / 60,
                  '야간근로수당': autoOvertime.nightMinutes / 60,
                  '휴일근로수당': autoOvertime.holidayMinutes / 60,
                }}
              />
            </div>
            <div
              onMouseDown={handleLineItemDividerMouseDown}
              className="w-1.5 self-stretch shrink-0 cursor-col-resize bg-dark-100 hover:bg-primary-300 active:bg-primary-400 rounded-full transition-colors"
              title="드래그해서 비율 조정"
            />
            <div style={{ width: `${100 - lineItemSplitPct}%` }} className="min-w-0 pl-2">
              <LineItemEditor
                title="공제항목"
                items={deductions}
                onChange={handleDeductionsChange}
                employeeName={employee?.name}
                checkLabels={{
                  '근로소득세': taxCalc.holdReason != null,
                  '근로지방소득세': taxCalc.holdReason != null,
                }}
                noDataLabels={{
                  '국민연금': !insuranceCsvStatus.nationalPension,
                  '건강보험': !insuranceCsvStatus.health,
                  '장기요양보험': !insuranceCsvStatus.health,
                  '고용보험': !insuranceCsvStatus.employment,
                }}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-dark-200 p-4 space-y-2 text-xs" data-testid="income-tax-check">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-dark-700">근로소득세 점검</span>
              {storedTaxStatus && (
                <span data-testid="stored-tax-status" className={`px-2 py-0.5 rounded text-[11px] font-medium ${storedTaxStatus === 'matches' || storedTaxStatus === 'legit_zero' ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700'}`}>
                  저장된 세액: {STORED_TAX_STATUS_LABEL[storedTaxStatus]}
                </span>
              )}
            </div>
            <p className="text-dark-500" data-testid="calc-income-tax">
              계산값({bonusCalc ? '상여 포함 달 · 시행령 195조' : `지급합계 ${wonText(taxCalc.totalPayment)} · 간이세액표`} · {Math.round(WITHHOLDING_MULTIPLIER * 100)}%):{' '}
              근로소득세 <b className="text-dark-700">{wonText(taxCalc.incomeTax)}</b> / 지방소득세 <b className="text-dark-700">{wonText(taxCalc.localTax)}</b>
            </p>
            {taxCalc.holdReason === 'bonus' && (
              <p role="alert" className="text-red-600" data-testid="tax-hold-bonus">
                계산 확인 필요 — 상여·성과급이 포함된 달은 지급합계만으로 법정 세액이 정해지지 않습니다(지급대상기간 평균 계산). 아래 계산 자료를 입력·확인하면 계산됩니다. 0원은 정상 세액이 아닙니다.
              </p>
            )}
            {bonusCalc && (
              <BonusTaxInputs
                bonusLabels={bonusLabels}
                bonusPayDate={bonusPayDate}
                onBonusPayDateChange={setBonusPayDate}
                periods={bonusPeriods}
                onPeriodsChange={setBonusPeriods}
                accrualConfirmed={accrualConfirmed}
                onAccrualConfirmedChange={setAccrualConfirmed}
                history={taxHistory.filter(r => neededHistoryMonths(period, bonusPeriods).includes(r.month))}
                onHistoryChange={rows => setTaxHistory(prev => prev.map(r => rows.find(x => x.month === r.month) ?? r))}
                calc={bonusCalc}
              />
            )}
            {taxCalc.holdReason === 'taxfree' && (
              <p role="alert" className="text-red-600" data-testid="tax-hold-taxfree">
                계산 확인 필요 — 비과세가 될 수 있는 항목(식대·자가운전보조금·보육수당 등)이 있습니다. 비과세 금액은 과세급여에서 빼야 하는데 이 화면에서는 뺄 수 없어 근로소득세를 자동 계산하지 않았습니다. 세액을 직접 확인·입력해 주세요.
              </p>
            )}
            {taxCalc.holdReason === 'invalid' && (
              <p role="alert" className="text-red-600" data-testid="tax-hold-invalid">
                계산 확인 필요 — 지급 금액을 확인할 수 없어 근로소득세를 자동 계산하지 못했습니다. 0원으로 채우지 않았으니 금액을 확인해 주세요.
              </p>
            )}
            {taxMismatch && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-warning-700" data-testid="tax-mismatch">
                <span>
                  공제항목의 세액({wonText(currentIncomeTax)} / {wonText(currentLocalTax)})은 {taxLocked ? '저장된 값이거나 직접 입력한 값이라 자동으로 바꾸지 않았습니다' : '계산값과 다릅니다'}.
                  {' '}계산값({wonText(taxCalc.incomeTax)} / {wonText(taxCalc.localTax)})으로 바꾸려면 [계산값 적용]을 누른 뒤 저장하세요. 누르기 전에는 공제합계·실지급액이 바뀌지 않습니다.
                </span>
                <button type="button" onClick={applyCalculatedTax} className="px-2.5 py-1 font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600">계산값 적용</button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-dark-200 p-4 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-dark-500 block mb-1">급여지급일</label>
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs text-dark-500 block mb-1">입사일자</label>
              <input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs text-dark-500 block mb-1">부서</label>
              <input type="text" value={department} onChange={e => setDepartment(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs text-dark-500 block mb-1">직위</label>
              <input type="text" value={position} onChange={e => setPosition(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs text-dark-500 block mb-1">근무기간 시작</label>
              <input type="date" value={workStart} onChange={e => setWorkStart(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs text-dark-500 block mb-1">근무기간 종료</label>
              <input type="date" value={workEnd} onChange={e => setWorkEnd(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
            </div>
            <div className="col-span-2 sm:col-span-2">
              <label className="text-xs text-dark-500 block mb-1">전달 문구</label>
              <input type="text" value={message} onChange={e => setMessage(e.target.value)} placeholder="직원에게 전달할 문구" className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-dark-200 p-4">
            <p className="text-xs font-semibold text-dark-600 mb-3">
              근로시간 통계 <span className="font-normal text-dark-400">(연장·야간·휴일은 승인된 야근신청에서 자동계산 / 근무일수·근로시간은 소정근로일 기준 기본값 자동입력, 필요시 직접 수정)</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-dark-500 block mb-1">총 근무일수</label>
                <input type="text" value={totalWorkDaysText} onChange={e => setTotalWorkDaysText(e.target.value)} placeholder="예: 22일" className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">총 근로시간(h)</label>
                <div className="px-2 py-1.5 text-xs bg-dark-50 border border-dark-100 rounded-lg text-dark-500">{formatHours(liveTotalHours)}h (자동)</div>
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">기본근로시간(h)</label>
                <input type="number" value={baseHoursText} onChange={e => setBaseHoursText(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">연장근로시간</label>
                <div className="px-2 py-1.5 text-xs bg-dark-50 border border-dark-100 rounded-lg text-dark-500">{liveExtendedHours.toFixed(1)}h (자동)</div>
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">야간근로시간</label>
                <div className="px-2 py-1.5 text-xs bg-dark-50 border border-dark-100 rounded-lg text-dark-500">{liveNightHours.toFixed(1)}h (자동)</div>
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">휴일근로시간</label>
                <div className="px-2 py-1.5 text-xs bg-dark-50 border border-dark-100 rounded-lg text-dark-500">{liveHolidayHours.toFixed(1)}h (자동)</div>
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">휴가(h)</label>
                <input type="number" value={leaveHoursText} onChange={e => setLeaveHoursText(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">기타(h)</label>
                <input type="number" value={etcHoursText} onChange={e => setEtcHoursText(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-dark-500 block mb-1">비고 <span className="text-dark-300">(관리자만 확인 — 직원에게 안 보임)</span></label>
              <textarea
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                rows={2}
                placeholder="나만 볼 메모"
                className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 bg-primary-50/30"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {isDirty && (
              <div className="text-right">
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                  <AlertTriangle size={13} />
                  저장하지 않은 변경사항이 있습니다
                </span>
                {changedFieldLabels.length > 0 && (
                  <p className="text-[11px] text-dark-400 mt-0.5">수정됨: {changedFieldLabels.join(', ')}</p>
                )}
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-40 transition-colors"
            >
              <Save size={14} />
              {saving ? '저장 중...' : existingId ? '수정 저장' : '저장'}
            </button>
          </div>

          <div className="border-t border-dark-100 pt-4">
            <p className="text-xs text-dark-400 mb-2">미리보기</p>
            <PayslipView
              period={period}
              payDate={payDate}
              employeeName={employee?.name ?? ''}
              birthDate={birthDate}
              department={department}
              position={position}
              hireDate={hireDate}
              workStart={workStart}
              workEnd={workEnd}
              payments={payments.filter(p => p.label)}
              deductions={deductions.filter(d => d.label)}
              workStats={{
                totalWorkDays: totalWorkDaysText || null,
                totalMinutes: Math.round(liveTotalHours * 60),
                baseMinutes: numOrNull(baseHoursText) != null ? numOrNull(baseHoursText)! * 60 : null,
                extendedMinutes: Math.round(liveExtendedHours * 60),
                nightMinutes: Math.round(liveNightHours * 60),
                holidayMinutes: Math.round(liveHolidayHours * 60),
                leaveMinutes: numOrNull(leaveHoursText) != null ? numOrNull(leaveHoursText)! * 60 : null,
                etcMinutes: numOrNull(etcHoursText) != null ? numOrNull(etcHoursText)! * 60 : null,
              }}
              calcMethods={calcMethods}
              message={message}
            />
          </div>
        </>
      )}

      {drillPopup && (() => {
        const totalMinutes = drillPopup.records.reduce((s, { minutes }) => s + minutes, 0)
        const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60
        const [py, pm] = period.split('-')
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDrillPopup(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
                <div>
                  <p className="text-base font-bold text-dark-900">{employee?.name}</p>
                  <p className="text-xs text-dark-400 mt-0.5">{py}년 {parseInt(pm, 10)}월 {DRILL_TYPE_LABEL[drillPopup.type]} 상세</p>
                </div>
                <button onClick={() => setDrillPopup(null)} className="p-1.5 rounded-lg hover:bg-dark-100"><X size={18} className="text-dark-500" /></button>
              </div>
              <div className="overflow-y-auto flex-1 divide-y divide-dark-50">
                {drillPopup.records.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-dark-400">해당 기간 내역이 없습니다</p>
                ) : drillPopup.records.map(({ r, bd, minutes }) => {
                  const dow = DOW_KO[new Date(r.date + 'T00:00:00+09:00').getDay()]
                  const mh = Math.floor(minutes / 60), mm = minutes % 60
                  return (
                    <div key={r.id} className="px-5 py-3.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-dark-800">{r.date.slice(5).replace('-', '/')} ({dow})</span>
                        <span className="text-sm font-bold text-primary-600">{mm === 0 ? `${mh}시간` : `${mh}시간 ${mm}분`}</span>
                      </div>
                      <div className="text-xs text-dark-500 mb-0.5">
                        {r.planned_start} ~ {r.planned_end}
                        {bd.isHoliday && <span className="ml-2 text-primary-500 font-medium">휴일</span>}
                      </div>
                      {(r.site_name || r.reason) && (
                        <p className="text-xs text-dark-400 truncate">{r.site_name ? `[${r.site_name}] ` : ''}{r.reason}</p>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="px-5 py-3 border-t border-dark-100 flex items-center justify-between bg-dark-50 rounded-b-2xl">
                <span className="text-xs font-semibold text-dark-600">총 {drillPopup.records.length}건</span>
                <span className="text-sm font-bold text-dark-800">{m === 0 ? `${h}시간` : `${h}시간 ${m}분`}</span>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

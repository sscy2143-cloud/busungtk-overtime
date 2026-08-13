import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Save, AlertTriangle, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { calculateOvertimeBreakdown } from '../../utils/overtime-calc'
import type { InsuranceRow } from '../../utils/insurance-csv'
import { calculateAutoDeductions } from '../../utils/payroll-deductions'
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
  유형?: string
  지급내역?: Array<{ 항목: string; 금액: number }>
  공제내역?: Array<{ 항목: string; 금액: number }>
}

const DEFAULT_DEDUCTION_LABELS = ['근로소득세', '근로지방소득세', '국민연금', '건강보험', '장기요양보험', '고용보험']

function monthRange(period: string) {
  const [y, m] = period.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, '0')}` }
}

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

function LineItemEditor({
  title, items, onChange, employeeName, onDrill,
}: { title: string; items: PayslipLineItem[]; onChange: (items: PayslipLineItem[]) => void; employeeName?: string; onDrill?: (label: string) => void }) {
  const total = items.reduce((s, i) => s + (i.amount || 0), 0)
  return (
    <div className="relative border border-dark-200 rounded-xl overflow-hidden">
      <Watermark text={employeeName ?? ''} size="small" />
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-2.5 bg-dark-50 border-b border-dark-100">
          <span className="text-sm font-semibold text-dark-700">{title}</span>
          <span className="text-sm font-bold text-dark-800">{total.toLocaleString('ko-KR')}</span>
        </div>
        <div className="divide-y divide-dark-50">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2">
              <input
                type="text"
                value={item.label}
                onChange={e => onChange(items.map((it, idx) => idx === i ? { ...it, label: e.target.value } : it))}
                placeholder="항목명"
                className="flex-1 min-w-0 basis-0 px-2 py-1.5 text-xs border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
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
          ))}
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

export function PayslipGeneratorPanel({ employees, period, onSaved, empId: controlledEmpId, onEmpIdChange, healthInsuranceData = {} }: PayslipGeneratorPanelProps) {
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
  const [department, setDepartment] = useState('')
  const [position, setPosition] = useState('')
  const [workStart, setWorkStart] = useState(monthRange(period).start)
  const [workEnd, setWorkEnd] = useState(monthRange(period).end)
  const [message, setMessage] = useState('')
  const [payments, setPayments] = useState<PayslipLineItem[]>([{ label: '기본급', amount: 0 }])
  const [deductions, setDeductions] = useState<PayslipLineItem[]>(DEFAULT_DEDUCTION_LABELS.map(label => ({ label, amount: 0 })))
  const [autoOvertime, setAutoOvertime] = useState({ extendedMinutes: 0, nightMinutes: 0, holidayMinutes: 0 })
  const [dependents, setDependents] = useState(1)
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

  function applyHealthInsurance(items: PayslipLineItem[], match: InsuranceRow): PayslipLineItem[] {
    return items.map(d =>
      d.label === '건강보험' && match.health != null ? { ...d, amount: match.health } :
      d.label === '장기요양보험' && match.longTermCare != null ? { ...d, amount: match.longTermCare } :
      d.label === '국민연금' && match.nationalPension != null ? { ...d, amount: match.nationalPension } :
      d.label === '고용보험' && match.employment != null ? { ...d, amount: match.employment } :
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

  // 지급항목이 바뀔 때마다 4대보험·세금 공제항목을 지급총액 기준으로 자동 재계산
  // (직전 참고 프로그램 검증 결과: 국민연금/건강보험/장기요양보험/고용보험/근로소득세/지방소득세 모두 그 달 지급총액 기준 라이브 계산)
  useEffect(() => {
    if (!empId) return
    const totalPayment = payments.reduce((s, p) => s + (p.amount || 0), 0)
    const auto = calculateAutoDeductions(totalPayment, dependents)
    setDeductions(prev => {
      const next = prev.map(d => d.label in auto ? { ...d, amount: auto[d.label as keyof typeof auto] } : d)
      const match = employee ? healthInsuranceDataRef.current[employee.name] : undefined
      return match ? applyHealthInsurance(next, match) : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments])

  // 근로시간 통계 (수동입력 — 근태 데이터 미연동 항목)
  const [totalWorkDaysText, setTotalWorkDaysText] = useState('')
  const [totalHoursText, setTotalHoursText] = useState('')
  const [baseHoursText, setBaseHoursText] = useState('')
  const [leaveHoursText, setLeaveHoursText] = useState('')
  const [etcHoursText, setEtcHoursText] = useState('')

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
      const [{ data: slip }, { data: reqs }, { data: compLeave }, payrollInfo] = await Promise.all([
        supabase.from('payslips').select('*').eq('employee_id', empId).eq('period', period).maybeSingle<GeneratedPayslipRow>(),
        supabase.from('overtime_requests').select('*').eq('employee_id', empId).eq('status', 'approved').gte('date', start).lte('date', end).returns<OvertimeRequestRow[]>(),
        supabase.from('substitute_history').select('related_request_id').not('related_request_id', 'is', null).returns<{ related_request_id: string | null }[]>(),
        supabase.from('employee_payroll_info').select('dependents_count, base_salary').eq('employee_id', empId).maybeSingle<{ dependents_count: number; base_salary: number }>(),
      ])
      if (cancelled) return
      const empDependents = payrollInfo.data?.dependents_count ?? 1
      setDependents(empDependents)

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

      const generated = slip?.유형 === 'generated'
      if (generated && slip) {
        setExistingId(slip.id)
        setExistingFilePath(null)
        setWorkStart(slip.work_start ?? start)
        setWorkEnd(slip.work_end ?? end)
        setMessage(slip.message ?? '')
        const pays = slip.지급내역 ?? []
        const deds = slip.공제내역 ?? []
        const loadedPayments = pays.length ? pays.map(p => ({ label: p.항목, amount: p.금액 })) : [{ label: '기본급', amount: 0 }]
        setPayments(loadedPayments)
        const loadedTotal = loadedPayments.reduce((s, p) => s + (p.amount || 0), 0)
        const autoDed = calculateAutoDeductions(loadedTotal, empDependents)
        const baseDeductions = deds.length ? deds.map(d => ({ label: d.항목, amount: d.금액 })) : DEFAULT_DEDUCTION_LABELS.map(label => ({ label, amount: 0 }))
        const liveDeductions = baseDeductions.map(d => d.label in autoDed ? { ...d, amount: autoDed[d.label as keyof typeof autoDed] } : d)
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
          { label: '연장근로수당', amount: Math.round((extendedMinutes / 60) * wage * 1.5) },
          { label: '야간근로수당', amount: Math.round((nightMinutes / 60) * wage * 2.0) },
          { label: '휴일근로수당', amount: Math.round(holidayPay) },
        ]
        setPayments(autoPayments)
        const totalPayment = autoPayments.reduce((s, p) => s + (p.amount || 0), 0)
        const auto = calculateAutoDeductions(totalPayment, empDependents)
        const defaultDeductions = DEFAULT_DEDUCTION_LABELS.map(label => ({ label, amount: auto[label as keyof typeof auto] ?? 0 }))
        const healthMatch = employee ? healthInsuranceDataRef.current[employee.name] : undefined
        setDeductions(healthMatch ? applyHealthInsurance(defaultDeductions, healthMatch) : defaultDeductions)
      }
      setTotalWorkDaysText('')
      setTotalHoursText('')
      setBaseHoursText('')
      setLeaveHoursText('')
      setEtcHoursText('')
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [empId, period, migrationReady])

  const calcMethods = payments
    .filter(p => DEFAULT_CALC_FORMULAS[p.label])
    .map(p => ({ label: p.label, formula: DEFAULT_CALC_FORMULAS[p.label] }))

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
      지급내역: payments.filter(p => p.label).map(p => ({ 항목: p.label, 금액: p.amount || 0 })),
      공제내역: deductions.filter(d => d.label).map(d => ({ 항목: d.label, 금액: d.amount || 0 })),
      지급합계,
      공제합계,
      실지급액: 지급합계 - 공제합계,
      유형: 'generated',
      file_path: null,
      file_name: null,
      work_start: workStart || null,
      work_end: workEnd || null,
      message: message.trim() || null,
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

          <div ref={lineItemSplitRef} className="flex items-start w-full">
            <div style={{ width: `${lineItemSplitPct}%` }} className="min-w-0 pr-2">
              <LineItemEditor title="지급항목" items={payments} onChange={setPayments} employeeName={employee?.name} onDrill={openDrill} />
            </div>
            <div
              onMouseDown={handleLineItemDividerMouseDown}
              className="w-1.5 self-stretch shrink-0 cursor-col-resize bg-dark-100 hover:bg-primary-300 active:bg-primary-400 rounded-full transition-colors"
              title="드래그해서 비율 조정"
            />
            <div style={{ width: `${100 - lineItemSplitPct}%` }} className="min-w-0 pl-2">
              <LineItemEditor title="공제항목" items={deductions} onChange={setDeductions} employeeName={employee?.name} />
            </div>
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
              근로시간 통계 <span className="font-normal text-dark-400">(연장·야간·휴일은 승인된 야근신청에서 자동계산, 나머지는 직접 입력)</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-dark-500 block mb-1">총 근무일수</label>
                <input type="text" value={totalWorkDaysText} onChange={e => setTotalWorkDaysText(e.target.value)} placeholder="예: 22일" className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">총 근로시간(h)</label>
                <input type="number" value={totalHoursText} onChange={e => setTotalHoursText(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">기본근로시간(h)</label>
                <input type="number" value={baseHoursText} onChange={e => setBaseHoursText(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">연장근로시간</label>
                <div className="px-2 py-1.5 text-xs bg-dark-50 border border-dark-100 rounded-lg text-dark-500">{(autoOvertime.extendedMinutes / 60).toFixed(1)}h (자동)</div>
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">야간근로시간</label>
                <div className="px-2 py-1.5 text-xs bg-dark-50 border border-dark-100 rounded-lg text-dark-500">{(autoOvertime.nightMinutes / 60).toFixed(1)}h (자동)</div>
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">휴일근로시간</label>
                <div className="px-2 py-1.5 text-xs bg-dark-50 border border-dark-100 rounded-lg text-dark-500">{(autoOvertime.holidayMinutes / 60).toFixed(1)}h (자동)</div>
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
          </div>

          <div className="flex justify-end">
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
              department={department}
              position={position}
              hireDate={hireDate}
              workStart={workStart}
              workEnd={workEnd}
              payments={payments.filter(p => p.label)}
              deductions={deductions.filter(d => d.label)}
              workStats={{
                totalWorkDays: totalWorkDaysText || null,
                totalMinutes: numOrNull(totalHoursText) != null ? numOrNull(totalHoursText)! * 60 : null,
                baseMinutes: numOrNull(baseHoursText) != null ? numOrNull(baseHoursText)! * 60 : null,
                extendedMinutes: autoOvertime.extendedMinutes,
                nightMinutes: autoOvertime.nightMinutes,
                holidayMinutes: autoOvertime.holidayMinutes,
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

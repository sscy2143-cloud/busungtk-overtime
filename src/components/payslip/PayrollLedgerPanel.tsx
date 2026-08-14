import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Search, Upload, FileSpreadsheet, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { parseHealthInsuranceCsv, parseNationalPensionCsv, parseEmploymentInsuranceCsv, type InsuranceRow } from '../../utils/insurance-csv'
import { PayslipGeneratorPanel, type GeneratorEmployee } from './PayslipGeneratorPanel'
import { exportPayrollLedgerToExcel } from '../../utils/payroll-ledger-excel'

export interface LedgerEmployee extends GeneratorEmployee {
  employee_type: 'office' | 'field'
  is_active: boolean
}

interface LedgerRow {
  employee: LedgerEmployee
  status: 'generated' | 'file' | 'none'
  totalPayment: number
  totalDeduction: number
  netPay: number
}

interface PayslipSummaryRow {
  employee_id: string
  유형?: string
  지급합계?: number | null
  공제합계?: number | null
  실지급액?: number | null
  file_path: string | null
}

interface PayrollLedgerPanelProps {
  employees: LedgerEmployee[]
  onSaved?: () => void
}

interface EmployeePayrollInfo {
  base_salary: number
  annual_salary: number
  dependents_count: number
  salary_bank: string | null
  salary_account: string | null
}

function shiftPeriod(period: string, delta: number) {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function defaultPayDate(period: string) {
  const [y, m] = period.split('-').map(Number)
  const payY = m === 12 ? y + 1 : y
  const payM = m === 12 ? 1 : m + 1
  return `${payY}-${String(payM).padStart(2, '0')}-15`
}

function fmt(n: number) {
  return n.toLocaleString('ko-KR')
}

function statusLabel(s: LedgerRow['status']) {
  if (s === 'generated') return { text: '작성완료', cls: 'bg-primary-100 text-primary-700' }
  if (s === 'file') return { text: '파일등록', cls: 'bg-dark-100 text-dark-600' }
  return { text: '미작성', cls: 'bg-warning-50 text-warning-600' }
}

export function PayrollLedgerPanel({ employees, onSaved }: PayrollLedgerPanelProps) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [summaries, setSummaries] = useState<Record<string, PayslipSummaryRow>>({})
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [nameFilter, setNameFilter] = useState('')
  const [selectedEmpId, setSelectedEmpId] = useState('')
  const [exportingExcel, setExportingExcel] = useState(false)
  const [infoPopupEmp, setInfoPopupEmp] = useState<LedgerEmployee | null>(null)
  const [showInsurancePopup, setShowInsurancePopup] = useState(false)
  const [insuranceSearch, setInsuranceSearch] = useState('')
  const [bulkApplying, setBulkApplying] = useState(false)
  const [infoPopupPayroll, setInfoPopupPayroll] = useState<EmployeePayrollInfo | null>(null)
  const [infoPopupLoading, setInfoPopupLoading] = useState(false)

  async function openInfoPopup(emp: LedgerEmployee) {
    setInfoPopupEmp(emp)
    setInfoPopupPayroll(null)
    setInfoPopupLoading(true)
    const { data } = await supabase
      .from('employee_payroll_info')
      .select('base_salary, annual_salary, dependents_count, salary_bank, salary_account')
      .eq('employee_id', emp.id)
      .maybeSingle<EmployeePayrollInfo>()
    setInfoPopupPayroll(data)
    setInfoPopupLoading(false)
  }

  function insuranceStorageKey(p: string, part: 'data' | 'names') {
    return `busungtk_insurance_${part}_${p}`
  }
  function loadInsuranceFromStorage<T>(p: string, part: 'data' | 'names'): T | null {
    try {
      const raw = localStorage.getItem(insuranceStorageKey(p, part))
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  const [healthInsuranceData, setHealthInsuranceData] = useState<Record<string, InsuranceRow>>(
    () => loadInsuranceFromStorage(new Date().toISOString().slice(0, 7), 'data') ?? {}
  )
  const [insuranceCsvNames, setInsuranceCsvNames] = useState<{ health?: string; longTermCare?: string; nationalPension?: string; employment?: string }>(
    () => loadInsuranceFromStorage(new Date().toISOString().slice(0, 7), 'names') ?? {}
  )

  async function handleHealthCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const parsed = await parseHealthInsuranceCsv(file)
    setHealthInsuranceData(prev => {
      const next = { ...prev }
      for (const [name, row] of Object.entries(parsed)) {
        next[name] = { ...next[name], health: row.health, longTermCare: row.longTermCare }
      }
      return next
    })
    setInsuranceCsvNames(prev => ({ ...prev, health: file.name, longTermCare: file.name }))
  }

  function makeAmountCsvHandler(field: 'nationalPension' | 'employment', parser: (file: File) => Promise<Record<string, number>>) {
    return async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const parsed = await parser(file)
      setHealthInsuranceData(prev => {
        const next = { ...prev }
        for (const [name, amount] of Object.entries(parsed)) {
          next[name] = { ...next[name], [field]: amount }
        }
        return next
      })
      setInsuranceCsvNames(prev => ({ ...prev, [field]: file.name }))
    }
  }
  const handleNationalPensionCsvUpload = makeAmountCsvHandler('nationalPension', parseNationalPensionCsv)
  const handleEmploymentCsvUpload = makeAmountCsvHandler('employment', parseEmploymentInsuranceCsv)

  const [leftWidthPct, setLeftWidthPct] = useState(40)
  const splitRef = useRef<HTMLDivElement | null>(null)

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    function onMove(ev: MouseEvent) {
      const el = splitRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftWidthPct(Math.min(80, Math.max(20, pct)))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 월이 바뀌면 그 달에 이미 업로드해둔 게 있으면 복원, 없으면 빈 상태로
  useEffect(() => {
    setHealthInsuranceData(loadInsuranceFromStorage(period, 'data') ?? {})
    setInsuranceCsvNames(loadInsuranceFromStorage(period, 'names') ?? {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  // 업로드 데이터를 기기에 계속 보관(앱을 껐다 켜도, 다른 화면 갔다 와도 다시 안 올려도 되게)
  useEffect(() => {
    try {
      localStorage.setItem(insuranceStorageKey(period, 'data'), JSON.stringify(healthInsuranceData))
      localStorage.setItem(insuranceStorageKey(period, 'names'), JSON.stringify(insuranceCsvNames))
    } catch {
      // localStorage 접근 불가(프라이빗 모드 등) 시 무시
    }
  }, [period, healthInsuranceData, insuranceCsvNames])

  const loadSummaries = useCallback(async () => {
    setLoading(true)
    const { data: slips } = await supabase
      .from('payslips')
      .select('employee_id, 유형, 지급합계, 공제합계, 실지급액, file_path')
      .eq('period', period)
      .returns<PayslipSummaryRow[]>()
    const map: Record<string, PayslipSummaryRow> = {}
    for (const s of slips ?? []) map[s.employee_id] = s
    setSummaries(map)
    setLoading(false)
  }, [period])

  useEffect(() => { loadSummaries() }, [loadSummaries])

  function handleSaved() {
    loadSummaries()
    onSaved?.()
  }

  const rows: LedgerRow[] = employees.filter(e => e.is_active).map(emp => {
    const slip = summaries[emp.id]
    if (slip?.유형 === 'generated') {
      return { employee: emp, status: 'generated', totalPayment: slip.지급합계 ?? 0, totalDeduction: slip.공제합계 ?? 0, netPay: slip.실지급액 ?? 0 }
    }
    if (slip?.file_path) {
      return { employee: emp, status: 'file', totalPayment: 0, totalDeduction: 0, netPay: 0 }
    }
    return { employee: emp, status: 'none', totalPayment: 0, totalDeduction: 0, netPay: 0 }
  })

  const filtered = rows.filter(r =>
    (!typeFilter || r.employee.employee_type === typeFilter) &&
    (!deptFilter || r.employee.department.includes(deptFilter)) &&
    (!nameFilter || r.employee.name.includes(nameFilter))
  )

  const totalPayment = filtered.reduce((s, r) => s + r.totalPayment, 0)
  const totalDeduction = filtered.reduce((s, r) => s + r.totalDeduction, 0)
  const netPay = totalPayment - totalDeduction

  async function handleExportExcel() {
    if (filtered.length === 0) return
    setExportingExcel(true)
    try {
      const generatedIds = filtered.filter(r => r.status === 'generated').map(r => r.employee.id)
      interface DetailRow { employee_id: string; 지급내역?: Array<{ 항목: string; 금액: number }>; 공제내역?: Array<{ 항목: string; 금액: number }> }
      const detailMap = new Map<string, DetailRow>()
      if (generatedIds.length > 0) {
        const { data } = await supabase
          .from('payslips')
          .select('employee_id, 지급내역, 공제내역')
          .eq('period', period)
          .in('employee_id', generatedIds)
          .returns<DetailRow[]>()
        for (const row of data ?? []) detailMap.set(row.employee_id, row)
      }
      await exportPayrollLedgerToExcel({
        period,
        payDate: defaultPayDate(period),
        rows: filtered.map(r => {
          const detail = detailMap.get(r.employee.id)
          return {
            department: r.employee.department,
            name: r.employee.name,
            payments: (detail?.지급내역 ?? []).map(p => ({ label: p.항목, amount: p.금액 })),
            deductions: (detail?.공제내역 ?? []).map(d => ({ label: d.항목, amount: d.금액 })),
          }
        }),
      })
    } finally {
      setExportingExcel(false)
    }
  }

  async function handleBulkApplyInsurance() {
    if (Object.keys(healthInsuranceData).length === 0) return
    if (!confirm('이번 달에 작성완료된 명세서의 4대보험 항목을 업로드한 파일 값으로 일괄 갱신할까요?')) return
    setBulkApplying(true)
    try {
      interface SlipRow { id: string; employee_id: string; 지급합계: number | null; 공제내역: Array<{ 항목: string; 금액: number }> | null }
      const { data: slips } = await supabase
        .from('payslips')
        .select('id, employee_id, 지급합계, 공제내역')
        .eq('period', period)
        .eq('유형', 'generated')
        .returns<SlipRow[]>()
      if (!slips || slips.length === 0) {
        alert('이번 달에 작성완료된 명세서가 없습니다.')
        return
      }
      const nameById = new Map(employees.map(e => [e.id, e.name]))
      let updated = 0
      let unmatched = 0
      for (const slip of slips) {
        const name = nameById.get(slip.employee_id)
        const match = name ? healthInsuranceData[name] : undefined
        if (!match) { unmatched++; continue }
        const deductions = (slip.공제내역 ?? []).map(d =>
          d.항목 === '건강보험' && match.health != null ? { ...d, 금액: match.health } :
          d.항목 === '장기요양보험' && match.longTermCare != null ? { ...d, 금액: match.longTermCare } :
          d.항목 === '국민연금' && match.nationalPension != null ? { ...d, 금액: match.nationalPension } :
          d.항목 === '고용보험' && match.employment != null ? { ...d, 금액: match.employment } :
          d
        )
        const 공제합계 = deductions.reduce((s, d) => s + (d.금액 || 0), 0)
        const 지급합계 = slip.지급합계 ?? 0
        const { error } = await supabase
          .from('payslips')
          .update({ 공제내역: deductions, 공제합계, 실지급액: 지급합계 - 공제합계 })
          .eq('id', slip.id)
        if (!error) updated++
      }
      alert(`${updated}명 갱신 완료${unmatched > 0 ? ` · ${unmatched}명은 파일에서 이름이 매칭되지 않아 건너뜀` : ''}`)
      loadSummaries()
    } finally {
      setBulkApplying(false)
    }
  }

  async function handleResetToDraft(employeeId: string, employeeName: string) {
    if (!confirm(`${employeeName}님의 상태를 미작성으로 되돌릴까요?\n입력해둔 지급·공제 항목 내용은 그대로 남아있고, 다시 열어서 저장하면 작성완료로 돌아갑니다.`)) return
    const { error } = await supabase.from('payslips').update({ 유형: null }).eq('employee_id', employeeId).eq('period', period)
    if (error) {
      alert('되돌리기에 실패했습니다. 잠시 후 다시 시도해주세요.')
      return
    }
    if (selectedEmpId === employeeId) setSelectedEmpId('')
    loadSummaries()
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-dark-200 p-4 flex flex-wrap items-center justify-center gap-3">
        <button onClick={() => setPeriod(p => shiftPeriod(p, -1))} className="p-1.5 rounded-lg hover:bg-dark-50 text-dark-500">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-dark-800 w-20 text-center">{period}</span>
        <button onClick={() => setPeriod(p => shiftPeriod(p, 1))} className="p-1.5 rounded-lg hover:bg-dark-50 text-dark-500">
          <ChevronRight size={16} />
        </button>
        <span className="text-xs text-dark-400 ml-2">지급(예정)일 {defaultPayDate(period)}</span>
      </div>

      <div className="bg-white rounded-xl border border-dark-200 p-4">
        <button
          type="button"
          onClick={() => setShowInsurancePopup(true)}
          className="text-xs font-semibold text-dark-600 mb-2 hover:text-primary-600 hover:underline transition-colors text-left"
        >
          4대보험 고지내역 업로드 (직원명으로 매칭돼 전 직원 공제항목에 자동입력) — 클릭해서 인식 내역 확인
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-dark-600 border border-dark-200 rounded-lg cursor-pointer hover:bg-dark-50 transition-colors">
            <Upload size={13} /> 국민연금
            <input type="file" accept=".csv" onChange={handleNationalPensionCsvUpload} className="hidden" />
          </label>
          <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-dark-600 border border-dark-200 rounded-lg cursor-pointer hover:bg-dark-50 transition-colors">
            <Upload size={13} /> 건강보험·장기요양보험
            <input type="file" accept=".csv" onChange={handleHealthCsvUpload} className="hidden" />
          </label>
          <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-dark-600 border border-dark-200 rounded-lg cursor-pointer hover:bg-dark-50 transition-colors">
            <Upload size={13} /> 고용보험
            <input type="file" accept=".csv" onChange={handleEmploymentCsvUpload} className="hidden" />
          </label>
          {(insuranceCsvNames.health || insuranceCsvNames.nationalPension || insuranceCsvNames.employment) && (
            <span className="text-xs text-dark-400">
              {insuranceCsvNames.nationalPension && `국민연금: ${insuranceCsvNames.nationalPension}`}
              {insuranceCsvNames.nationalPension && (insuranceCsvNames.health || insuranceCsvNames.employment) && ' / '}
              {insuranceCsvNames.health && `건강보험·장기요양보험: ${insuranceCsvNames.health}`}
              {insuranceCsvNames.health && insuranceCsvNames.employment && ' / '}
              {insuranceCsvNames.employment && `고용보험: ${insuranceCsvNames.employment}`}
              {' '}({Object.keys(healthInsuranceData).length}명 인식)
            </span>
          )}
          {Object.keys(healthInsuranceData).length > 0 && (
            <button
              type="button"
              onClick={handleBulkApplyInsurance}
              disabled={bulkApplying}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors disabled:opacity-50"
            >
              {bulkApplying ? '반영 중...' : '작성완료된 명세서에 일괄 반영'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-dark-200 p-4 text-center">
          <p className="text-xs text-dark-400 mb-1">급여대상자</p>
          <p className="text-lg font-bold text-dark-900">{filtered.length}명</p>
        </div>
        <div className="bg-white rounded-xl border border-dark-200 p-4 text-center">
          <p className="text-xs text-dark-400 mb-1">세전 총 지급합계</p>
          <p className="text-lg font-bold text-dark-900">{fmt(totalPayment)}원</p>
        </div>
        <div className="bg-white rounded-xl border border-dark-200 p-4 text-center">
          <p className="text-xs text-dark-400 mb-1">공제합계</p>
          <p className="text-lg font-bold text-dark-900">{fmt(totalDeduction)}원</p>
        </div>
        <div className="bg-white rounded-xl border border-dark-200 p-4 text-center">
          <p className="text-xs text-dark-400 mb-1">공제 후 지급액</p>
          <p className="text-lg font-bold text-dark-900">{fmt(netPay)}원</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-dark-200 p-4 flex flex-wrap items-center gap-2">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-2 text-sm border border-dark-200 rounded-lg bg-white">
          <option value="">직원구분 전체</option>
          <option value="office">사무직</option>
          <option value="field">현장직</option>
        </select>
        <input
          type="text"
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          placeholder="부서"
          className="px-3 py-2 text-sm border border-dark-200 rounded-lg w-28"
        />
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-300" />
          <input
            type="text"
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            placeholder="사원명을 입력하세요"
            className="pl-7 pr-3 py-2 text-sm border border-dark-200 rounded-lg"
          />
        </div>
        <button
          type="button"
          onClick={handleExportExcel}
          disabled={exportingExcel || filtered.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-dark-700 bg-white border border-dark-200 rounded-lg hover:bg-dark-50 transition-colors disabled:opacity-50"
        >
          <FileSpreadsheet size={14} />
          {exportingExcel ? '생성 중...' : '급여대장 엑셀 다운로드'}
        </button>
      </div>

      <div ref={splitRef} className="flex items-start w-full">
        <div style={{ width: `${leftWidthPct}%` }} className="min-w-0 pr-2">
          {loading ? (
            <div className="bg-white rounded-2xl border border-dark-100 py-16 text-center text-sm text-dark-400">불러오는 중...</div>
          ) : (
          <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-100 bg-dark-50">
                    <th className="px-4 py-3 w-8"></th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">상태</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">사원명</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400">부서</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-dark-400">입사일</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-500">지급합계</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-500">공제합계</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-500">공제 후 지급액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-50">
                  {filtered.map(r => {
                    const s = statusLabel(r.status)
                    const selected = r.employee.id === selectedEmpId
                    return (
                      <tr
                        key={r.employee.id}
                        onClick={() => setSelectedEmpId(r.employee.id)}
                        className={`cursor-pointer transition-colors ${selected ? 'bg-primary-50' : 'hover:bg-dark-50'}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => setSelectedEmpId(r.employee.id)}
                            onClick={e => e.stopPropagation()}
                            className="rounded border-dark-300"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <span className={`px-2 py-1 rounded-md text-xs font-medium ${s.cls}`}>{s.text}</span>
                            {r.status === 'generated' && (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); handleResetToDraft(r.employee.id, r.employee.name) }}
                                title="미작성으로 되돌리기"
                                className="p-0.5 text-dark-300 hover:text-warning-600 rounded"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); openInfoPopup(r.employee) }}
                            className="font-medium text-primary-600 hover:underline"
                          >
                            {r.employee.name}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs text-dark-400">{r.employee.department}</td>
                        <td className="px-4 py-3 text-center text-xs text-dark-500">{r.employee.hire_date ?? '-'}</td>
                        <td className="px-4 py-3 text-right text-dark-700">{fmt(r.totalPayment)}</td>
                        <td className="px-4 py-3 text-right text-dark-700">{fmt(r.totalDeduction)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-dark-900">{fmt(r.netPay)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>

        <div
          onMouseDown={handleDividerMouseDown}
          className="w-1.5 self-stretch shrink-0 cursor-col-resize bg-dark-100 hover:bg-primary-300 active:bg-primary-400 rounded-full transition-colors"
          title="드래그해서 비율 조정"
        />

        <div style={{ width: `${100 - leftWidthPct}%` }} className="payslip-sticky-panel min-w-0 pl-2 sticky top-4">
          {selectedEmpId ? (
            <PayslipGeneratorPanel
              key={period}
              employees={employees}
              period={period}
              empId={selectedEmpId}
              onEmpIdChange={setSelectedEmpId}
              onSaved={handleSaved}
              healthInsuranceData={healthInsuranceData}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-dark-100 py-16 text-center text-sm text-dark-400">
              왼쪽 목록에서 직원을 선택하세요
            </div>
          )}
        </div>
      </div>

      {infoPopupEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setInfoPopupEmp(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
              <p className="text-base font-bold text-dark-900">사원 정보</p>
              <button onClick={() => setInfoPopupEmp(null)} className="p-1.5 rounded-lg hover:bg-dark-100"><X size={18} className="text-dark-500" /></button>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-dark-400">이름</span><span className="font-medium text-dark-800">{infoPopupEmp.name}</span></div>
              <div className="flex justify-between"><span className="text-dark-400">부서</span><span className="text-dark-700">{infoPopupEmp.department}</span></div>
              <div className="flex justify-between"><span className="text-dark-400">직원구분</span><span className="text-dark-700">{infoPopupEmp.employee_type === 'office' ? '사무직' : '현장직'}</span></div>
              <div className="flex justify-between"><span className="text-dark-400">입사일</span><span className="text-dark-700">{infoPopupEmp.hire_date ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-dark-400">시급</span><span className="text-dark-700">{fmt(infoPopupEmp.hourly_wage ?? 0)}원</span></div>
              <div className="border-t border-dark-100 my-2" />
              {infoPopupLoading ? (
                <p className="text-xs text-dark-400 text-center py-2">불러오는 중...</p>
              ) : infoPopupPayroll ? (
                <>
                  <div className="flex justify-between"><span className="text-dark-400">월급</span><span className="text-dark-700">{fmt(infoPopupPayroll.base_salary)}원</span></div>
                  <div className="flex justify-between"><span className="text-dark-400">연봉</span><span className="text-dark-700">{fmt(infoPopupPayroll.annual_salary)}원</span></div>
                  <div className="flex justify-between"><span className="text-dark-400">급여은행</span><span className="text-dark-700">{infoPopupPayroll.salary_bank || '-'}</span></div>
                  <div className="flex justify-between"><span className="text-dark-400">급여계좌</span><span className="text-dark-700">{infoPopupPayroll.salary_account || '-'}</span></div>
                </>
              ) : (
                <p className="text-xs text-dark-400 text-center py-2">등록된 급여정보가 없습니다</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-dark-100">
              <button
                onClick={() => { setSelectedEmpId(infoPopupEmp.id); setInfoPopupEmp(null) }}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600"
              >
                급여명세서 보기
              </button>
            </div>
          </div>
        </div>
      )}

      {showInsurancePopup && (() => {
        const activeEmployees = employees.filter(e => e.is_active)
        const rows = activeEmployees
          .map(emp => {
            const ins = healthInsuranceData[emp.name]
            const nationalPension = ins?.nationalPension ?? 0
            const health = ins?.health ?? 0
            const longTermCare = ins?.longTermCare ?? 0
            const employment = ins?.employment ?? 0
            // 고용보험은 대상자만 고지파일 명단에 오르므로, 다른 보험은 매칭됐는데
            // 고용보험만 파일에 없는 경우는 "미매칭"이 아니라 "고용보험 비대상자"임
            const employmentNotApplicable = !!ins && ins.employment == null
            return {
              emp,
              matched: !!ins,
              nationalPension, health, longTermCare, employment, employmentNotApplicable,
              sum: nationalPension + health + longTermCare + employment,
            }
          })
          .filter(r => !insuranceSearch || r.emp.name.includes(insuranceSearch))
          .sort((a, b) => {
            if (a.matched !== b.matched) return a.matched ? 1 : -1
            return a.emp.name.localeCompare(b.emp.name, 'ko')
          })
        const unmatchedCount = rows.filter(r => !r.matched).length
        const sumOf = (key: 'nationalPension' | 'health' | 'longTermCare' | 'employment' | 'sum') => rows.reduce((s, r) => s + r[key], 0)

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowInsurancePopup(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
                <div>
                  <p className="text-base font-bold text-dark-900">4대보험 고지내역 확인</p>
                  <p className="text-xs text-dark-400 mt-0.5">{period} · 업로드한 CSV에서 인식된 금액을 사원명 기준으로 대조해보세요</p>
                </div>
                <button onClick={() => setShowInsurancePopup(false)} className="p-1.5 rounded-lg hover:bg-dark-100"><X size={18} className="text-dark-500" /></button>
              </div>

              <div className="px-5 py-3 border-b border-dark-100 flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-300" />
                  <input
                    type="text"
                    value={insuranceSearch}
                    onChange={e => setInsuranceSearch(e.target.value)}
                    placeholder="사원명 검색"
                    className="pl-7 pr-3 py-1.5 text-xs border border-dark-200 rounded-lg"
                  />
                </div>
                <span className="text-xs text-dark-500">
                  전체 {activeEmployees.length}명 중 <b className="text-dark-800">{activeEmployees.length - unmatchedCount}명 인식</b>
                  {unmatchedCount > 0 && <span className="text-warning-600 font-medium"> · {unmatchedCount}명 미매칭</span>}
                </span>
                {(insuranceCsvNames.health || insuranceCsvNames.nationalPension || insuranceCsvNames.employment) && (
                  <span className="text-xs text-dark-400 w-full">
                    {insuranceCsvNames.nationalPension && `국민연금: ${insuranceCsvNames.nationalPension}`}
                    {insuranceCsvNames.nationalPension && (insuranceCsvNames.health || insuranceCsvNames.employment) && ' · '}
                    {insuranceCsvNames.health && `건강보험·장기요양보험: ${insuranceCsvNames.health}`}
                    {insuranceCsvNames.health && insuranceCsvNames.employment && ' · '}
                    {insuranceCsvNames.employment && `고용보험: ${insuranceCsvNames.employment}`}
                  </span>
                )}
              </div>

              <div className="overflow-y-auto flex-1">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-dark-100 bg-dark-50">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-dark-500">사원명</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-dark-400">부서</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-dark-500">국민연금</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-dark-500">건강보험</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-dark-500">장기요양보험</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-dark-500">고용보험</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-dark-700">합계</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-dark-400">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-50">
                    {rows.length === 0 ? (
                      <tr><td colSpan={8} className="py-12 text-center text-sm text-dark-400">대상 직원이 없습니다</td></tr>
                    ) : rows.map(r => (
                      <tr key={r.emp.id} className={!r.matched ? 'bg-warning-50/60' : undefined}>
                        <td className="px-4 py-2.5 font-medium text-dark-800">{r.emp.name}</td>
                        <td className="px-4 py-2.5 text-xs text-dark-400">{r.emp.department}</td>
                        <td className="px-4 py-2.5 text-right text-dark-700">{fmt(r.nationalPension)}</td>
                        <td className="px-4 py-2.5 text-right text-dark-700">{fmt(r.health)}</td>
                        <td className="px-4 py-2.5 text-right text-dark-700">{fmt(r.longTermCare)}</td>
                        <td className="px-4 py-2.5 text-right text-dark-700">
                          {r.employmentNotApplicable ? <span className="text-dark-300">비대상</span> : fmt(r.employment)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-dark-900">{fmt(r.sum)}</td>
                        <td className="px-4 py-2.5 text-center">
                          {r.matched ? (
                            <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-primary-100 text-primary-700">매칭</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-warning-100 text-warning-700">미매칭</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {rows.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-dark-200 bg-dark-50 font-semibold">
                        <td className="px-4 py-2.5 text-dark-700" colSpan={2}>합계</td>
                        <td className="px-4 py-2.5 text-right text-dark-800">{fmt(sumOf('nationalPension'))}</td>
                        <td className="px-4 py-2.5 text-right text-dark-800">{fmt(sumOf('health'))}</td>
                        <td className="px-4 py-2.5 text-right text-dark-800">{fmt(sumOf('longTermCare'))}</td>
                        <td className="px-4 py-2.5 text-right text-dark-800">{fmt(sumOf('employment'))}</td>
                        <td className="px-4 py-2.5 text-right text-dark-900">{fmt(sumOf('sum'))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {unmatchedCount > 0 && (
                <div className="px-5 py-3 border-t border-dark-100 bg-warning-50 text-xs text-warning-700">
                  미매칭 직원은 CSV 안의 이름 표기가 시스템 사원명과 다르거나(공백·오탈자 등), 해당 보험 파일에 이 달 내역이 없는 경우예요. 공제항목에서 직접 확인·수정해주세요.
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

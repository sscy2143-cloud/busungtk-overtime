import type ExcelJS from 'exceljs'
import { formatBirthDateYYMMDD, type PayslipLineItem, type PayslipWorkStats, type PayslipCalcMethod } from '../components/payslip/PayslipView'

export interface PayslipExcelInput {
  companyName?: string
  period: string // 'YYYY-MM'
  payDate?: string | null
  employeeName: string
  birthDate?: string | null
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

const THIN = { style: 'thin' as const, color: { argb: 'FFD9D9D9' } }
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN }

export async function exportPayslipToExcel(input: PayslipExcelInput) {
  const {
    companyName = '부성티케이',
    period, payDate, employeeName, birthDate, department, position, hireDate,
    workStart, workEnd, payments, deductions, workStats, calcMethods, message,
  } = input
  const [y, m] = period.split('-')
  const totalPayment = payments.reduce((s, p) => s + p.amount, 0)
  const totalDeduction = deductions.reduce((s, d) => s + d.amount, 0)
  const netPay = totalPayment - totalDeduction

  const { default: ExcelJSLib } = await import('exceljs')
  const wb = new ExcelJSLib.Workbook()
  const ws = wb.addWorksheet('급여명세서', { views: [{ showGridLines: false }] })
  ws.columns = [{ width: 4 }, { width: 20 }, { width: 20 }, { width: 4 }, { width: 20 }, { width: 20 }]

  let r = 1
  function setCell(row: number, col: number, value: unknown, opts: Partial<ExcelJS.Style> = {}) {
    const cell = ws.getCell(row, col)
    cell.value = value as ExcelJS.CellValue
    Object.assign(cell, opts)
    return cell
  }

  setCell(r, 1, companyName, { font: { size: 10, color: { argb: 'FF888888' } } })
  r += 1
  ws.mergeCells(r, 1, r, 6)
  setCell(r, 1, `${y}년 ${parseInt(m, 10)}월 급여명세서`, { font: { size: 16, bold: true }, alignment: { vertical: 'middle' } })
  ws.getRow(r).height = 26
  r += 2

  setCell(r, 1, '이름', { font: { bold: true } })
  const birthSuffix = formatBirthDateYYMMDD(birthDate)
  setCell(r, 2, birthSuffix ? `${employeeName} (${birthSuffix})` : employeeName)
  setCell(r, 3, '부서', { font: { bold: true } })
  setCell(r, 4, department || '')
  r += 1
  setCell(r, 1, '직위', { font: { bold: true } })
  setCell(r, 2, position || '')
  setCell(r, 3, '입사일자', { font: { bold: true } })
  setCell(r, 4, fmtDateKo(hireDate))
  r += 1
  setCell(r, 1, '급여지급일', { font: { bold: true } })
  setCell(r, 2, fmtDateKo(payDate))
  setCell(r, 3, '근로기간', { font: { bold: true } })
  setCell(r, 4, `${workStart || '-'} ~ ${workEnd || '-'}`)
  r += 2

  setCell(r, 1, '실지급액', { font: { bold: true, size: 12 } })
  ws.mergeCells(r, 2, r, 4)
  setCell(r, 2, netPay, { font: { bold: true, size: 12 }, numFmt: '#,##0', alignment: { horizontal: 'right' } })
  r += 2

  // 지급항목 / 공제항목
  const itemsStartRow = r
  setCell(r, 1, '지급항목', { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }, border: BOX })
  ws.mergeCells(r, 1, r, 2)
  setCell(r, 3, totalPayment, { font: { bold: true }, numFmt: '#,##0', fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }, border: BOX, alignment: { horizontal: 'right' } })
  setCell(r, 4, '공제항목', { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }, border: BOX })
  ws.mergeCells(r, 4, r, 5)
  setCell(r, 6, totalDeduction, { font: { bold: true }, numFmt: '#,##0', fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }, border: BOX, alignment: { horizontal: 'right' } })
  r += 1

  const rows = Math.max(payments.length, deductions.length)
  for (let i = 0; i < rows; i++) {
    const p = payments[i]
    const d = deductions[i]
    if (p) {
      ws.mergeCells(r, 1, r, 2)
      setCell(r, 1, p.label, { border: BOX })
      setCell(r, 3, p.amount, { numFmt: '#,##0', border: BOX, alignment: { horizontal: 'right' } })
    } else {
      ws.mergeCells(r, 1, r, 2)
      setCell(r, 1, '', { border: BOX })
      setCell(r, 3, '', { border: BOX })
    }
    if (d) {
      ws.mergeCells(r, 4, r, 5)
      setCell(r, 4, d.label, { border: BOX })
      setCell(r, 6, d.amount, { numFmt: '#,##0', border: BOX, alignment: { horizontal: 'right' } })
    } else {
      ws.mergeCells(r, 4, r, 5)
      setCell(r, 4, '', { border: BOX })
      setCell(r, 6, '', { border: BOX })
    }
    r += 1
  }
  void itemsStartRow
  r += 1

  // 근로시간 통계
  if (workStats) {
    const statLabels = ['총 근무일수', '총 근로시간', '기본근로시간', '연장근로시간', '야간근로시간', '휴일근로시간', '휴가', '기타']
    const statValues = [
      workStats.totalWorkDays ?? '-',
      fmtHMS(workStats.totalMinutes),
      fmtHMS(workStats.baseMinutes),
      fmtHMS(workStats.extendedMinutes),
      fmtHMS(workStats.nightMinutes),
      fmtHMS(workStats.holidayMinutes),
      fmtHMS(workStats.leaveMinutes),
      fmtHMS(workStats.etcMinutes),
    ]
    ws.mergeCells(r, 1, r, 6)
    setCell(r, 1, '급여 산정 근로기간 통계', { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }, border: BOX })
    r += 1
    for (let i = 0; i < statLabels.length; i += 2) {
      setCell(r, 1, statLabels[i], { font: { bold: true }, border: BOX })
      setCell(r, 2, statValues[i], { border: BOX })
      if (statLabels[i + 1]) {
        setCell(r, 4, statLabels[i + 1], { font: { bold: true }, border: BOX })
        setCell(r, 5, statValues[i + 1], { border: BOX })
        ws.mergeCells(r, 5, r, 6)
      }
      r += 1
    }
    r += 1
  }

  // 급여 계산 방법
  if (calcMethods && calcMethods.length > 0) {
    ws.mergeCells(r, 1, r, 6)
    setCell(r, 1, '급여 계산 방법', { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }, border: BOX })
    r += 1
    for (const c of calcMethods) {
      setCell(r, 1, c.label, { font: { bold: true }, border: BOX })
      ws.mergeCells(r, 2, r, 6)
      setCell(r, 2, c.formula, { border: BOX })
      r += 1
    }
    r += 1
  }

  if (message) {
    ws.mergeCells(r, 1, r, 6)
    setCell(r, 1, message, { font: { italic: true, color: { argb: 'FF1D7A5F' } } })
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${employeeName}_${y.slice(2)}년_${parseInt(m, 10)}월분 급여명세서.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

import type ExcelJS from 'exceljs'

export interface LedgerExcelRow {
  department: string
  name: string
  position?: string | null
  payments: Array<{ label: string; amount: number }>
  deductions: Array<{ label: string; amount: number }>
}

export interface LedgerExcelInput {
  period: string // 'YYYY-MM'
  payDate: string // 'YYYY-MM-DD'
  rows: LedgerExcelRow[]
}

// 데스크탑 급여대장 양식(No/부서/사원명/직위/기본급/연장·야간·휴일근로수당/연차수당/
// 기타수당[1][2]/상여금/성과금/연말정산/지급합계/근로소득세/근로지방소득세/4대보험/
// 기타공제[1][2]/공제합계/실지급액)과 동일한 컬럼 순서 · 서식으로 생성
const HEADERS = [
  'No', '부서', '사원명', '직위',
  '기본급', '연장근로수당', '야간근로수당', '휴일근로수당', '연차수당', '기타 수당 [ 1 ]', '기타 수당 [ 2 ]',
  '상여금', '성과금', '연말정산', '지급합계',
  '근로소득세', '근로지방소득세', '국민연금', '건강보험', '장기요양보험', '고용보험', '기타 공제  [1]', '기타 공제  [2]', '공제합계',
  '실지급액',
]
const COL_WIDTHS = [4.375, 11.125, 9.125, 3.75, 11.875, 10.625, 10.625, 8.5, 6.125, 12.125, 12.125, 4.875, 4.875, 6.125, 13.125, 11.125, 11.125, 11.125, 11.125, 10.375, 10.375, 10.375, 10.375, 10.375, 20.875]

const PAYMENT_COL: Record<string, number> = {
  '기본급': 5, '연장근로수당': 6, '야간근로수당': 7, '휴일근로수당': 8, '연차수당': 9,
  '상여금': 12, '성과금': 13, '연말정산': 14,
}
const DEDUCTION_COL: Record<string, number> = {
  '근로소득세': 16, '근로지방소득세': 17, '국민연금': 18, '건강보험': 19, '장기요양보험': 20, '고용보험': 21,
}
const PAYMENT_ETC_COLS = [10, 11] // 기타 수당 [1][2]
const DEDUCTION_ETC_COLS = [22, 23] // 기타 공제 [1][2]

// exceljs 타입 정의에는 레거시 indexed color가 빠져있지만 런타임에서는 그대로 지원됨
// (데스크탑 원본 서식과 동일한 팔레트 색을 쓰기 위해 as any로 우회)
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { indexed: 41 } } as unknown as ExcelJS.Fill
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { indexed: 22 } } as unknown as ExcelJS.Fill
const TOTAL_FONT_COLOR = { indexed: 8 } as unknown as ExcelJS.Color
const HAIR: Partial<ExcelJS.Borders> = {
  top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' },
}
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' },
}
const FONT_BASE = { name: '맑은 고딕', size: 10 }
const NUM_FMT = '#,##0'

export async function exportPayrollLedgerToExcel({ period, payDate, rows }: LedgerExcelInput) {
  const [y, m] = period.split('-')
  const [py, pm, pd] = payDate.split('-')

  const { default: ExcelJSLib } = await import('exceljs')
  const wb = new ExcelJSLib.Workbook()
  const ws = wb.addWorksheet('월별 급여대장', { views: [{ zoomScale: 90 }] })
  ws.columns = COL_WIDTHS.map(width => ({ width }))

  // 제목
  ws.mergeCells(1, 1, 2, 25)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = `${y}년 ${m}월 급(상)여대장`
  titleCell.font = { name: '맑은 고딕', size: 16 }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 20.25

  // 지급일
  ws.mergeCells(3, 1, 3, 25)
  const payDateCell = ws.getCell(3, 1)
  payDateCell.value = `급(상)여지급일 ${py}년 ${parseInt(pm, 10)}월 ${parseInt(pd, 10)}일`
  payDateCell.font = { name: '맑은 고딕', size: 10 }
  payDateCell.alignment = { horizontal: 'right', vertical: 'middle' }

  // 헤더
  const headerRow = 4
  HEADERS.forEach((label, i) => {
    const cell = ws.getCell(headerRow, i + 1)
    cell.value = label
    cell.font = { name: '맑은 고딕', size: 12, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = HEADER_FILL
  })
  ws.getRow(headerRow).height = 18.75

  // 데이터
  const sums = new Array(25).fill(0)
  rows.forEach((row, idx) => {
    const r = headerRow + 1 + idx
    ws.getRow(r).height = 26.25

    const textCells: Array<[number, unknown]> = [
      [1, idx + 1], [2, row.department], [3, row.name], [4, row.position || ''],
    ]
    for (const [col, value] of textCells) {
      const cell = ws.getCell(r, col)
      cell.value = value as ExcelJS.CellValue
      cell.font = FONT_BASE
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    }

    const amounts = new Array(25).fill(0)
    let etcPayIdx = 0
    for (const p of row.payments) {
      const col = PAYMENT_COL[p.label]
      if (col) {
        amounts[col - 1] += p.amount
      } else if (etcPayIdx < PAYMENT_ETC_COLS.length) {
        amounts[PAYMENT_ETC_COLS[etcPayIdx] - 1] += p.amount
        etcPayIdx++
      } else {
        amounts[PAYMENT_ETC_COLS[PAYMENT_ETC_COLS.length - 1] - 1] += p.amount
      }
    }
    let etcDedIdx = 0
    for (const d of row.deductions) {
      const col = DEDUCTION_COL[d.label]
      if (col) {
        amounts[col - 1] += d.amount
      } else if (etcDedIdx < DEDUCTION_ETC_COLS.length) {
        amounts[DEDUCTION_ETC_COLS[etcDedIdx] - 1] += d.amount
        etcDedIdx++
      } else {
        amounts[DEDUCTION_ETC_COLS[DEDUCTION_ETC_COLS.length - 1] - 1] += d.amount
      }
    }
    const totalPayment = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].reduce((s, c) => s + amounts[c - 1], 0)
    const totalDeduction = [16, 17, 18, 19, 20, 21, 22, 23].reduce((s, c) => s + amounts[c - 1], 0)
    amounts[14] = totalPayment // O 지급합계
    amounts[23] = totalDeduction // X 공제합계
    amounts[24] = totalPayment - totalDeduction // Y 실지급액

    for (let col = 5; col <= 25; col++) {
      const cell = ws.getCell(r, col)
      cell.value = amounts[col - 1]
      cell.numFmt = NUM_FMT
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      const isTotalCol = col === 15 || col === 24 || col === 25
      cell.font = isTotalCol
        ? { name: '맑은 고딕', size: 11, bold: col === 25 }
        : { name: '맑은 고딕', size: 11, color: TOTAL_FONT_COLOR }
      if (isTotalCol) {
        cell.fill = TOTAL_FILL
        cell.border = HAIR
      }
      sums[col - 1] += amounts[col - 1]
    }
  })

  // 합계행
  const summaryRow = headerRow + 1 + rows.length
  ws.mergeCells(summaryRow, 1, summaryRow, 2)
  ws.mergeCells(summaryRow, 3, summaryRow, 4)
  const totalLabelCell = ws.getCell(summaryRow, 1)
  totalLabelCell.value = `총 급(상)여대상자 ${rows.length}명`
  totalLabelCell.font = { name: '맑은 고딕', size: 11 }
  totalLabelCell.alignment = { horizontal: 'center' }
  totalLabelCell.fill = TOTAL_FILL
  totalLabelCell.border = THIN_BORDER
  const sumHeaderCell = ws.getCell(summaryRow, 3)
  sumHeaderCell.value = '합계'
  sumHeaderCell.font = { name: '맑은 고딕', size: 11 }
  sumHeaderCell.alignment = { horizontal: 'center' }
  sumHeaderCell.fill = TOTAL_FILL
  sumHeaderCell.border = THIN_BORDER

  for (let col = 5; col <= 25; col++) {
    const cell = ws.getCell(summaryRow, col)
    cell.value = sums[col - 1]
    cell.numFmt = NUM_FMT
    cell.font = { name: '맑은 고딕', size: 11 }
    cell.alignment = { horizontal: 'right' }
    cell.fill = TOTAL_FILL
    cell.border = HAIR
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `부성티케이_${y}년_${m}월_급여대장.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

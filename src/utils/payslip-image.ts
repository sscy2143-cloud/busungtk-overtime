import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PayslipView, type PayslipViewProps } from '../components/payslip/PayslipView'

async function renderPayslipToCanvas(props: PayslipViewProps): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas')

  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  container.style.width = '900px'
  container.style.background = '#ffffff'
  document.body.appendChild(container)

  const root = createRoot(container)
  await new Promise<void>(resolve => {
    root.render(createElement(PayslipView, { ...props, showPrintButton: false }))
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

  const target = (container.querySelector('#payslip-print-root') as HTMLElement | null) ?? container
  const canvas = await html2canvas(target, { backgroundColor: '#ffffff', scale: 2, useCORS: true })

  root.unmount()
  document.body.removeChild(container)
  return canvas
}

function buildFilename(employeeName: string, period: string, ext: string) {
  const [y, m] = period.split('-')
  return `${employeeName}_${y.slice(2)}년_${parseInt(m, 10)}월분 급여명세서.${ext}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function exportPayslipToImage(props: PayslipViewProps) {
  const canvas = await renderPayslipToCanvas(props)
  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('이미지 생성에 실패했습니다')
  downloadBlob(blob, buildFilename(props.employeeName, props.period, 'png'))
}

export async function exportPayslipToPdf(props: PayslipViewProps) {
  const canvas = await renderPayslipToCanvas(props)
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 5
  const availW = pageWidth - margin * 2
  const availH = pageHeight - margin * 2
  const imgRatio = canvas.width / canvas.height
  let w = availW
  let h = w / imgRatio
  if (h > availH) {
    h = availH
    w = h * imgRatio
  }
  const x = (pageWidth - w) / 2
  const imgData = canvas.toDataURL('image/png')
  pdf.addImage(imgData, 'PNG', x, margin, w, h, undefined, 'FAST')
  pdf.save(buildFilename(props.employeeName, props.period, 'pdf'))
}

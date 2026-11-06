/**
 * 시범 운영 비교용 CSV — 내보내기(시스템 결과)와 가져오기(수기 계산표). 순수 함수.
 * 열: ref, date, trip, nightTravel, overtime, nightOvertime, holidayWithin8, holidayOver8
 * 시급·급여·이름은 넣지 않는다. ref 는 호출자가 정하는 식별자다.
 */
import { PILOT_KEYS, type Hours, type ManualRow, type PilotKey, type SystemRow } from './compare'

export const PILOT_CSV_HEADER = ['ref', 'date', ...PILOT_KEYS, 'heldKeys'] as const

/** 스프레드시트에서 수식으로 실행될 수 있는 첫 글자를 막는다 */
function safeCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const num = (n: number | undefined) => (n === undefined ? '' : String(Math.round(n * 1000) / 1000))

/** 시스템 결과를 수기 계산 담당자에게 줄 CSV 로 만든다. 확정값과 제안값을 합쳐 보이고, 제안값인 열은 heldKeys 에 적는다 */
export function toPilotCsv(rows: SystemRow[]): string {
  const lines = [PILOT_CSV_HEADER.join(',')]
  const sorted = [...rows].sort((a, b) => a.ref.localeCompare(b.ref) || a.date.localeCompare(b.date))
  for (const r of sorted) {
    const cells = PILOT_KEYS.map((k) => {
      const total = (r.confirmed[k] ?? 0) + (r.held[k] ?? 0)
      return total > 0 ? num(total) : ''
    })
    const held = PILOT_KEYS.filter((k) => r.held[k] !== undefined).join('|')
    lines.push([safeCell(r.ref), r.date, ...cells, held].join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

export interface CsvIssue { line: number; message: string }

/** 따옴표·쉼표·줄바꿈을 처리하는 최소 CSV 파서 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function validDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * 수기 계산표 CSV 를 읽는다. ref·date 열이 필수이고, 값 열은 없어도 된다(0 으로 본다).
 * 잘못된 줄은 건너뛰고 issues 에 줄 번호와 이유를 남긴다 — 조용히 고치거나 버리지 않는다.
 */
export function parseManualCsv(text: string): { rows: ManualRow[]; issues: CsvIssue[] } {
  const table = parseCsv(text)
  const issues: CsvIssue[] = []
  if (table.length === 0) return { rows: [], issues: [{ line: 1, message: '내용이 없습니다' }] }
  const header = table[0].map((h) => h.trim())
  const col = (name: string) => header.indexOf(name)
  if (col('ref') < 0 || col('date') < 0) {
    return { rows: [], issues: [{ line: 1, message: '머리글에 ref, date 열이 필요합니다' }] }
  }
  const keyCols = PILOT_KEYS.map((k) => [k, col(k)] as const).filter(([, i]) => i >= 0)
  const rows: ManualRow[] = []
  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2
    const ref = (cells[col('ref')] ?? '').trim()
    const date = (cells[col('date')] ?? '').trim()
    if (!ref) { issues.push({ line, message: 'ref 가 비어 있습니다' }); return }
    if (!validDate(date)) { issues.push({ line, message: `날짜 형식이 올바르지 않습니다 (YYYY-MM-DD): ${date}` }); return }
    const hours: Hours = {}
    let bad: string | null = null
    for (const [key, i] of keyCols) {
      const raw = (cells[i] ?? '').trim()
      if (raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > 48) { bad = `${key} 값이 올바르지 않습니다 (0~48 시간): ${raw}`; break }
      if (n > 0) hours[key as PilotKey] = n
    }
    if (bad) { issues.push({ line, message: bad }); return }
    rows.push({ ref, date, hours })
  })
  return { rows, issues }
}

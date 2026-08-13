/** 건강보험공단 "사업장별 고지내역" CSV(EUC-KR) 파싱 — 성명별 건강보험/장기요양보험 고지보험료(근로자 부담분) 추출 */
export interface HealthInsuranceRow {
  health: number
  longTermCare: number
}

/** 급여대장에서 업로드한 4대보험 근로자 부담분을 직원명별로 모아두는 통합 타입 */
export interface InsuranceRow {
  health?: number
  longTermCare?: number
  nationalPension?: number
  employment?: number
}

export async function parseHealthInsuranceCsv(file: File): Promise<Record<string, HealthInsuranceRow>> {
  const buf = await file.arrayBuffer()
  const text = new TextDecoder('euc-kr').decode(buf)
  const result: Record<string, HealthInsuranceRow> = {}

  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(',')
    if (cols.length < 27) continue
    const seq = cols[0].trim()
    if (!/^\d+$/.test(seq)) continue // 헤더/빈 줄 제외

    const name = cols[3].trim()
    const health = Number(cols[13].trim())
    const longTermCare = Number(cols[26].trim())
    if (!name || isNaN(health) || isNaN(longTermCare)) continue

    result[name] = { health, longTermCare }
  }
  return result
}

function findHeaderColumns(text: string, columnNames: string[]): { rows: string[]; indices: number[] } | null {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    const indices = columnNames.map(name => cols.indexOf(name))
    if (indices.every(idx => idx !== -1)) {
      return { rows: lines.slice(i + 1), indices }
    }
  }
  return null
}

/** 국민연금공단 고지내역 CSV — 결정보험료(근로자+사업주 합산, 각 4.75%로 정확히 반반)를 반으로 나눠 근로자 부담분 산출 */
export async function parseNationalPensionCsv(file: File): Promise<Record<string, number>> {
  const buf = await file.arrayBuffer()
  const text = new TextDecoder('euc-kr').decode(buf)
  const result: Record<string, number> = {}

  const found = findHeaderColumns(text, ['가입자명', '결정보험료'])
  if (!found) return result
  const [nameIdx, feeIdx] = found.indices

  for (const line of found.rows) {
    const cols = line.split(',')
    if (cols.length <= Math.max(nameIdx, feeIdx)) continue
    const name = cols[nameIdx].trim()
    const total = Number(cols[feeIdx].trim())
    if (!name || isNaN(total)) continue
    result[name] = Math.round(total / 2 / 10) * 10
  }
  return result
}

/** 고용보험 고지내역 CSV — 결정보험료는 근로자+사업주 합산(고용안정 부분은 사업주 전액이라 반으로 못 나눔),
 * 월평균보수월액 × 0.9%(실업급여 근로자 부담률)로 근로자 부담분 산출 */
export async function parseEmploymentInsuranceCsv(file: File): Promise<Record<string, number>> {
  const buf = await file.arrayBuffer()
  const text = new TextDecoder('euc-kr').decode(buf)
  const result: Record<string, number> = {}

  const found = findHeaderColumns(text, ['가입자명', '월평균보수월액'])
  if (!found) return result
  const [nameIdx, baseIdx] = found.indices

  for (const line of found.rows) {
    const cols = line.split(',')
    if (cols.length <= Math.max(nameIdx, baseIdx)) continue
    const name = cols[nameIdx].trim()
    const base = Number(cols[baseIdx].trim())
    if (!name || isNaN(base)) continue
    result[name] = Math.round(base * 0.009 / 10) * 10
  }
  return result
}

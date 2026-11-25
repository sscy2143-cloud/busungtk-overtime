/**
 * 출장수당이 급여·명세서 집계에 섞이지 않는다는 것을 코드 수준에서 고정한다 (급여 반영 OFF 유지, 이중 집계 방지).
 * 기존 야근 화면(신청·승인)에는 스위치가 꺼지면 아무것도 그리지 않는 안내 컴포넌트 한 줄씩만 연결돼 있다.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const src = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(src, rel), 'utf8')

describe('출장 ↔ 급여 격리', () => {
  it.each(['pages/AdminPayslipPage.tsx', 'pages/AdminPayrollPage.tsx', 'pages/AdminOvertimePayPage.tsx', 'pages/AdminLeavePayPage.tsx', 'pages/PayslipListPage.tsx'])(
    '%s 는 출장 모듈·출장 글루를 import 하지 않는다',
    (f) => {
      const t = read(f)
      expect(t).not.toMatch(/features\/trip|pages\/trip|\.\/trip\//)
      expect(t).not.toMatch(/trip_(claims|day_calcs|claim_days)/)
    },
  )

  it('야근 신청·승인 화면은 정해진 출장 연결 부품만 쓴다 (출장 표·조회 직접 참조 없음)', () => {
    const allowed: Record<string, string[]> = {
      // 2026-11-25: 신청 화면 맨 위 근무 장소 선택 + 출장일 때 출장 화면을 통째로 끼움 (야근 양식·저장 로직은 그대로)
      'pages/RequestPage.tsx': ['./trip/TripRequestHint', './trip/TripConnected', './trip/trip-glue', './trip/WorkKindPicker', 'features/trip'],
      'pages/AdminApprovalsPage.tsx': ['./trip/TripPendingNotice'],
    }
    for (const [f, want] of Object.entries(allowed)) {
      const t = read(f)
      const refs = t.match(/features\/trip|pages\/trip|\.\/trip\/[A-Za-z-]+/g) ?? []
      expect(refs, f).toEqual(want)
      expect(t).not.toMatch(/trip_(claims|day_calcs|claim_days)|reviewQueue|myClaims/)
    }
  })

  it('출장 모듈은 야근·급여 테이블을 읽지 않는다', () => {
    const dir = path.join(src, 'features/trip')
    const files: string[] = []
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? (e.name !== '__tests__' ? walk(path.join(d, e.name)) : undefined) : /\.(ts|tsx)$/.test(e.name) && files.push(path.join(d, e.name))))
    walk(dir)
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), path.relative(src, f)).not.toMatch(/from\(['"](payslips|payroll|overtime_requests)['"]\)/)
  })
})

/**
 * 통합 불변식 — 기존 앱 파일을 문자열로 읽어 확인한다.
 *  1) 급여명세서 최소 핫픽스(9f9fd1f)가 그대로인지
 *  2) 기존 급여·야근 라우트와 게이트가 바뀌지 않았는지
 *  3) 출장 라우트·메뉴가 코드 스위치 뒤에 있는지
 * 글루 밖의 기존 파일은 건드리지 않는 것이 원칙이므로, 여기 적힌 것 외의 변경은 코드 리뷰에서 잡는다.
 */
import { describe, expect, it } from 'vitest'
import app from '../App.tsx?raw'
import sidebar from '../components/layout/Sidebar.tsx?raw'
import dashboard from '../pages/DashboardPage.tsx?raw'
import tripConnected from '../pages/trip/TripConnected.tsx?raw'
import tripViewerPage from '../pages/trip/TripViewerPage.tsx?raw'
import useTripViewGrant from '../pages/trip/useTripViewGrant.ts?raw'
import employeePage from '../pages/AdminEmployeeManagementPage.tsx?raw'
import requestPage from '../pages/RequestPage.tsx?raw'

const route = (path: string) => (app.match(new RegExp(`<Route path="${path}" element=\\{(.*)\\} />`)) || [])[1] ?? ''
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('급여명세서 최소 핫픽스 유지', () => {
  it('/payslips 는 대시보드 리다이렉트, PayslipListPage 는 import 되지 않는다', () => {
    expect(route('payslips')).toBe('<Navigate to="/" replace />')
    expect(code(app)).not.toMatch(/import .*PayslipListPage/)
  })
  it('직원 대시보드에 급여명세서 조회·카드가 없다', () => {
    const src = code(dashboard)
    expect(src).not.toMatch(/from\(['"]payslips['"]\)/)
    expect(src).not.toMatch(/navigate\(['"]\/payslips['"]\)/)
    expect(src).not.toContain('data-tour="payslips"')
  })
})

describe('기존 급여·야근 라우트 원형 유지', () => {
  it.each([
    ['admin/payslips', '<AdminRoute><SecondAuthGate><PayPasswordGate><AdminPayslipPage /></PayPasswordGate></SecondAuthGate></AdminRoute>'],
    ['admin/payroll', '<AdminRoute><SecondAuthGate><PayPasswordGate><AdminPayrollPage /></PayPasswordGate></SecondAuthGate></AdminRoute>'],
    ['admin/overtime/pay', '<AdminRoute><SecondAuthGate><PayPasswordGate><AdminOvertimePayPage /></PayPasswordGate></SecondAuthGate></AdminRoute>'],
    ['admin/overtime/leave-pay', '<AdminRoute><SecondAuthGate><PayPasswordGate><AdminLeavePayPage /></PayPasswordGate></SecondAuthGate></AdminRoute>'],
    ['admin/approvals', '<AdminRoute><AdminApprovalsPage /></AdminRoute>'],
    ['request', '<RequestPage />'],
    ['requests', '<RequestListPage />'],
  ])('%s', (path, element) => {
    expect(route(path)).toBe(element)
  })
  it('급여 재인증·권한관리 코드(secpatch·master 미커밋)는 포함되지 않았다', () => {
    expect(app).not.toContain('PayrollReauthGate')
    expect(app).not.toContain('RequirePermission')
    expect(app).not.toContain('adminPermissions')
  })
})

describe('출장 라우트·메뉴는 코드 스위치 뒤에 있다', () => {
  it('라우트 2개: 직원은 로그인 영역, 관리자는 AdminRoute 안', () => {
    expect(route('trip')).toBe('<TripEmployeePage />')
    expect(route('admin/trip')).toBe('<AdminRoute><AdminTripPage /></AdminRoute>')
    expect(route('trip/all')).toBe('<TripViewerPage />')
    expect(app.indexOf('path="trip/all"')).toBeGreaterThan(app.indexOf('<ProtectedRoute><ActiveEmployeeGuard><AppLayout />'))
    expect(app.indexOf('path="trip"')).toBeGreaterThan(app.indexOf('<ProtectedRoute><ActiveEmployeeGuard><AppLayout />'))
  })
  it('사이드바 항목은 TRIP_FEATURE 조건 안에만 있다', () => {
    expect(sidebar).toContain("import { TRIP_FEATURE } from '../../features/trip/ui'")
    expect(sidebar).toMatch(/\{TRIP_FEATURE\.employeeForm && \(\s*<NavLink to="\/trip"/)
    expect(sidebar).toMatch(/\{TRIP_FEATURE\.adminReview && isSuperAdmin && \(\s*<NavLink to="\/admin\/trip"/)
    // 조회 권한자 메뉴는 코드 스위치 + 서버 권한(useTripViewGrant) + admin 제외 조건 안에만
    expect(sidebar).toMatch(/\{TRIP_FEATURE\.adminReview && tripViewGranted && !isSuperAdmin && \(\s*<NavLink to="\/trip\/all"/)
    expect(sidebar.match(/to="\/trip"/g)).toHaveLength(1)
    expect(sidebar.match(/to="\/trip\/all"/g)).toHaveLength(1)
    expect(sidebar.match(/to="\/admin\/trip"/g)).toHaveLength(1)
  })
  it('조회 권한 화면은 계정 전환 시 새로 만들고, 복귀·주기마다 서버 값으로 다시 채우며, 메뉴 권한은 사용자 id 에 묶인다', () => {
    expect(tripConnected).toMatch(/<TripRemoteProvider\s+key=\{employee\.id\}/)
    expect(tripConnected).toContain('revalidateKey={revalidateKey}')
    expect(tripViewerPage).toContain('useRevalidateKey()')
    expect(tripViewerPage).toContain('<TripConnected revalidateKey={revalidateKey}>')
    expect(useTripViewGrant).toContain("addEventListener('visibilitychange'")
    expect(useTripViewGrant).toContain('state?.id === id && state.granted')
    expect(useTripViewGrant).toContain("role !== 'admin'")
  })
  it('직원관리: 회사 직급(position)은 시스템 역할과 별개 필드이고 대표만 바꾸며, 빈 값은 NULL', () => {
    expect(employeePage).toContain("const POSITION_OPTIONS = ['팀장']")
    expect(employeePage).toContain('const safePosition = isAdmin ? (position.trim() || null) : (editPanel.employee.position ?? null)')
    // 005(직급 칼럼) 적용 전 DB 호환: 칼럼이 있을 때만 position 을 보내고 입력란도 그때만 보인다
    expect(employeePage).toContain("const hasPositionColumn = 'position' in editPanel.employee")
    expect(employeePage).toMatch(/hire_date: hireDate \|\| null,\s*\.\.\.\(hasPositionColumn \? \{ position: safePosition \} : \{\}\),\s*updated_at:/)
    expect(employeePage).toContain("'position' in editPanel.employee && (")
    expect(employeePage).toMatch(/value=\{editPanel\.form\.position\}\s*disabled=\{!isAdmin\}/)
    // 역할(role) 저장 규칙은 그대로
    expect(employeePage).toContain('const safeRole = isAdmin ? role : editPanel.employee.role')
  })
  it('D15: 직원 저장은 is_active 를 직접 쓰지 않고 서버 API(set_active, Ban 포함)로 바꾼다', () => {
    const start = employeePage.indexOf("supabase.from('employees').update({")
    const upd = employeePage.slice(start, employeePage.indexOf(".eq('id', empId)", start)).replace(/\/\/.*$/gm, '')   // 주석 제외, 코드만
    expect(upd.length).toBeGreaterThan(50)
    expect(upd).not.toContain('is_active')
    expect(employeePage).toContain('const r = await setActiveViaApi(empId, isActive)')
    expect(employeePage).not.toMatch(/from\('employees'\)\.update\(\{ is_active:/)
  })
  it('일반 직원이 쓰는 직원 목록(야근 그룹 선택·출장 동행자)은 employees_directory 뷰만 읽고 시급을 요청하지 않는다', () => {
    expect(requestPage).toContain("from('employees_directory')")
    expect(requestPage).not.toContain("from('employees')")
    expect(tripConnected).toContain("from('employees_directory')")
    expect(tripConnected).not.toContain("from('employees')")
    expect(requestPage).not.toContain('hourly_wage')
    expect(tripConnected).not.toContain('hourly_wage')
  })
  it('급여명세서 관리자 메뉴는 관리자 블록 안 그대로', () => {
    expect(sidebar.indexOf('to="/admin/payslips"')).toBeGreaterThan(sidebar.indexOf('{isAdmin && ('))
    expect(sidebar).not.toContain('to="/payslips"')
  })
})

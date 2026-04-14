import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { AppLayout } from './components/layout/AppLayout'
import { PayPasswordGate } from './components/auth/PayPasswordGate'
import { LoginPage } from './pages/LoginPage'
import { PendingApprovalPage } from './pages/PendingApprovalPage'
import { DashboardPage } from './pages/DashboardPage'
import { RequestPage } from './pages/RequestPage'
import { RequestListPage } from './pages/RequestListPage'
import { TimesheetPage } from './pages/TimesheetPage'
import { LeavePage } from './pages/LeavePage'
import { LeaveRequestPage } from './pages/LeaveRequestPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminApprovalsPage } from './pages/AdminApprovalsPage'
import { AdminOvertimeDashboardPage } from './pages/AdminOvertimeDashboardPage'
import { AdminLeavePage } from './pages/AdminLeavePage'

import { AdminPayrollPage } from './pages/AdminPayrollPage'
import { AdminLeaveTypesPage } from './pages/AdminLeaveTypesPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { ExpensePage } from './pages/ExpensePage'
import { AdminExpensePage } from './pages/AdminExpensePage'
import { AdminDocumentsPage } from './pages/AdminDocumentsPage'
import { AdminOvertimeEmployeesPage } from './pages/AdminOvertimeEmployeesPage'
import { AdminOvertimePayPage } from './pages/AdminOvertimePayPage'
import { AdminLeavePayPage } from './pages/AdminLeavePayPage'

import { AdminEmployeeManagementPage } from './pages/AdminEmployeeManagementPage'
import { AdminCompLeavePage } from './pages/AdminCompLeavePage'
import { AdminLeaveBalancePage } from './pages/AdminLeaveBalancePage'
import { AdminPayslipPage } from './pages/AdminPayslipPage'
import { AdminNoticePage } from './pages/AdminNoticePage'
import { PayslipListPage } from './pages/PayslipListPage'
import { NoticeListPage } from './pages/NoticeListPage'
import { UserGuidePage } from './pages/UserGuidePage'
import { SettingsPage } from './pages/SettingsPage'
import { ForcePasswordChangePage } from './pages/ForcePasswordChangePage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
  </div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function ActiveEmployeeGuard({ children }: { children: React.ReactNode }) {
  const { employee, isDemo } = useAuth()
  if (isDemo) return <>{children}</>
  if (!employee || !employee.is_active) return <Navigate to="/pending" replace />
  if (employee.force_password_change) return <Navigate to="/force-password" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { employee } = useAuth()
  if (!employee || (employee.role !== 'manager' && employee.role !== 'admin')) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pending" element={<ProtectedRoute><PendingApprovalPage /></ProtectedRoute>} />
        <Route path="/force-password" element={<ProtectedRoute><ForcePasswordChangePage /></ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute><ActiveEmployeeGuard><AppLayout /></ActiveEmployeeGuard></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="request" element={<RequestPage />} />
          <Route path="requests" element={<RequestListPage />} />
          <Route path="timesheet" element={<TimesheetPage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="leave/request" element={<LeaveRequestPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="expenses" element={<ExpensePage />} />
          <Route path="payslips" element={<PayslipListPage />} />
          <Route path="notices" element={<NoticeListPage />} />
          <Route path="guide" element={<UserGuidePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
          <Route path="admin/approvals" element={<AdminRoute><AdminApprovalsPage /></AdminRoute>} />
          <Route path="admin/overtime" element={<AdminRoute><AdminOvertimeDashboardPage /></AdminRoute>} />
          <Route path="admin/employee-management" element={<AdminRoute><AdminEmployeeManagementPage /></AdminRoute>} />
          <Route path="admin/overtime/employees" element={<AdminRoute><AdminOvertimeEmployeesPage /></AdminRoute>} />
          <Route path="admin/overtime/pay" element={<AdminRoute><PayPasswordGate><AdminOvertimePayPage /></PayPasswordGate></AdminRoute>} />
          <Route path="admin/overtime/leave-pay" element={<AdminRoute><PayPasswordGate><AdminLeavePayPage /></PayPasswordGate></AdminRoute>} />
          <Route path="admin/leave" element={<AdminRoute><AdminLeavePage /></AdminRoute>} />
          <Route path="admin/leave/balance" element={<AdminRoute><AdminLeaveBalancePage /></AdminRoute>} />
          <Route path="admin/leave/comp" element={<AdminRoute><AdminCompLeavePage /></AdminRoute>} />
          <Route path="admin/leave-types" element={<AdminRoute><AdminLeaveTypesPage /></AdminRoute>} />

          <Route path="admin/expenses" element={<AdminRoute><AdminExpensePage /></AdminRoute>} />
          <Route path="admin/payroll" element={<AdminRoute><PayPasswordGate><AdminPayrollPage /></PayPasswordGate></AdminRoute>} />
          <Route path="admin/documents" element={<AdminRoute><AdminDocumentsPage /></AdminRoute>} />
          <Route path="admin/payslips" element={<AdminRoute><PayPasswordGate><AdminPayslipPage /></PayPasswordGate></AdminRoute>} />
          <Route path="admin/notices" element={<AdminRoute><AdminNoticePage /></AdminRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

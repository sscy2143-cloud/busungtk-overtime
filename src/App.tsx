import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { AppLayout } from './components/layout/AppLayout'
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
import { AdminLeavePage } from './pages/AdminLeavePage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { AdminPayrollPage } from './pages/AdminPayrollPage'
import { AdminLeaveTypesPage } from './pages/AdminLeaveTypesPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { ExpensePage } from './pages/ExpensePage'
import { AdminExpensePage } from './pages/AdminExpensePage'

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
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { employee } = useAuth()
  if (!employee || (employee.role !== 'manager' && employee.role !== 'admin')) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { employee } = useAuth()
  if (!employee || employee.role !== 'admin') {
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
        <Route path="/" element={<ProtectedRoute><ActiveEmployeeGuard><AppLayout /></ActiveEmployeeGuard></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="request" element={<RequestPage />} />
          <Route path="requests" element={<RequestListPage />} />
          <Route path="timesheet" element={<TimesheetPage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="leave/request" element={<LeaveRequestPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="expenses" element={<ExpensePage />} />
          <Route path="admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
          <Route path="admin/approvals" element={<AdminRoute><AdminApprovalsPage /></AdminRoute>} />
          <Route path="admin/leave" element={<AdminRoute><AdminLeavePage /></AdminRoute>} />
          <Route path="admin/leave-types" element={<AdminRoute><AdminLeaveTypesPage /></AdminRoute>} />
          <Route path="admin/users" element={<SuperAdminRoute><AdminUsersPage /></SuperAdminRoute>} />
          <Route path="admin/expenses" element={<AdminRoute><AdminExpensePage /></AdminRoute>} />
          <Route path="admin/payroll" element={<AdminRoute><AdminPayrollPage /></AdminRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

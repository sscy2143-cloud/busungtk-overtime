export type UserRole = 'employee' | 'manager' | 'admin'
export type EmployeeType = 'office' | 'field'
export type OvertimeType = 'extended' | 'night' | 'holiday'
export type RequestStatus = 'pending' | 'manager_approved' | 'approved' | 'rejected' | 'cancelled'
export type GroupMemberStatus = 'pending_confirm' | 'confirmed' | 'declined'
export type LeaveType = 'annual' | 'half_am' | 'half_pm' | 'special'
export type WarningLevel = 'normal' | 'caution' | 'warning' | 'exceeded'

export interface Employee {
  id: string
  name: string
  email: string
  avatar_url?: string
  department: string
  role: UserRole
  employee_type: EmployeeType
  hourly_wage: number
  manager_id: string | null
  hire_date: string | null
  is_active: boolean
  force_password_change?: boolean
  created_at: string
}

export interface OvertimeRequest {
  id: string
  employee_id: string
  employee?: Employee
  type: OvertimeType
  date: string
  planned_start: string
  planned_end: string
  reason: string
  site_name?: string
  work_details?: string
  work_category?: string | null
  status: RequestStatus
  is_retroactive: boolean
  group_id: string | null
  created_by: string
  approved_by: string | null
  approved_at: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  rejection_reason: string | null
  created_at: string
}

export interface TimeRecord {
  id: string
  request_id: string
  employee_id: string
  actual_start: string | null
  actual_end: string | null
  total_minutes: number
  extended_minutes: number
  night_minutes: number
  holiday_minutes: number
  is_manually_edited: boolean
  edit_reason: string | null
  created_at: string
}

export interface WeeklySummary {
  id: string
  employee_id: string
  employee?: Employee
  week_start: string
  base_hours: number
  overtime_hours: number
  total_hours: number
  warning_level: WarningLevel
}

export interface LeaveBalance {
  id: string
  employee_id: string
  employee?: Employee
  year: number
  total_days: number
  used_days: number
  remaining_days: number
  substitute_total: number
  substitute_used: number
}

export interface SubstituteHistory {
  id: string
  employee_id: string
  granted_days: number
  reason: string
  related_request_id: string | null
  granted_by: string
  created_at: string
}

export interface LeaveRequest {
  id: string
  employee_id: string
  employee?: Employee
  type: LeaveType
  start_date: string
  end_date: string
  days: number
  reason: string
  status: RequestStatus
  approved_by: string | null
  approved_at: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  rejection_reason: string | null
  use_substitute: boolean
  created_at: string
  cancel_requested_at?: string | null
  cancel_reason?: string | null
  cancel_approved_at?: string | null
  cancel_approved_by?: string | null
  cancel_rejected_at?: string | null
  cancel_rejected_by?: string | null
  cancel_rejection_reason?: string | null
}

export interface Notification {
  id: string
  recipient_id: string
  type: string
  title: string
  body: string
  reference_id: string | null
  is_read: boolean
  created_at: string
}

export interface ApprovalHistory {
  id: string
  request_id: string
  request_type: 'overtime' | 'leave'
  from_status: RequestStatus
  to_status: RequestStatus
  changed_by: string
  reason: string | null
  created_at: string
}

export const OVERTIME_TYPE_LABEL: Record<OvertimeType, string> = {
  extended: '연장근무',
  night: '야간근무',
  holiday: '휴일근무',
}

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: '대기중',
  manager_approved: '1차 승인',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
}

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: '연차',
  half_am: '오전반차',
  half_pm: '오후반차',
  special: '기타',
}

export const WARNING_LEVEL_COLOR: Record<WarningLevel, string> = {
  normal: 'bg-success-500',
  caution: 'bg-warning-500',
  warning: 'bg-danger-400',
  exceeded: 'bg-danger-600',
}

export type ExpenseCategory = 'meal' | 'transport' | 'supplies' | 'other'
export type PaymentMethod = 'card' | 'transfer' | 'cash' | 'other'

export interface Expense {
  id: string
  employee_id: string
  employee?: Employee
  date: string
  category: ExpenseCategory
  amount: number
  description: string
  receipt_url?: string
  payment_method?: PaymentMethod
  status: RequestStatus
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
  paid_at: string | null
  paid_amount: number | null
  payout_method: string | null
  payment_bank: string | null
  payment_account: string | null
  payment_note: string | null
  paid_by: string | null
  employee_confirmed_at: string | null
  confirmed_device: string | null
  cancel_requested_at: string | null
  cancel_reason: string | null
  admin_note: string | null
  created_at: string
}

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  meal: '식비',
  transport: '교통비',
  supplies: '소모품/자재',
  other: '기타',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: '카드결제',
  transfer: '계좌이체',
  cash: '현금결제',
  other: '기타',
}

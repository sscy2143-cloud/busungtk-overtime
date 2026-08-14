import { useState, useEffect, useMemo, useCallback } from 'react'
import { Users, UserCheck, UserX, X, Plus, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { ReauthGate } from '../components/auth/ReauthGate'
import type { Employee, UserRole, EmployeeType } from '../types'

const ROLE_LABEL: Record<UserRole, string> = {
  employee: '직원',
  manager: '인사담당',
  admin: '대표',
}

const ROLE_COLOR: Record<UserRole, string> = {
  employee: 'bg-primary-50 text-primary-700',
  manager: 'bg-dark-50 text-dark-700',
  admin: 'bg-purple-50 text-purple-700',
}

const EMP_TYPE_LABEL: Record<EmployeeType, string> = {
  office: '사무직',
  field: '현장직',
}

const DEPT_STORAGE_KEY = 'busungtk-departments'
const DEFAULT_DEPARTMENTS = ['현장운영팀', '사무팀', '마케팅부서']

function loadDepartments(): string[] {
  try {
    const saved = localStorage.getItem(DEPT_STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return DEFAULT_DEPARTMENTS
}

function saveDepartments(deps: string[]) {
  localStorage.setItem(DEPT_STORAGE_KEY, JSON.stringify(deps))
}

interface FormState {
  name: string
  department: string
  role: UserRole
  employeeType: EmployeeType
  hourlyWage: string
  hireDate: string
  isActive: boolean
}

interface EditPanel {
  open: boolean
  employee: Employee | null
  form: FormState
  originalForm: FormState
  adminPassword: string
  newPassword: string
  accountError: string
  accountLoading: boolean
}

interface CreateModal {
  open: boolean
  employeeNumber: string
  name: string
  department: string
  role: UserRole
  password: string
  passwordConfirm: string
}

interface UnsavedGuard {
  open: boolean
  nextAction: (() => void) | null
}

interface PayrollFormState {
  birthDate: string
  baseSalary: string
  annualSalary: string
  fixedAllowanceEnabled: boolean
  fixedAllowanceType: string
  isExecutive: boolean
  dependentsCount: string
  childrenUnder20Count: string
  studentLoanEnabled: boolean
  studentLoanStart: string
  studentLoanEnd: string
  studentLoanAmount: string
  smeTaxReductionEnabled: boolean
  smeTaxReductionStart: string
  smeTaxReductionEnd: string
  smeReductionApplicable: string
  smeIncomeReductionRate: string
  doorunuriApplicable: boolean
  doorunuriPensionReductionRate: string
  doorunuriEmploymentReductionRate: string
  salaryBank: string
  salaryAccount: string
  pensionBank: string
  pensionAccount: string
}

const BANK_OPTIONS = ['하나은행', '신한은행', '국민은행', '우리은행', '기업은행', '농협은행', '카카오뱅크', '토스뱅크', '새마을금고', '기타']

function makeEmptyPayrollForm(): PayrollFormState {
  return {
    birthDate: '',
    baseSalary: '',
    annualSalary: '',
    fixedAllowanceEnabled: false,
    fixedAllowanceType: '',
    isExecutive: false,
    dependentsCount: '1',
    childrenUnder20Count: '0',
    studentLoanEnabled: false,
    studentLoanStart: '',
    studentLoanEnd: '',
    studentLoanAmount: '',
    smeTaxReductionEnabled: false,
    smeTaxReductionStart: '',
    smeTaxReductionEnd: '',
    smeReductionApplicable: '',
    smeIncomeReductionRate: '',
    doorunuriApplicable: false,
    doorunuriPensionReductionRate: '',
    doorunuriEmploymentReductionRate: '',
    salaryBank: '',
    salaryAccount: '',
    pensionBank: '',
    pensionAccount: '',
  }
}

interface PayrollInfoRow {
  birth_date: string | null
  base_salary: number
  annual_salary: number
  fixed_allowance_enabled: boolean
  fixed_allowance_type: string | null
  is_executive: boolean
  dependents_count: number
  children_under20_count: number
  student_loan_status: string | null
  student_loan_start: string | null
  student_loan_end: string | null
  student_loan_amount: number
  sme_tax_reduction_enabled: boolean
  sme_tax_reduction_start: string | null
  sme_tax_reduction_end: string | null
  sme_reduction_applicable: string | null
  sme_income_reduction_rate: number | null
  doorunuri_applicable: boolean
  doorunuri_pension_reduction_rate: number | null
  doorunuri_employment_reduction_rate: number | null
  salary_bank: string | null
  salary_account: string | null
  pension_bank: string | null
  pension_account: string | null
}

function payrollRowToForm(row: PayrollInfoRow | null): PayrollFormState {
  if (!row) return makeEmptyPayrollForm()
  return {
    birthDate: row.birth_date ?? '',
    baseSalary: row.base_salary ? String(row.base_salary) : '',
    annualSalary: row.annual_salary ? String(row.annual_salary) : '',
    fixedAllowanceEnabled: row.fixed_allowance_enabled,
    fixedAllowanceType: row.fixed_allowance_type ?? '',
    isExecutive: row.is_executive,
    dependentsCount: String(row.dependents_count ?? 1),
    childrenUnder20Count: String(row.children_under20_count ?? 0),
    studentLoanEnabled: !!(row.student_loan_status && row.student_loan_status !== '아니오'),
    studentLoanStart: row.student_loan_start ?? '',
    studentLoanEnd: row.student_loan_end ?? '',
    studentLoanAmount: row.student_loan_amount ? String(row.student_loan_amount) : '',
    smeTaxReductionEnabled: row.sme_tax_reduction_enabled,
    smeTaxReductionStart: row.sme_tax_reduction_start ?? '',
    smeTaxReductionEnd: row.sme_tax_reduction_end ?? '',
    smeReductionApplicable: row.sme_reduction_applicable ?? '',
    smeIncomeReductionRate: row.sme_income_reduction_rate != null ? String(row.sme_income_reduction_rate) : '',
    doorunuriApplicable: row.doorunuri_applicable,
    doorunuriPensionReductionRate: row.doorunuri_pension_reduction_rate != null ? String(row.doorunuri_pension_reduction_rate) : '',
    doorunuriEmploymentReductionRate: row.doorunuri_employment_reduction_rate != null ? String(row.doorunuri_employment_reduction_rate) : '',
    salaryBank: row.salary_bank ?? '',
    salaryAccount: row.salary_account ?? '',
    pensionBank: row.pension_bank ?? '',
    pensionAccount: row.pension_account ?? '',
  }
}

function payrollFormsEqual(a: PayrollFormState, b: PayrollFormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function makeEmptyForm(emp: Employee): FormState {
  return {
    name: emp.name,
    department: emp.department,
    role: emp.role,
    employeeType: emp.employee_type,
    hourlyWage: emp.hourly_wage > 0 ? String(emp.hourly_wage) : '',
    hireDate: emp.hire_date ?? '',
    isActive: emp.is_active,
  }
}

function getEmployeeNumber(email: string): string {
  if (email.endsWith('@busungtk.internal')) {
    return email.replace('@busungtk.internal', '').toUpperCase()
  }
  return email
}

function formsEqual(a: FormState, b: FormState): boolean {
  return (
    a.name === b.name &&
    a.department === b.department &&
    a.role === b.role &&
    a.employeeType === b.employeeType &&
    a.hourlyWage === b.hourlyWage &&
    a.hireDate === b.hireDate &&
    a.isActive === b.isActive
  )
}

export function AdminEmployeeManagementPage() {
  const { employee: currentUser, session } = useAuth()
  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'manager'
  const canCreate = isAdmin || isManager

  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [listTab, setListTab] = useState<'active' | 'resigned'>('active')
  const [departments, setDepartments] = useState<string[]>(loadDepartments)
  const [deptModal, setDeptModal] = useState(false)
  const [newDeptName, setNewDeptName] = useState('')
  const [editingDept, setEditingDept] = useState<{ index: number; name: string } | null>(null)

  const updateDepartments = useCallback((deps: string[]) => {
    setDepartments(deps)
    saveDepartments(deps)
  }, [])

  const [editPanel, setEditPanel] = useState<EditPanel>({
    open: false,
    employee: null,
    form: { name: '', department: '', role: 'employee', employeeType: 'office', hourlyWage: '', hireDate: '', isActive: true },
    originalForm: { name: '', department: '', role: 'employee', employeeType: 'office', hourlyWage: '', hireDate: '', isActive: true },
    adminPassword: '',
    newPassword: '',
    accountError: '',
    accountLoading: false,
  })

  const [createModal, setCreateModal] = useState<CreateModal>({
    open: false, employeeNumber: '', name: '', department: '', role: 'employee', password: '', passwordConfirm: '',
  })
  const [createError, setCreateError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createMode, setCreateMode] = useState<'single' | 'bulk'>('single')
  const [bulkRows, setBulkRows] = useState<{ employeeNumber: string; name: string; department: string; password: string }[]>(
    Array.from({ length: 5 }, () => ({ employeeNumber: '', name: '', department: '', password: '' }))
  )
  const [bulkResults, setBulkResults] = useState<{ row: number; name: string; success: boolean; error?: string }[]>([])

  const [resignConfirm, setResignConfirm] = useState<{ id: string; name: string } | null>(null)
  const [reinstateConfirm, setReinstateConfirm] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)

  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [editTab, setEditTab] = useState<'basic' | 'payroll' | 'account' | 'resign'>('basic')
  const [payrollTabUnlocked, setPayrollTabUnlocked] = useState(false)

  const [payrollForm, setPayrollForm] = useState<PayrollFormState>(makeEmptyPayrollForm())
  const [payrollOriginalForm, setPayrollOriginalForm] = useState<PayrollFormState>(makeEmptyPayrollForm())
  const [payrollLoading, setPayrollLoading] = useState(false)
  const [payrollSaveLoading, setPayrollSaveLoading] = useState(false)
  const [payrollSaveError, setPayrollSaveError] = useState('')

  const [unsavedGuard, setUnsavedGuard] = useState<UnsavedGuard>({ open: false, nextAction: null })

  useEffect(() => {
    supabase.rpc('list_all_employees').then(({ data }) => {
      if (data) setEmployees(data as Employee[])
      setLoading(false)
    })
  }, [])

  const activeEmps = useMemo(() => employees.filter(e => e.is_active), [employees])
  const resignedEmps = useMemo(() => employees.filter(e => !e.is_active), [employees])
  const displayEmps = listTab === 'active' ? activeEmps : resignedEmps

  // --- Edit panel helpers ---

  function openEdit(emp: Employee) {
    const form = makeEmptyForm(emp)
    setEditPanel({
      open: true,
      employee: emp,
      form,
      originalForm: form,
      adminPassword: '',
      newPassword: '',
      accountError: '',
      accountLoading: false,
    })
    setEditTab('basic')
    setPayrollTabUnlocked(false)
    setPayrollSaveError('')
    setPayrollLoading(true)
    supabase
      .from('employee_payroll_info')
      .select('*')
      .eq('employee_id', emp.id)
      .maybeSingle<PayrollInfoRow>()
      .then(({ data }) => {
        const loaded = payrollRowToForm(data)
        setPayrollForm(loaded)
        setPayrollOriginalForm(loaded)
        setPayrollLoading(false)
      })
  }

  function isPayrollDirty(): boolean {
    return !payrollFormsEqual(payrollForm, payrollOriginalForm)
  }

  async function savePayrollInfo() {
    if (!editPanel.employee) return
    setPayrollSaveError('')
    if (!payrollForm.baseSalary.trim() || !payrollForm.annualSalary.trim() || !payrollForm.salaryBank.trim() || !payrollForm.salaryAccount.trim()) {
      setPayrollSaveError('월급, 연봉, 급여은행, 급여계좌는 필수 입력 항목입니다')
      return
    }
    setPayrollSaveLoading(true)
    const p = payrollForm
    const { error } = await supabase.from('employee_payroll_info').upsert({
      employee_id: editPanel.employee.id,
      birth_date: p.birthDate || null,
      base_salary: parseInt(p.baseSalary.replace(/,/g, ''), 10) || 0,
      annual_salary: parseInt(p.annualSalary.replace(/,/g, ''), 10) || 0,
      fixed_allowance_enabled: p.fixedAllowanceEnabled,
      fixed_allowance_type: p.fixedAllowanceEnabled ? (p.fixedAllowanceType || null) : null,
      is_executive: p.isExecutive,
      dependents_count: parseInt(p.dependentsCount, 10) || 1,
      children_under20_count: parseInt(p.childrenUnder20Count, 10) || 0,
      student_loan_status: p.studentLoanEnabled ? '상환중' : '아니오',
      student_loan_start: p.studentLoanEnabled ? (p.studentLoanStart || null) : null,
      student_loan_end: p.studentLoanEnabled ? (p.studentLoanEnd || null) : null,
      student_loan_amount: p.studentLoanEnabled ? (parseInt(p.studentLoanAmount.replace(/,/g, ''), 10) || 0) : 0,
      sme_tax_reduction_enabled: p.smeTaxReductionEnabled,
      sme_tax_reduction_start: p.smeTaxReductionEnabled ? (p.smeTaxReductionStart || null) : null,
      sme_tax_reduction_end: p.smeTaxReductionEnabled ? (p.smeTaxReductionEnd || null) : null,
      sme_reduction_applicable: p.smeTaxReductionEnabled ? (p.smeReductionApplicable || null) : null,
      sme_income_reduction_rate: p.smeTaxReductionEnabled && p.smeIncomeReductionRate ? Number(p.smeIncomeReductionRate) : null,
      doorunuri_applicable: p.doorunuriApplicable,
      doorunuri_pension_reduction_rate: p.doorunuriApplicable && p.doorunuriPensionReductionRate ? Number(p.doorunuriPensionReductionRate) : null,
      doorunuri_employment_reduction_rate: p.doorunuriApplicable && p.doorunuriEmploymentReductionRate ? Number(p.doorunuriEmploymentReductionRate) : null,
      salary_bank: p.salaryBank,
      salary_account: p.salaryAccount,
      pension_bank: p.pensionBank || null,
      pension_account: p.pensionAccount || null,
    }, { onConflict: 'employee_id' })
    setPayrollSaveLoading(false)
    if (error) {
      setPayrollSaveError('저장 실패: ' + error.message)
      return
    }
    setPayrollOriginalForm(payrollForm)
  }

  function closePanel() {
    setEditPanel(p => ({ ...p, open: false }))
  }

  function isDirty(): boolean {
    return !formsEqual(editPanel.form, editPanel.originalForm)
  }

  function requestClose() {
    if (isDirty() || isPayrollDirty()) {
      setUnsavedGuard({
        open: true,
        nextAction: () => closePanel(),
      })
    } else {
      closePanel()
    }
  }

  async function saveBasicInfo() {
    if (!editPanel.employee) return
    setSaveLoading(true)
    setSaveError('')
    try {
      const empId = editPanel.employee.id
      const { name, department, role, employeeType, hourlyWage, isActive } = editPanel.form
      const wage = parseInt(hourlyWage.replace(/,/g, ''), 10)

      // 모든 필드를 직접 테이블 UPDATE로 통합 (RPC 오버로드 충돌 우회)
      // manager는 role 변경 불가 — 원본 role 유지
      const safeRole = isAdmin ? role : editPanel.employee.role
      const { hireDate } = editPanel.form
      const { error: updateError } = await supabase.from('employees').update({
        name,
        department,
        role: safeRole,
        is_active: isActive,
        employee_type: employeeType,
        hourly_wage: isNaN(wage) ? 0 : wage,
        hire_date: hireDate || null,
        updated_at: new Date().toISOString(),
      }).eq('id', empId)

      if (updateError) {
        setSaveError('저장 실패: ' + updateError.message)
        return
      }

      setEmployees(prev => prev.map(e => e.id === empId ? {
        ...e,
        name,
        department,
        role,
        employee_type: employeeType,
        hourly_wage: isNaN(wage) ? 0 : wage,
        hire_date: hireDate || null,
        is_active: isActive,
      } : e))

      setEditPanel(p => ({ ...p, originalForm: p.form }))
    } finally {
      setSaveLoading(false)
    }
  }

  // --- Account tab ---

  async function handleResetPassword() {
    setEditPanel(p => ({ ...p, accountError: '', accountLoading: true }))
    const { adminPassword, newPassword, employee: emp } = editPanel
    if (!emp) return

    if (!adminPassword) {
      setEditPanel(p => ({ ...p, accountError: '본인 비밀번호를 입력하세요', accountLoading: false }))
      return
    }
    if (!newPassword) {
      setEditPanel(p => ({ ...p, accountError: '새 비밀번호를 입력하세요', accountLoading: false }))
      return
    }
    if (newPassword.length < 6) {
      setEditPanel(p => ({ ...p, accountError: '비밀번호는 6자 이상이어야 합니다', accountLoading: false }))
      return
    }

    try {
      const res = await fetch('/api/admin-user', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userId: emp.id, newPassword, adminPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEditPanel(p => ({ ...p, accountError: data.error || '비밀번호 초기화에 실패했습니다', accountLoading: false }))
        return
      }
      setEditPanel(p => ({ ...p, adminPassword: '', newPassword: '', accountError: '', accountLoading: false }))
      alert('비밀번호가 초기화되었습니다')
    } catch {
      setEditPanel(p => ({ ...p, accountError: '서버와 통신할 수 없습니다', accountLoading: false }))
    }
    setEditPanel(p => ({ ...p, accountLoading: false }))
  }

  async function confirmDeleteAccount() {
    if (!deleteConfirm) return
    await supabase.rpc('update_employee_admin', {
      p_id: deleteConfirm.id, p_is_active: false,
    })
    setEmployees(prev => prev.filter(e => e.id !== deleteConfirm.id))
    setDeleteConfirm(null)
    closePanel()
  }

  // --- Resign / reinstate ---

  async function handleResign(id: string) {
    await supabase.from('employees').update({ is_active: false }).eq('id', id)
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, is_active: false } : e))
    if (editPanel.employee?.id === id) {
      setEditPanel(p => ({
        ...p,
        employee: p.employee ? { ...p.employee, is_active: false } : p.employee,
        form: { ...p.form, isActive: false },
        originalForm: { ...p.originalForm, isActive: false },
      }))
    }
    setResignConfirm(null)
  }

  async function handleReinstate(id: string) {
    await supabase.from('employees').update({ is_active: true }).eq('id', id)
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, is_active: true } : e))
    if (editPanel.employee?.id === id) {
      setEditPanel(p => ({
        ...p,
        employee: p.employee ? { ...p.employee, is_active: true } : p.employee,
        form: { ...p.form, isActive: true },
        originalForm: { ...p.originalForm, isActive: true },
      }))
    }
    setReinstateConfirm(null)
  }

  // --- Create user ---

  async function handleCreateUser() {
    setCreateError('')
    const { employeeNumber, name, password, passwordConfirm, department, role } = createModal
    if (!employeeNumber.trim() || !name.trim() || !password) {
      setCreateError('사번, 이름, 비밀번호는 필수입니다')
      return
    }
    if (password.length < 6) {
      setCreateError('비밀번호는 6자 이상이어야 합니다')
      return
    }
    if (password !== passwordConfirm) {
      setCreateError('비밀번호가 일치하지 않습니다')
      return
    }
    setCreateLoading(true)
    try {
      const res = await fetch('/api/admin-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          employeeNumber: employeeNumber.trim(),
          name: name.trim(),
          password,
          department: department.trim(),
          role,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error || '직원 추가에 실패했습니다')
        setCreateLoading(false)
        return
      }
      const { data: refreshed } = await supabase.rpc('list_all_employees')
      if (refreshed) setEmployees(refreshed as Employee[])
      setCreateModal({ open: false, employeeNumber: '', name: '', department: '', role: 'employee', password: '', passwordConfirm: '' })
    } catch {
      setCreateError('서버와 통신할 수 없습니다')
    }
    setCreateLoading(false)
  }

  async function handleBulkCreate() {
    const validRows = bulkRows.filter(r => r.employeeNumber.trim() && r.name.trim() && r.password.trim())
    if (validRows.length === 0) {
      setCreateError('최소 1명의 정보를 입력하세요')
      return
    }
    const shortPw = validRows.find(r => r.password.length < 6)
    if (shortPw) {
      setCreateError(`${shortPw.name || shortPw.employeeNumber}: 비밀번호는 6자 이상이어야 합니다`)
      return
    }
    setCreateLoading(true)
    setCreateError('')
    setBulkResults([])
    const results: typeof bulkResults = []
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      try {
        const res = await fetch('/api/admin-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            employeeNumber: row.employeeNumber.trim(),
            name: row.name.trim(),
            password: row.password,
            department: row.department.trim(),
            role: 'employee',
          }),
        })
        const data = await res.json()
        results.push({ row: i + 1, name: row.name, success: res.ok, error: res.ok ? undefined : data.error })
      } catch {
        results.push({ row: i + 1, name: row.name, success: false, error: '서버 통신 실패' })
      }
    }
    setBulkResults(results)
    const successCount = results.filter(r => r.success).length
    if (successCount > 0) {
      const { data: refreshed } = await supabase.rpc('list_all_employees')
      if (refreshed) setEmployees(refreshed as Employee[])
    }
    if (results.every(r => r.success)) {
      setBulkRows(Array.from({ length: 5 }, () => ({ employeeNumber: '', name: '', department: '', password: '' })))
    }
    setCreateLoading(false)
  }

  // --- Unsaved guard actions ---

  async function guardSave() {
    if (isDirty()) await saveBasicInfo()
    if (isPayrollDirty()) await savePayrollInfo()
    if (unsavedGuard.nextAction) unsavedGuard.nextAction()
    setUnsavedGuard({ open: false, nextAction: null })
  }

  function guardDiscard() {
    if (unsavedGuard.nextAction) unsavedGuard.nextAction()
    setUnsavedGuard({ open: false, nextAction: null })
  }

  function guardCancel() {
    setUnsavedGuard({ open: false, nextAction: null })
  }

  // --- Current employee in panel (synced from list) ---
  const panelEmployee = editPanel.employee
    ? employees.find(e => e.id === editPanel.employee!.id) ?? editPanel.employee
    : null

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <p className="text-sm text-dark-400">불러오는 중...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark-900">직원 관리</h1>
          <p className="text-sm text-dark-500 mt-0.5">재직자 및 퇴직자 정보를 관리합니다</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setCreateModal({ open: true, employeeNumber: '', name: '', department: '', role: 'employee', password: '', passwordConfirm: '' })}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            직원 추가
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-center">
          <Users className="w-5 h-5 text-dark-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-dark-900">{employees.length}</p>
          <p className="text-xs text-dark-500">전체</p>
        </div>
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-center">
          <UserCheck className="w-5 h-5 text-success-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-success-600">{activeEmps.length}</p>
          <p className="text-xs text-dark-500">재직</p>
        </div>
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-center">
          <UserX className="w-5 h-5 text-dark-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-dark-500">{resignedEmps.length}</p>
          <p className="text-xs text-dark-500">퇴직</p>
        </div>
      </div>

      {/* Employee list + Excel sheet tabs */}
      <div>
        <div className="bg-white rounded-t-2xl border border-dark-100 border-b-0 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          {displayEmps.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-dark-400">{listTab === 'active' ? '재직 중인 직원이 없습니다' : '퇴직자가 없습니다'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead>
                <tr className="bg-dark-50 border-b border-dark-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">이름</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-dark-500">사번</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-dark-500">부서</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-dark-500">고용형태</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-dark-500">권한</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-dark-500">시급</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-dark-500">입사일</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-dark-500">등록일</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-dark-500">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-50">
                {displayEmps.map(emp => (
                  <tr key={emp.id} className="hover:bg-dark-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${emp.is_active ? 'bg-primary-100' : 'bg-dark-100'}`}>
                          <span className={`text-xs font-bold ${emp.is_active ? 'text-primary-700' : 'text-dark-400'}`}>
                            {emp.name.charAt(0)}
                          </span>
                        </div>
                        <span className={`font-medium ${emp.is_active ? 'text-dark-900' : 'text-dark-400'}`}>
                          {emp.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs font-mono text-dark-500">{getEmployeeNumber(emp.email)}</td>
                    <td className="px-3 py-3 text-xs text-dark-500">{emp.department || '-'}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">
                        {EMP_TYPE_LABEL[emp.employee_type]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[emp.role]}`}>
                        {ROLE_LABEL[emp.role]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-xs">
                      <span className="text-dark-300 tracking-widest" title="편집 화면의 급여정보 탭에서 확인">●●●●●●</span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-dark-500">
                      {emp.hire_date ? new Date(emp.hire_date + 'T00:00:00').toLocaleDateString('ko-KR') : <span className="text-dark-400">미설정</span>}
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-dark-500">
                      {new Date(emp.created_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => openEdit(emp)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                      >
                        편집
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>

        {/* Excel-style sheet tabs at bottom */}
        <div className="flex items-stretch border-x border-b border-dark-100 rounded-b-2xl bg-dark-50 overflow-hidden">
          <button
            onClick={() => setListTab('active')}
            className={`px-5 py-2.5 text-xs font-semibold border-r border-dark-100 transition-colors ${
              listTab === 'active'
                ? 'bg-white text-dark-900'
                : 'bg-dark-100 text-dark-400 hover:bg-dark-50 hover:text-dark-600'
            }`}
          >
            재직자 ({activeEmps.length})
          </button>
          <button
            onClick={() => setListTab('resigned')}
            className={`px-5 py-2.5 text-xs font-semibold border-r border-dark-100 transition-colors ${
              listTab === 'resigned'
                ? 'bg-white text-dark-900'
                : 'bg-dark-100 text-dark-400 hover:bg-dark-50 hover:text-dark-600'
            }`}
          >
            퇴직자 ({resignedEmps.length})
          </button>
          <div className="flex-1 bg-dark-100" />
        </div>
      </div>

      {/* ==================== Edit modal (centered popup) ==================== */}
      {editPanel.open && panelEmployee && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={requestClose} />
          <div className="relative bg-white w-full max-w-md rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
              <div>
                <h3 className="text-base font-bold text-dark-900">{panelEmployee.name} 편집</h3>
                <p className="text-xs text-dark-400 mt-0.5">{getEmployeeNumber(panelEmployee.email)}</p>
              </div>
              <button onClick={requestClose} className="p-1 rounded-lg hover:bg-dark-100 transition-colors">
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>

            {/* Tab content */}
            <div className="px-5 py-4 space-y-4">

              {/* === 시트1: 기본정보 === */}
              {editTab === 'basic' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">이름</label>
                    <input
                      type="text"
                      value={editPanel.form.name}
                      onChange={e => setEditPanel(p => ({ ...p, form: { ...p.form, name: e.target.value } }))}
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">사번</label>
                    <p className="text-sm font-mono text-dark-500 px-3 py-2 bg-dark-50 rounded-xl">
                      {getEmployeeNumber(panelEmployee.email)}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-dark-600">부서</label>
                      <button onClick={() => setDeptModal(true)} className="text-xs text-primary-500 hover:text-primary-700">부서 관리</button>
                    </div>
                    <select
                      value={editPanel.form.department}
                      onChange={e => setEditPanel(p => ({ ...p, form: { ...p.form, department: e.target.value } }))}
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                    >
                      <option value="">선택하세요</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                      {editPanel.form.department && !departments.includes(editPanel.form.department) && (
                        <option value={editPanel.form.department}>{editPanel.form.department}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">고용형태</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['office', 'field'] as EmployeeType[]).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setEditPanel(p => ({ ...p, form: { ...p.form, employeeType: t } }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            editPanel.form.employeeType === t
                              ? 'bg-primary-500 text-white border-primary-600'
                              : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                          }`}
                        >
                          {EMP_TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">권한</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['employee', 'manager', 'admin'] as UserRole[]).map(r => (
                        <button
                          key={r}
                          type="button"
                          disabled={!isAdmin}
                          onClick={() => setEditPanel(p => ({ ...p, form: { ...p.form, role: r } }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            editPanel.form.role === r
                              ? 'bg-primary-500 text-white border-primary-600'
                              : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {ROLE_LABEL[r]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">시급 (원)</label>
                    <input
                      type="number"
                      value={editPanel.form.hourlyWage}
                      onChange={e => setEditPanel(p => ({ ...p, form: { ...p.form, hourlyWage: e.target.value } }))}
                      placeholder="예: 10000"
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                    <p className="text-xs text-dark-400 mt-1">연장근무수당 자동 계산에 사용됩니다</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">입사일</label>
                    <input
                      type="date"
                      value={editPanel.form.hireDate}
                      onChange={e => setEditPanel(p => ({ ...p, form: { ...p.form, hireDate: e.target.value } }))}
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                    <p className="text-xs text-dark-400 mt-1">연차 부여 기준 (근속연수) 계산에 사용됩니다</p>
                  </div>
                  {saveError && (
                    <p className="text-xs text-red-500 text-center -mb-1">{saveError}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={requestClose}
                      className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
                    >
                      취소
                    </button>
                    <button
                      onClick={saveBasicInfo}
                      disabled={saveLoading || !isDirty()}
                      className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
                    >
                      {saveLoading ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </>
              )}

              {/* === 급여정보 === */}
              {editTab === 'payroll' && !payrollTabUnlocked && (
                <ReauthGate
                  compact
                  title="급여정보 확인"
                  description="시급·월급·계좌 등 급여 정보를 보려면 로그인 비밀번호를 다시 확인해주세요."
                  onVerified={() => setPayrollTabUnlocked(true)}
                />
              )}
              {editTab === 'payroll' && payrollTabUnlocked && (
                payrollLoading ? (
                  <p className="text-sm text-dark-400 text-center py-8">불러오는 중...</p>
                ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">생년월일 <span className="text-dark-300">(급여명세서 표기용)</span></label>
                    <input
                      type="date"
                      value={payrollForm.birthDate}
                      onChange={e => setPayrollForm(p => ({ ...p, birthDate: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">월급 <span className="text-danger-500">*</span></label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={payrollForm.baseSalary}
                      onChange={e => setPayrollForm(p => ({ ...p, baseSalary: e.target.value.replace(/[^0-9]/g, '') }))}
                      placeholder="예: 3000000"
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">연봉 <span className="text-danger-500">*</span></label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={payrollForm.annualSalary}
                      onChange={e => setPayrollForm(p => ({ ...p, annualSalary: e.target.value.replace(/[^0-9]/g, '') }))}
                      placeholder="예: 36000000"
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">임원구분</label>
                    <div className="grid grid-cols-2 gap-2">
                      {([{ v: false, label: '직원' }, { v: true, label: '임원' }]).map(opt => (
                        <button
                          key={String(opt.v)}
                          type="button"
                          onClick={() => setPayrollForm(p => ({ ...p, isExecutive: opt.v }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            payrollForm.isExecutive === opt.v
                              ? 'bg-primary-500 text-white border-primary-600'
                              : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">고정수당</label>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {([{ v: false, label: '아니오' }, { v: true, label: '예' }]).map(opt => (
                        <button
                          key={String(opt.v)}
                          type="button"
                          onClick={() => setPayrollForm(p => ({ ...p, fixedAllowanceEnabled: opt.v }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            payrollForm.fixedAllowanceEnabled === opt.v
                              ? 'bg-primary-500 text-white border-primary-600'
                              : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {payrollForm.fixedAllowanceEnabled && (
                      <input
                        type="text"
                        value={payrollForm.fixedAllowanceType}
                        onChange={e => setPayrollForm(p => ({ ...p, fixedAllowanceType: e.target.value }))}
                        placeholder="고정수당 종류 (예: 식대, 직책수당)"
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-dark-600 mb-1">소득공제부양자(명)</label>
                      <input
                        type="number"
                        min={0}
                        value={payrollForm.dependentsCount}
                        onChange={e => setPayrollForm(p => ({ ...p, dependentsCount: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-dark-600 mb-1">8~20세 이하 자녀수(명)</label>
                      <input
                        type="number"
                        min={0}
                        value={payrollForm.childrenUnder20Count}
                        onChange={e => setPayrollForm(p => ({ ...p, childrenUnder20Count: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">학자금 상환여부</label>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {([{ v: false, label: '아니오' }, { v: true, label: '예' }]).map(opt => (
                        <button
                          key={String(opt.v)}
                          type="button"
                          onClick={() => setPayrollForm(p => ({ ...p, studentLoanEnabled: opt.v }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            payrollForm.studentLoanEnabled === opt.v
                              ? 'bg-primary-500 text-white border-primary-600'
                              : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {payrollForm.studentLoanEnabled && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={payrollForm.studentLoanStart}
                            onChange={e => setPayrollForm(p => ({ ...p, studentLoanStart: e.target.value }))}
                            className="flex-1 px-2 py-1.5 text-xs border border-dark-200 rounded-lg"
                          />
                          <span className="text-xs text-dark-400">~</span>
                          <input
                            type="date"
                            value={payrollForm.studentLoanEnd}
                            onChange={e => setPayrollForm(p => ({ ...p, studentLoanEnd: e.target.value }))}
                            className="flex-1 px-2 py-1.5 text-xs border border-dark-200 rounded-lg"
                          />
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={payrollForm.studentLoanAmount}
                          onChange={e => setPayrollForm(p => ({ ...p, studentLoanAmount: e.target.value.replace(/[^0-9]/g, '') }))}
                          placeholder="학자금 상환금액"
                          className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">중소기업취업소득세감면</label>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {([{ v: false, label: '아니오' }, { v: true, label: '예' }]).map(opt => (
                        <button
                          key={String(opt.v)}
                          type="button"
                          onClick={() => setPayrollForm(p => ({ ...p, smeTaxReductionEnabled: opt.v }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            payrollForm.smeTaxReductionEnabled === opt.v
                              ? 'bg-primary-500 text-white border-primary-600'
                              : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {payrollForm.smeTaxReductionEnabled && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={payrollForm.smeTaxReductionStart}
                            onChange={e => setPayrollForm(p => ({ ...p, smeTaxReductionStart: e.target.value }))}
                            className="flex-1 px-2 py-1.5 text-xs border border-dark-200 rounded-lg"
                          />
                          <span className="text-xs text-dark-400">~</span>
                          <input
                            type="date"
                            value={payrollForm.smeTaxReductionEnd}
                            onChange={e => setPayrollForm(p => ({ ...p, smeTaxReductionEnd: e.target.value }))}
                            className="flex-1 px-2 py-1.5 text-xs border border-dark-200 rounded-lg"
                          />
                        </div>
                        <input
                          type="text"
                          value={payrollForm.smeReductionApplicable}
                          onChange={e => setPayrollForm(p => ({ ...p, smeReductionApplicable: e.target.value }))}
                          placeholder="중소기업감면적용 대상"
                          className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={payrollForm.smeIncomeReductionRate}
                            onChange={e => setPayrollForm(p => ({ ...p, smeIncomeReductionRate: e.target.value }))}
                            placeholder="중소기업소득감면율"
                            className="flex-1 px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                          />
                          <span className="text-xs text-dark-400">%</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">두루누리 적용여부</label>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {([{ v: false, label: '아니오' }, { v: true, label: '예' }]).map(opt => (
                        <button
                          key={String(opt.v)}
                          type="button"
                          onClick={() => setPayrollForm(p => ({ ...p, doorunuriApplicable: opt.v }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            payrollForm.doorunuriApplicable === opt.v
                              ? 'bg-primary-500 text-white border-primary-600'
                              : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {payrollForm.doorunuriApplicable && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={payrollForm.doorunuriPensionReductionRate}
                            onChange={e => setPayrollForm(p => ({ ...p, doorunuriPensionReductionRate: e.target.value }))}
                            placeholder="국민연금감면율"
                            className="flex-1 px-2 py-1.5 text-xs border border-dark-200 rounded-lg"
                          />
                          <span className="text-xs text-dark-400">%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={payrollForm.doorunuriEmploymentReductionRate}
                            onChange={e => setPayrollForm(p => ({ ...p, doorunuriEmploymentReductionRate: e.target.value }))}
                            placeholder="고용보험감면율"
                            className="flex-1 px-2 py-1.5 text-xs border border-dark-200 rounded-lg"
                          />
                          <span className="text-xs text-dark-400">%</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-dark-600 mb-1">급여은행 <span className="text-danger-500">*</span></label>
                      <select
                        value={payrollForm.salaryBank}
                        onChange={e => setPayrollForm(p => ({ ...p, salaryBank: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                      >
                        <option value="">선택하세요</option>
                        {BANK_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-dark-600 mb-1">급여계좌 <span className="text-danger-500">*</span></label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={payrollForm.salaryAccount}
                        onChange={e => setPayrollForm(p => ({ ...p, salaryAccount: e.target.value.replace(/[^0-9]/g, '') }))}
                        placeholder="계좌번호"
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-dark-600 mb-1">퇴직연금은행</label>
                      <select
                        value={payrollForm.pensionBank}
                        onChange={e => setPayrollForm(p => ({ ...p, pensionBank: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                      >
                        <option value="">선택하세요</option>
                        {BANK_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-dark-600 mb-1">퇴직연금계좌</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={payrollForm.pensionAccount}
                        onChange={e => setPayrollForm(p => ({ ...p, pensionAccount: e.target.value.replace(/[^0-9]/g, '') }))}
                        placeholder="계좌번호"
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                  </div>

                  {payrollSaveError && (
                    <p className="text-xs text-red-500 text-center -mb-1">{payrollSaveError}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={requestClose}
                      className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
                    >
                      취소
                    </button>
                    <button
                      onClick={savePayrollInfo}
                      disabled={payrollSaveLoading || !isPayrollDirty()}
                      className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
                    >
                      {payrollSaveLoading ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </>
                )
              )}

              {/* === 시트2: 계정관리 === */}
              {editTab === 'account' && (
                <>
                  <div className="bg-dark-50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-dark-700">계정 활성화</p>
                      <p className="text-xs text-dark-400 mt-0.5">직원의 로그인 가능 여부</p>
                    </div>
                    <button
                      onClick={() => setEditPanel(p => ({ ...p, form: { ...p.form, isActive: !p.form.isActive } }))}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        editPanel.form.isActive ? 'bg-success-500' : 'bg-dark-300'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        editPanel.form.isActive ? 'translate-x-5' : ''
                      }`} />
                    </button>
                  </div>
                  {isDirty() && (
                    <button
                      onClick={saveBasicInfo}
                      disabled={saveLoading}
                      className="w-full py-2 text-xs font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50"
                    >
                      {saveLoading ? '저장 중...' : '변경 저장'}
                    </button>
                  )}
                  <div className="bg-dark-50 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-medium text-dark-700">비밀번호 초기화</p>
                    <div>
                      <label className="block text-xs font-medium text-dark-600 mb-1">인사담당자 비밀번호</label>
                      <input
                        type="password"
                        value={editPanel.adminPassword}
                        onChange={e => setEditPanel(p => ({ ...p, adminPassword: e.target.value, accountError: '' }))}
                        placeholder="본인 비밀번호 입력"
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-dark-600 mb-1">{panelEmployee.name}의 새 임시 비밀번호</label>
                      <input
                        type="password"
                        value={editPanel.newPassword}
                        onChange={e => setEditPanel(p => ({ ...p, newPassword: e.target.value }))}
                        placeholder="6자 이상"
                        className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                    {editPanel.accountError && (
                      <p className="text-xs text-danger-500">{editPanel.accountError}</p>
                    )}
                    <button
                      onClick={handleResetPassword}
                      disabled={editPanel.accountLoading}
                      className="w-full py-2.5 text-sm font-semibold text-white bg-warning-500 rounded-xl hover:bg-warning-600 transition-colors disabled:opacity-50"
                    >
                      {editPanel.accountLoading ? '처리 중...' : '비밀번호 초기화'}
                    </button>
                  </div>
                </>
              )}

              {/* === 시트3: 퇴직관리 === */}
              {editTab === 'resign' && (
                <>
                  {panelEmployee.id !== currentUser?.id ? (
                    <div className="bg-warning-50 rounded-xl p-4">
                      {panelEmployee.is_active ? (
                        <>
                          <p className="text-sm font-medium text-warning-700 mb-1">퇴직 처리</p>
                          <div className="space-y-1 mb-3">
                            <p className="text-xs text-warning-600">· 퇴직 처리 후 해당 직원은 로그인이 비활성화됩니다</p>
                            <p className="text-xs text-warning-600">· 야근, 휴가, 급여 등 모든 이력은 보존됩니다</p>
                            <p className="text-xs text-warning-600">· 언제든지 복직 처리할 수 있습니다</p>
                          </div>
                          <button
                            onClick={() => { closePanel(); setResignConfirm({ id: panelEmployee.id, name: panelEmployee.name }) }}
                            className="w-full py-2.5 text-sm font-semibold text-white bg-warning-500 rounded-xl hover:bg-warning-600 transition-colors"
                          >
                            퇴직 처리
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-success-700 mb-1">복직 처리</p>
                          <p className="text-xs text-dark-400 mb-3">로그인이 다시 활성화됩니다</p>
                          <button
                            onClick={() => { closePanel(); setReinstateConfirm({ id: panelEmployee.id, name: panelEmployee.name }) }}
                            className="w-full py-2.5 text-sm font-semibold text-white bg-success-500 rounded-xl hover:bg-success-600 transition-colors"
                          >
                            복직 처리
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-dark-400 text-center py-8">본인 계정은 퇴직 처리할 수 없습니다</p>
                  )}
                  <div className="bg-danger-50 rounded-xl p-4">
                    <p className="text-sm font-medium text-danger-700 mb-2">계정 삭제</p>
                    <p className="text-xs text-dark-400 mb-3">직원 계정과 모든 관련 데이터를 영구 삭제합니다</p>
                    <button
                      onClick={() => setDeleteConfirm({ id: panelEmployee.id, name: panelEmployee.name })}
                      disabled={panelEmployee.id === currentUser?.id}
                      className="w-full py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      계정 삭제
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Excel-style sheet tabs at bottom of modal */}
            <div className="flex items-stretch border-t border-dark-100 bg-dark-50 rounded-b-2xl overflow-hidden">
              {([
                { key: 'basic' as const, label: '기본정보' },
                { key: 'payroll' as const, label: '급여정보' },
                { key: 'account' as const, label: '계정관리' },
                { key: 'resign' as const, label: '퇴직관리' },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setEditTab(tab.key)}
                  className={`px-4 py-2.5 text-xs font-semibold border-r border-dark-200 transition-colors ${
                    editTab === tab.key
                      ? 'bg-white text-dark-900'
                      : 'text-dark-400 hover:bg-dark-100 hover:text-dark-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              <div className="flex-1" />
            </div>
          </div>
        </div>
      )}

      {/* ==================== Unsaved changes guard ==================== */}
      {unsavedGuard.open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <h3 className="text-base font-bold text-dark-900 mb-2">변경사항이 있습니다</h3>
            <p className="text-sm text-dark-600 mb-5">현재 변경한 내용을 저장하시겠습니까?</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={guardSave}
                disabled={saveLoading}
                className="w-full py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
              >
                {saveLoading ? '저장 중...' : '저장'}
              </button>
              <button
                onClick={guardDiscard}
                className="w-full py-2.5 text-sm font-medium text-dark-700 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                저장안함
              </button>
              <button
                onClick={guardCancel}
                className="w-full py-2.5 text-sm font-medium text-dark-500 hover:text-dark-700"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== Create user modal ==================== */}
      {createModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setCreateModal(p => ({ ...p, open: false })); setCreateError(''); setBulkResults([]) }} />
          <div className={`relative bg-white rounded-2xl w-full ${createMode === 'bulk' ? 'max-w-2xl' : 'max-w-sm'} p-5 shadow-xl max-h-[90vh] overflow-y-auto`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">신규 직원 등록</h3>
              <button onClick={() => { setCreateModal(p => ({ ...p, open: false })); setCreateError(''); setBulkResults([]) }}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>

            {/* 모드 탭 */}
            <div className="flex bg-dark-100 rounded-xl p-0.5 mb-4">
              {(['single', 'bulk'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setCreateMode(m); setCreateError(''); setBulkResults([]) }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
                    createMode === m ? 'bg-white text-primary-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500'
                  }`}
                >
                  {m === 'single' ? '개별 등록' : '일괄 등록'}
                </button>
              ))}
            </div>

            {createMode === 'single' ? (
              <>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">사번</label>
                    <input
                      type="text"
                      value={createModal.employeeNumber}
                      onChange={e => setCreateModal(p => ({ ...p, employeeNumber: e.target.value }))}
                      placeholder="예: EMP001"
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">이름</label>
                    <input
                      type="text"
                      value={createModal.name}
                      onChange={e => setCreateModal(p => ({ ...p, name: e.target.value }))}
                      placeholder="이름 입력"
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-dark-600">부서</label>
                      <button onClick={() => setDeptModal(true)} className="text-xs text-primary-500 hover:text-primary-700">부서 관리</button>
                    </div>
                    <select
                      value={createModal.department}
                      onChange={e => setCreateModal(p => ({ ...p, department: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                    >
                      <option value="">선택하세요</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">포지션</label>
                    <div className={`grid gap-2 ${isAdmin ? 'grid-cols-3' : 'grid-cols-1'}`}>
                      {(isAdmin ? (['employee', 'manager', 'admin'] as UserRole[]) : (['employee'] as UserRole[])).map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setCreateModal(p => ({ ...p, role: r }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            createModal.role === r
                              ? 'bg-primary-500 text-white border-primary-600'
                              : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                          }`}
                        >
                          {ROLE_LABEL[r]}
                        </button>
                      ))}
                    </div>
                    {!isAdmin && (
                      <p className="text-xs text-dark-400 mt-1">인사담당자는 일반 직원만 등록할 수 있습니다</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">비밀번호</label>
                    <input
                      type="password"
                      value={createModal.password}
                      onChange={e => setCreateModal(p => ({ ...p, password: e.target.value }))}
                      placeholder="6자 이상"
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1">비밀번호 확인</label>
                    <input
                      type="password"
                      value={createModal.passwordConfirm}
                      onChange={e => setCreateModal(p => ({ ...p, passwordConfirm: e.target.value }))}
                      placeholder="비밀번호 재입력"
                      className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>
                  {createError && <p className="text-xs text-danger-500">{createError}</p>}
                </div>
                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => { setCreateModal(p => ({ ...p, open: false })); setCreateError('') }}
                    className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleCreateUser}
                    disabled={createLoading}
                    className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
                  >
                    {createLoading ? '처리중...' : '등록'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-dark-500 mb-3">사번, 이름, 부서, 비밀번호를 입력하세요. 포지션은 모두 "직원"으로 등록됩니다.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-dark-50">
                        <th className="border border-dark-200 px-2 py-2 text-center w-8">#</th>
                        <th className="border border-dark-200 px-2 py-2 text-left">사번</th>
                        <th className="border border-dark-200 px-2 py-2 text-left">이름</th>
                        <th className="border border-dark-200 px-2 py-2 text-left">부서</th>
                        <th className="border border-dark-200 px-2 py-2 text-left">비밀번호</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, i) => (
                        <tr key={i}>
                          <td className="border border-dark-200 px-2 py-1 text-center text-dark-400">{i + 1}</td>
                          <td className="border border-dark-200 px-1 py-1">
                            <input
                              value={row.employeeNumber}
                              onChange={e => setBulkRows(prev => prev.map((r, idx) => idx === i ? { ...r, employeeNumber: e.target.value } : r))}
                              placeholder="EMP001"
                              className="w-full px-1.5 py-1 text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary-400 rounded"
                            />
                          </td>
                          <td className="border border-dark-200 px-1 py-1">
                            <input
                              value={row.name}
                              onChange={e => setBulkRows(prev => prev.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))}
                              placeholder="이름"
                              className="w-full px-1.5 py-1 text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary-400 rounded"
                            />
                          </td>
                          <td className="border border-dark-200 px-1 py-1">
                            <select
                              value={row.department}
                              onChange={e => setBulkRows(prev => prev.map((r, idx) => idx === i ? { ...r, department: e.target.value } : r))}
                              className="w-full px-1 py-1 text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary-400 rounded bg-transparent"
                            >
                              <option value="">-</option>
                              {departments.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </td>
                          <td className="border border-dark-200 px-1 py-1">
                            <input
                              value={row.password}
                              onChange={e => setBulkRows(prev => prev.map((r, idx) => idx === i ? { ...r, password: e.target.value } : r))}
                              placeholder="6자 이상"
                              className="w-full px-1.5 py-1 text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary-400 rounded"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={() => setBulkRows(prev => [...prev, { employeeNumber: '', name: '', department: '', password: '' }])}
                  className="mt-2 text-xs text-primary-500 hover:text-primary-700 font-medium"
                >
                  + 행 추가
                </button>

                {bulkResults.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {bulkResults.map((r, i) => (
                      <p key={i} className={`text-xs ${r.success ? 'text-success-600' : 'text-danger-500'}`}>
                        {r.row}. {r.name}: {r.success ? '등록 완료' : r.error}
                      </p>
                    ))}
                  </div>
                )}

                {createError && <p className="text-xs text-danger-500 mt-2">{createError}</p>}

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => { setCreateModal(p => ({ ...p, open: false })); setCreateError(''); setBulkResults([]) }}
                    className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleBulkCreate}
                    disabled={createLoading}
                    className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
                  >
                    {createLoading ? '처리중...' : `일괄 등록 (${bulkRows.filter(r => r.employeeNumber.trim() && r.name.trim()).length}명)`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ==================== Resign confirm ==================== */}
      {resignConfirm && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setResignConfirm(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-dark-900">퇴직 처리</h3>
              <button onClick={() => setResignConfirm(null)}><X className="w-5 h-5 text-dark-400" /></button>
            </div>
            <p className="text-sm text-dark-600 mb-3">
              <span className="font-semibold">{resignConfirm.name}</span>님을 퇴직 처리하시겠습니까?
            </p>
            <div className="bg-primary-50 rounded-xl px-3 py-2.5 mb-4 space-y-1">
              <p className="text-xs text-primary-700">· 퇴직 처리 후 해당 직원은 로그인이 비활성화됩니다</p>
              <p className="text-xs text-primary-700">· 야근, 휴가, 급여 등 모든 이력은 보존됩니다</p>
              <p className="text-xs text-primary-700">· 언제든지 복직 처리할 수 있습니다</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setResignConfirm(null)}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={() => handleResign(resignConfirm.id)}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-warning-500 rounded-xl hover:bg-warning-600 transition-colors"
              >
                퇴직 처리
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== Reinstate confirm ==================== */}
      {reinstateConfirm && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setReinstateConfirm(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-dark-900">복직 처리</h3>
              <button onClick={() => setReinstateConfirm(null)}><X className="w-5 h-5 text-dark-400" /></button>
            </div>
            <p className="text-sm text-dark-600 mb-4">
              <span className="font-semibold">{reinstateConfirm.name}</span>님을 복직 처리하시겠습니까?
              <br /><span className="text-xs text-dark-400">로그인이 다시 활성화됩니다.</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setReinstateConfirm(null)}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={() => handleReinstate(reinstateConfirm.id)}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-success-500 rounded-xl hover:bg-success-600 transition-colors"
              >
                복직 처리
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== Delete account confirm ==================== */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">계정 삭제</h3>
              <button onClick={() => setDeleteConfirm(null)}><X className="w-5 h-5 text-dark-400" /></button>
            </div>
            <p className="text-sm text-dark-600 mb-2">
              <span className="font-semibold">{deleteConfirm.name}</span> 계정을 삭제하시겠습니까?
            </p>
            <p className="text-xs text-danger-600 bg-danger-50 rounded-lg px-3 py-2 mb-4">
              삭제된 사용자의 관련 데이터(야근, 휴가, 경비 등)도 함께 삭제됩니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmDeleteAccount}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 부서 관리 모달 */}
      {deptModal && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setDeptModal(false); setEditingDept(null); setNewDeptName('') }} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
              <h3 className="text-base font-bold text-dark-900">부서 관리</h3>
              <button onClick={() => { setDeptModal(false); setEditingDept(null); setNewDeptName('') }}><X className="w-5 h-5 text-dark-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* 부서 목록 */}
              <div className="space-y-1.5">
                {departments.map((dept, i) => (
                  <div key={i} className="flex items-center justify-between bg-dark-50 rounded-lg px-3 py-2">
                    {editingDept?.index === i ? (
                      <input
                        autoFocus
                        value={editingDept.name}
                        onChange={e => setEditingDept({ index: i, name: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && editingDept.name.trim()) {
                            const updated = [...departments]
                            updated[i] = editingDept.name.trim()
                            updateDepartments(updated)
                            setEditingDept(null)
                          }
                          if (e.key === 'Escape') setEditingDept(null)
                        }}
                        className="flex-1 text-sm bg-white border border-primary-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    ) : (
                      <span className="text-sm text-dark-700">{dept}</span>
                    )}
                    <div className="flex items-center gap-2 ml-2">
                      {editingDept?.index === i ? (
                        <button
                          onClick={() => {
                            if (editingDept.name.trim()) {
                              const updated = [...departments]
                              updated[i] = editingDept.name.trim()
                              updateDepartments(updated)
                            }
                            setEditingDept(null)
                          }}
                          className="text-xs text-primary-600 font-medium"
                        >
                          확인
                        </button>
                      ) : (
                        <>
                          <button onClick={() => setEditingDept({ index: i, name: dept })} className="text-dark-400 hover:text-primary-500">
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => updateDepartments(departments.filter((_, idx) => idx !== i))}
                            className="text-dark-400 hover:text-danger-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {departments.length === 0 && (
                  <p className="text-xs text-dark-400 text-center py-2">등록된 부서가 없습니다</p>
                )}
              </div>

              {/* 부서 추가 */}
              <div className="flex gap-2">
                <input
                  value={newDeptName}
                  onChange={e => setNewDeptName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newDeptName.trim()) {
                      updateDepartments([...departments, newDeptName.trim()])
                      setNewDeptName('')
                    }
                  }}
                  placeholder="새 부서명 입력"
                  className="flex-1 px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                <button
                  onClick={() => {
                    if (newDeptName.trim()) {
                      updateDepartments([...departments, newDeptName.trim()])
                      setNewDeptName('')
                    }
                  }}
                  className="px-3 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
                >
                  추가
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

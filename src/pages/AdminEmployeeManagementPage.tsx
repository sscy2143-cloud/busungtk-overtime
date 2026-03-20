import { useState, useEffect, useMemo, useCallback } from 'react'
import { Users, UserCheck, UserX, X, Plus, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { Employee, UserRole, EmployeeType } from '../types'

const ROLE_LABEL: Record<UserRole, string> = {
  employee: '직원',
  manager: '인사담당',
  admin: '대표',
}

const ROLE_COLOR: Record<UserRole, string> = {
  employee: 'bg-blue-50 text-blue-700',
  manager: 'bg-green-50 text-green-700',
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

type EditTab = 'basic' | 'account' | 'resign'

interface FormState {
  name: string
  department: string
  role: UserRole
  employeeType: EmployeeType
  hourlyWage: string
  isActive: boolean
}

interface EditPanel {
  open: boolean
  employee: Employee | null
  form: FormState
  originalForm: FormState
  activeTab: EditTab
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

function makeEmptyForm(emp: Employee): FormState {
  return {
    name: emp.name,
    department: emp.department,
    role: emp.role,
    employeeType: emp.employee_type,
    hourlyWage: emp.hourly_wage > 0 ? String(emp.hourly_wage) : '',
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
    a.isActive === b.isActive
  )
}

export function AdminEmployeeManagementPage() {
  const { employee: currentUser, session } = useAuth()
  const isAdmin = currentUser?.role === 'admin'

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
    form: { name: '', department: '', role: 'employee', employeeType: 'office', hourlyWage: '', isActive: true },
    originalForm: { name: '', department: '', role: 'employee', employeeType: 'office', hourlyWage: '', isActive: true },
    activeTab: 'basic',
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

  const [resignConfirm, setResignConfirm] = useState<{ id: string; name: string } | null>(null)
  const [reinstateConfirm, setReinstateConfirm] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)

  const [saveLoading, setSaveLoading] = useState(false)

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
      activeTab: 'basic',
      adminPassword: '',
      newPassword: '',
      accountError: '',
      accountLoading: false,
    })
  }

  function closePanel() {
    setEditPanel(p => ({ ...p, open: false }))
  }

  function isDirty(): boolean {
    return !formsEqual(editPanel.form, editPanel.originalForm)
  }

  function requestTabSwitch(tab: EditTab) {
    if (isDirty()) {
      setUnsavedGuard({
        open: true,
        nextAction: () => {
          setEditPanel(p => ({
            ...p,
            form: p.originalForm,
            activeTab: tab,
            accountError: '',
          }))
        },
      })
    } else {
      setEditPanel(p => ({ ...p, activeTab: tab, accountError: '' }))
    }
  }

  function requestClose() {
    if (isDirty()) {
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
    const empId = editPanel.employee.id
    const { name, department, role, employeeType, hourlyWage, isActive } = editPanel.form
    const wage = parseInt(hourlyWage.replace(/,/g, ''), 10)

    // Update name, department, role, isActive via RPC
    await supabase.rpc('update_employee_admin', {
      p_id: empId,
      p_name: name,
      p_role: role,
      p_department: department,
      p_is_active: isActive,
    })

    // Update hourly_wage, employee_type via direct update
    await supabase.from('employees').update({
      employee_type: employeeType,
      hourly_wage: isNaN(wage) ? 0 : wage,
    }).eq('id', empId)

    setEmployees(prev => prev.map(e => e.id === empId ? {
      ...e,
      name,
      department,
      role,
      employee_type: employeeType,
      hourly_wage: isNaN(wage) ? 0 : wage,
      is_active: isActive,
    } : e))

    setEditPanel(p => ({ ...p, originalForm: p.form }))
    setSaveLoading(false)
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

    const email = currentUser?.email ?? ''
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: adminPassword })
    if (verifyErr) {
      setEditPanel(p => ({ ...p, accountError: '본인 비밀번호가 올바르지 않습니다', accountLoading: false }))
      return
    }

    try {
      const res = await fetch('/api/admin-user', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userId: emp.id, newPassword }),
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

  // --- Unsaved guard actions ---

  async function guardSave() {
    await saveBasicInfo()
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
      <p className="text-sm text-gray-400">불러오는 중...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">직원 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">재직자 및 퇴직자 정보를 관리합니다</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setCreateModal({ open: true, employeeNumber: '', name: '', department: '', role: 'employee', password: '', passwordConfirm: '' })}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            직원 추가
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <Users className="w-5 h-5 text-gray-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-900">{employees.length}</p>
          <p className="text-xs text-gray-500">전체</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <UserCheck className="w-5 h-5 text-success-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-success-600">{activeEmps.length}</p>
          <p className="text-xs text-gray-500">재직</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <UserX className="w-5 h-5 text-gray-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-500">{resignedEmps.length}</p>
          <p className="text-xs text-gray-500">퇴직</p>
        </div>
      </div>

      {/* Tab filter */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 w-fit">
        <button
          onClick={() => setListTab('active')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            listTab === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          재직자 {activeEmps.length}
        </button>
        <button
          onClick={() => setListTab('resigned')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            listTab === 'resigned' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          퇴직자 {resignedEmps.length}
        </button>
      </div>

      {/* Employee list */}
      {displayEmps.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <p className="text-sm text-gray-400">{listTab === 'active' ? '재직 중인 직원이 없습니다' : '퇴직자가 없습니다'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">이름</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">사번</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">부서</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500">고용형태</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500">포지션</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500">상태</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayEmps.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${emp.is_active ? 'bg-primary-100' : 'bg-gray-100'}`}>
                          <span className={`text-xs font-bold ${emp.is_active ? 'text-primary-700' : 'text-gray-400'}`}>
                            {emp.name.charAt(0)}
                          </span>
                        </div>
                        <span className={`font-medium ${emp.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                          {emp.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs font-mono text-gray-500">{getEmployeeNumber(emp.email)}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{emp.department || '-'}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        emp.employee_type === 'field'
                          ? 'bg-orange-50 text-orange-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}>
                        {EMP_TYPE_LABEL[emp.employee_type]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[emp.role]}`}>
                        {ROLE_LABEL[emp.role]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        emp.is_active
                          ? 'bg-success-50 text-success-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {emp.is_active ? '재직중' : '퇴직'}
                      </span>
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
        </div>
      )}

      {/* ==================== Edit panel (full-screen modal) ==================== */}
      {editPanel.open && panelEmployee && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={requestClose} />
          <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl shadow-xl flex flex-col"
            style={{ height: '90vh', maxHeight: '680px' }}>

            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-base font-bold text-gray-900">{panelEmployee.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{getEmployeeNumber(panelEmployee.email)}</p>
              </div>
              <button onClick={requestClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Scrollable tab content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Tab 1: 기본정보 */}
              {editPanel.activeTab === 'basic' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">이름</label>
                    <input
                      type="text"
                      value={editPanel.form.name}
                      onChange={e => setEditPanel(p => ({ ...p, form: { ...p.form, name: e.target.value } }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">부서</label>
                      <button onClick={() => setDeptModal(true)} className="text-xs text-primary-500 hover:text-primary-700">부서 관리</button>
                    </div>
                    <select
                      value={editPanel.form.department}
                      onChange={e => setEditPanel(p => ({ ...p, form: { ...p.form, department: e.target.value } }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                    >
                      <option value="">선택하세요</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                      {editPanel.form.department && !departments.includes(editPanel.form.department) && (
                        <option value={editPanel.form.department}>{editPanel.form.department}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">고용형태</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['office', 'field'] as EmployeeType[]).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setEditPanel(p => ({ ...p, form: { ...p.form, employeeType: t } }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            editPanel.form.employeeType === t
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                          }`}
                        >
                          {EMP_TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">권한</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['employee', 'manager', 'admin'] as UserRole[]).map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setEditPanel(p => ({ ...p, form: { ...p.form, role: r } }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                            editPanel.form.role === r
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                          }`}
                        >
                          {ROLE_LABEL[r]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">시급 (원)</label>
                    <input
                      type="number"
                      value={editPanel.form.hourlyWage}
                      onChange={e => setEditPanel(p => ({ ...p, form: { ...p.form, hourlyWage: e.target.value } }))}
                      placeholder="예: 10000"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">연장근무수당 자동 계산에 사용됩니다</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">등록일</label>
                    <p className="text-sm text-gray-500 px-3 py-2 bg-gray-50 rounded-xl">
                      {new Date(panelEmployee.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">사번</label>
                    <p className="text-sm font-mono text-gray-500 px-3 py-2 bg-gray-50 rounded-xl">
                      {getEmployeeNumber(panelEmployee.email)}
                    </p>
                  </div>

                  <button
                    onClick={saveBasicInfo}
                    disabled={saveLoading || !isDirty()}
                    className="w-full py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50"
                  >
                    {saveLoading ? '저장 중...' : '저장'}
                  </button>
                </div>
              )}

              {/* Tab 2: 계정관리 (admin only) */}
              {editPanel.activeTab === 'account' && isAdmin && (
                <div className="space-y-5">
                  {/* Active toggle */}
                  <div>
                    <p className="text-sm font-semibold text-gray-800">&#8226; 계정 활성화</p>
                    <p className="text-xs text-gray-400 ml-3 mt-0.5">직원의 로그인 가능 여부를 설정합니다</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div></div>
                      <button
                        onClick={() => setEditPanel(p => ({ ...p, form: { ...p.form, isActive: !p.form.isActive } }))}
                        className={`relative w-11 h-6 rounded-full transition-colors ${
                          editPanel.form.isActive ? 'bg-success-500' : 'bg-gray-300'
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
                        className="mt-3 w-full py-2 text-xs font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                      >
                        {saveLoading ? '저장 중...' : '변경 저장'}
                      </button>
                    )}
                  </div>

                  {/* Password reset */}
                  <div>
                    <p className="text-sm font-semibold text-gray-800">&#8226; 비밀번호 초기화</p>
                    <p className="text-xs text-gray-400 ml-3 mt-0.5">직원의 비밀번호를 임시 비밀번호로 재설정합니다</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">인사담당자 비밀번호 입력</label>
                      <input
                        type="password"
                        value={editPanel.adminPassword}
                        onChange={e => setEditPanel(p => ({ ...p, adminPassword: e.target.value, accountError: '' }))}
                        placeholder="본인 비밀번호 입력"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {panelEmployee.name}의 새 임시 비밀번호
                      </label>
                      <input
                        type="password"
                        value={editPanel.newPassword}
                        onChange={e => setEditPanel(p => ({ ...p, newPassword: e.target.value }))}
                        placeholder="6자 이상"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
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

                  {/* Delete account */}
                  <div>
                    <p className="text-sm font-semibold text-danger-700">&#8226; 계정 삭제</p>
                    <p className="text-xs text-gray-400 ml-3 mt-0.5">직원 계정과 모든 관련 데이터를 영구 삭제합니다</p>
                  </div>
                  <div className="bg-danger-50 rounded-xl p-4">
                    <button
                      onClick={() => setDeleteConfirm({ id: panelEmployee.id, name: panelEmployee.name })}
                      disabled={panelEmployee.id === currentUser?.id}
                      className="w-full py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      계정 삭제
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 3: 퇴사관리 (admin only) */}
              {editPanel.activeTab === 'resign' && isAdmin && (
                <div className="space-y-4">
                  {/* Current status */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-500 mb-2">현재 상태</p>
                    <span className={`text-sm font-semibold px-3 py-1.5 rounded-full ${
                      panelEmployee.is_active
                        ? 'bg-success-50 text-success-700'
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {panelEmployee.is_active ? '재직중' : '퇴직'}
                    </span>
                  </div>

                  {panelEmployee.is_active ? (
                    <div className="bg-warning-50 rounded-xl p-4">
                      <p className="text-sm font-medium text-warning-700 mb-1">퇴직 처리</p>
                      <div className="space-y-1 mb-4">
                        <p className="text-xs text-warning-600">· 퇴직 처리 후 해당 직원은 로그인이 비활성화됩니다</p>
                        <p className="text-xs text-warning-600">· 야근, 휴가, 급여 등 모든 이력은 보존됩니다</p>
                        <p className="text-xs text-warning-600">· 언제든지 복직 처리할 수 있습니다</p>
                      </div>
                      <button
                        onClick={() => setResignConfirm({ id: panelEmployee.id, name: panelEmployee.name })}
                        disabled={panelEmployee.id === currentUser?.id}
                        className="w-full py-2.5 text-sm font-semibold text-white bg-warning-500 rounded-xl hover:bg-warning-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        퇴직 처리
                      </button>
                    </div>
                  ) : (
                    <div className="bg-success-50 rounded-xl p-4">
                      <p className="text-sm font-medium text-success-700 mb-1">복직 처리</p>
                      <p className="text-xs text-success-600 mb-4">복직 처리 시 로그인이 다시 활성화됩니다.</p>
                      <button
                        onClick={() => setReinstateConfirm({ id: panelEmployee.id, name: panelEmployee.name })}
                        className="w-full py-2.5 text-sm font-semibold text-white bg-success-500 rounded-xl hover:bg-success-600 transition-colors"
                      >
                        복직 처리
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Non-admin fallback for restricted tabs */}
              {editPanel.activeTab !== 'basic' && !isAdmin && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-sm text-gray-400">관리자 권한이 필요합니다</p>
                </div>
              )}
            </div>

            {/* Fixed bottom tab bar */}
            <div className="shrink-0 border-t border-gray-100 bg-white flex">
              <button
                onClick={() => requestTabSwitch('basic')}
                className={`flex-1 py-3.5 text-xs font-semibold transition-colors ${
                  editPanel.activeTab === 'basic'
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                기본정보
              </button>
              {isAdmin && (
                <>
                  <button
                    onClick={() => requestTabSwitch('account')}
                    className={`flex-1 py-3.5 text-xs font-semibold transition-colors ${
                      editPanel.activeTab === 'account'
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    계정관리
                  </button>
                  <button
                    onClick={() => requestTabSwitch('resign')}
                    className={`flex-1 py-3.5 text-xs font-semibold transition-colors ${
                      editPanel.activeTab === 'resign'
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    퇴사관리
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== Unsaved changes guard ==================== */}
      {unsavedGuard.open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <h3 className="text-base font-bold text-gray-900 mb-2">변경사항이 있습니다</h3>
            <p className="text-sm text-gray-600 mb-5">현재 변경한 내용을 저장하시겠습니까?</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={guardSave}
                disabled={saveLoading}
                className="w-full py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {saveLoading ? '저장 중...' : '저장'}
              </button>
              <button
                onClick={guardDiscard}
                className="w-full py-2.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                저장안함
              </button>
              <button
                onClick={guardCancel}
                className="w-full py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700"
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
          <div className="absolute inset-0 bg-black/40" onClick={() => { setCreateModal(p => ({ ...p, open: false })); setCreateError('') }} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">신규 직원 등록</h3>
              <button onClick={() => { setCreateModal(p => ({ ...p, open: false })); setCreateError('') }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">사번</label>
                <input
                  type="text"
                  value={createModal.employeeNumber}
                  onChange={e => setCreateModal(p => ({ ...p, employeeNumber: e.target.value }))}
                  placeholder="예: EMP001"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">이름</label>
                <input
                  type="text"
                  value={createModal.name}
                  onChange={e => setCreateModal(p => ({ ...p, name: e.target.value }))}
                  placeholder="이름 입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">부서</label>
                  <button onClick={() => setDeptModal(true)} className="text-xs text-primary-500 hover:text-primary-700">부서 관리</button>
                </div>
                <select
                  value={createModal.department}
                  onChange={e => setCreateModal(p => ({ ...p, department: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                >
                  <option value="">선택하세요</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">포지션</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['employee', 'manager', 'admin'] as UserRole[]).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setCreateModal(p => ({ ...p, role: r }))}
                      className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                        createModal.role === r
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                      }`}
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">비밀번호</label>
                <input
                  type="password"
                  value={createModal.password}
                  onChange={e => setCreateModal(p => ({ ...p, password: e.target.value }))}
                  placeholder="6자 이상"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">비밀번호 확인</label>
                <input
                  type="password"
                  value={createModal.passwordConfirm}
                  onChange={e => setCreateModal(p => ({ ...p, passwordConfirm: e.target.value }))}
                  placeholder="비밀번호 재입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              {createError && <p className="text-xs text-danger-500">{createError}</p>}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setCreateModal(p => ({ ...p, open: false })); setCreateError('') }}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleCreateUser}
                disabled={createLoading}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {createLoading ? '처리중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== Resign confirm ==================== */}
      {resignConfirm && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setResignConfirm(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-gray-900">퇴직 처리</h3>
              <button onClick={() => setResignConfirm(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              <span className="font-semibold">{resignConfirm.name}</span>님을 퇴직 처리하시겠습니까?
            </p>
            <div className="bg-blue-50 rounded-xl px-3 py-2.5 mb-4 space-y-1">
              <p className="text-xs text-blue-700">· 퇴직 처리 후 해당 직원은 로그인이 비활성화됩니다</p>
              <p className="text-xs text-blue-700">· 야근, 휴가, 급여 등 모든 이력은 보존됩니다</p>
              <p className="text-xs text-blue-700">· 언제든지 복직 처리할 수 있습니다</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setResignConfirm(null)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
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
              <h3 className="text-base font-bold text-gray-900">복직 처리</h3>
              <button onClick={() => setReinstateConfirm(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-semibold">{reinstateConfirm.name}</span>님을 복직 처리하시겠습니까?
              <br /><span className="text-xs text-gray-400">로그인이 다시 활성화됩니다.</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setReinstateConfirm(null)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
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
              <h3 className="text-base font-bold text-gray-900">계정 삭제</h3>
              <button onClick={() => setDeleteConfirm(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              <span className="font-semibold">{deleteConfirm.name}</span> 계정을 삭제하시겠습니까?
            </p>
            <p className="text-xs text-danger-600 bg-danger-50 rounded-lg px-3 py-2 mb-4">
              삭제된 사용자의 관련 데이터(야근, 휴가, 경비 등)도 함께 삭제됩니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
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
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">부서 관리</h3>
              <button onClick={() => { setDeptModal(false); setEditingDept(null); setNewDeptName('') }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* 부서 목록 */}
              <div className="space-y-1.5">
                {departments.map((dept, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
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
                      <span className="text-sm text-gray-700">{dept}</span>
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
                          <button onClick={() => setEditingDept({ index: i, name: dept })} className="text-gray-400 hover:text-primary-500">
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => updateDepartments(departments.filter((_, idx) => idx !== i))}
                            className="text-gray-400 hover:text-danger-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {departments.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">등록된 부서가 없습니다</p>
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
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                <button
                  onClick={() => {
                    if (newDeptName.trim()) {
                      updateDepartments([...departments, newDeptName.trim()])
                      setNewDeptName('')
                    }
                  }}
                  className="px-3 py-2 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
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

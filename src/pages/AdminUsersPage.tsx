import { useState, useEffect } from 'react'
import { Users, UserCheck, UserX, Shield, X, Plus, KeyRound } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { Employee, UserRole } from '../types'

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

interface EditModal {
  open: boolean
  employee: Employee | null
  name: string
  role: UserRole
  department: string
  isActive: boolean
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

interface ResetPasswordModal {
  open: boolean
  userId: string
  name: string
  newPassword: string
  adminPassword: string
}

export function AdminUsersPage() {
  const { employee: currentUser, session } = useAuth()
  const [employees, setEmployees] = useState<Employee[]>([])

  useEffect(() => {
    supabase.rpc('list_all_employees').then(({ data }) => {
      if (data) setEmployees(data as Employee[])
    })
  }, [])

  const [editModal, setEditModal] = useState<EditModal>({
    open: false, employee: null, name: '', role: 'employee', department: '', isActive: true,
  })
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' })
  const [createModal, setCreateModal] = useState<CreateModal>({
    open: false, employeeNumber: '', name: '', department: '', role: 'employee', password: '', passwordConfirm: '',
  })
  const [resetModal, setResetModal] = useState<ResetPasswordModal>({
    open: false, userId: '', name: '', newPassword: '', adminPassword: '',
  })
  const [actionError, setActionError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  function openEdit(emp: Employee) {
    setEditModal({
      open: true,
      employee: emp,
      name: emp.name,
      role: emp.role,
      department: emp.department,
      isActive: emp.is_active,
    })
  }

  async function saveEdit() {
    if (!editModal.employee) return
    const id = editModal.employee.id
    await supabase.rpc('update_employee_admin', {
      p_id: id,
      p_name: editModal.name, p_role: editModal.role, p_department: editModal.department, p_is_active: editModal.isActive,
    })
    setEmployees((prev) =>
      prev.map((e) => e.id === id ? { ...e, name: editModal.name, role: editModal.role, department: editModal.department, is_active: editModal.isActive } : e),
    )
    setEditModal({ open: false, employee: null, name: '', role: 'employee', department: '', isActive: true })
  }

  async function toggleActive(id: string) {
    const emp = employees.find((e) => e.id === id)
    if (!emp) return
    const newActive = !emp.is_active
    await supabase.rpc('update_employee_admin', {
      p_id: id, p_is_active: newActive,
    })
    setEmployees((prev) =>
      prev.map((e) => e.id === id ? { ...e, is_active: newActive } : e),
    )
  }

  async function confirmDelete() {
    const { id } = deleteModal
    await supabase.rpc('update_employee_admin', {
      p_id: id, p_is_active: false,
    })
    setEmployees((prev) => prev.filter((e) => e.id !== id))
    setDeleteModal({ open: false, id: '', name: '' })
  }

  // 직원 추가
  async function handleCreateUser() {
    setActionError('')
    const { employeeNumber, name, password, passwordConfirm, department, role } = createModal

    if (!employeeNumber.trim() || !name.trim() || !password) {
      setActionError('사번, 이름, 비밀번호는 필수입니다')
      return
    }
    if (password.length < 6) {
      setActionError('비밀번호는 6자 이상이어야 합니다')
      return
    }
    if (password !== passwordConfirm) {
      setActionError('비밀번호가 일치하지 않습니다')
      return
    }

    setActionLoading(true)
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
        setActionError(data.error || '직원 추가에 실패했습니다')
        setActionLoading(false)
        return
      }

      // 목록 새로고침
      const { data: refreshed } = await supabase.rpc('list_all_employees')
      if (refreshed) setEmployees(refreshed as Employee[])

      setCreateModal({ open: false, employeeNumber: '', name: '', department: '', role: 'employee', password: '', passwordConfirm: '' })
    } catch {
      setActionError('서버와 통신할 수 없습니다')
    }
    setActionLoading(false)
  }

  // 비밀번호 초기화
  async function handleResetPassword() {
    setActionError('')
    const { userId, newPassword, adminPassword } = resetModal

    if (!adminPassword) {
      setActionError('본인 비밀번호를 입력하세요')
      return
    }
    if (!newPassword) {
      setActionError('새 비밀번호를 입력하세요')
      return
    }
    if (newPassword.length < 6) {
      setActionError('비밀번호는 6자 이상이어야 합니다')
      return
    }

    setActionLoading(true)

    try {
      // adminPassword를 서버로 전달해 서버에서 검증 (클라이언트 signInWithPassword 호출 시 세션 변경으로 모달이 닫히는 버그 방지)
      const res = await fetch('/api/admin-user', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userId, newPassword, adminPassword }),
      })

      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error || '비밀번호 초기화에 실패했습니다')
        setActionLoading(false)
        return
      }

      setResetModal({ open: false, userId: '', name: '', newPassword: '', adminPassword: '' })
      alert('비밀번호가 초기화되었습니다')
    } catch {
      setActionError('서버와 통신할 수 없습니다')
    }
    setActionLoading(false)
  }

  // 사번 추출 (이메일에서)
  function getEmployeeNumber(email: string): string {
    if (email.endsWith('@busungtk.internal')) {
      return email.replace('@busungtk.internal', '').toUpperCase()
    }
    return email
  }

  const activeCount = employees.filter((e) => e.is_active).length
  const inactiveCount = employees.filter((e) => !e.is_active).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark-900">사용자 관리</h1>
          <p className="text-sm text-dark-500 mt-0.5">직원 계정을 생성하고 관리합니다</p>
        </div>
        <button
          onClick={() => setCreateModal({ open: true, employeeNumber: '', name: '', department: '', role: 'employee', password: '', passwordConfirm: '' })}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          직원 추가
        </button>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-center">
          <Users className="w-5 h-5 text-dark-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-dark-900">{employees.length}</p>
          <p className="text-xs text-dark-500">전체</p>
        </div>
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-center">
          <UserCheck className="w-5 h-5 text-success-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-success-600">{activeCount}</p>
          <p className="text-xs text-dark-500">활성</p>
        </div>
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 text-center">
          <UserX className="w-5 h-5 text-warning-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-warning-600">{inactiveCount}</p>
          <p className="text-xs text-dark-500">대기</p>
        </div>
      </div>

      {/* 사용자 목록 */}
      {employees.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-12 text-center">
          <Shield className="w-12 h-12 text-dark-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-dark-500 mb-1">등록된 사용자가 없습니다</p>
          <p className="text-xs text-dark-400">직원 추가 버튼으로 새 직원을 등록하세요</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-dark-50 border-b border-dark-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-dark-500">이름</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-dark-500">사번</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-dark-500">부서</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-dark-500">포지션</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-dark-500">상태</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-dark-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-100">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-dark-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary-700">{emp.name.charAt(0)}</span>
                      </div>
                      <span className="font-medium text-dark-900">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-dark-500 text-xs font-mono">{getEmployeeNumber(emp.email)}</td>
                  <td className="px-3 py-3 text-center text-dark-600 text-xs">{emp.department || '-'}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[emp.role]}`}>
                      {ROLE_LABEL[emp.role]}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      onClick={() => toggleActive(emp.id)}
                      className={`text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                        emp.is_active
                          ? 'bg-success-50 text-success-700 hover:bg-success-100'
                          : 'bg-dark-100 text-dark-500 hover:bg-dark-200'
                      }`}
                    >
                      {emp.is_active ? '활성' : '대기'}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-6">
                      <button
                        onClick={() => openEdit(emp)}
                        disabled={emp.id === currentUser?.id}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium disabled:text-dark-300 disabled:cursor-not-allowed"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => setResetModal({ open: true, userId: emp.id, name: emp.name, newPassword: '', adminPassword: '' })}
                        disabled={emp.id === currentUser?.id}
                        className="text-xs text-warning-600 hover:text-warning-700 font-medium disabled:text-dark-300 disabled:cursor-not-allowed"
                        title="비밀번호 초기화"
                      >
                        <KeyRound className="w-3.5 h-3.5 inline" />
                      </button>
                      <button
                        onClick={() => setDeleteModal({ open: true, id: emp.id, name: emp.name })}
                        disabled={emp.id === currentUser?.id}
                        className="text-xs text-danger-600 hover:text-danger-700 font-medium disabled:text-dark-300 disabled:cursor-not-allowed"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 직원 추가 모달 */}
      {createModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCreateModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">신규 직원 등록</h3>
              <button onClick={() => { setCreateModal((p) => ({ ...p, open: false })); setActionError('') }}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">사번</label>
                <input
                  type="text"
                  value={createModal.employeeNumber}
                  onChange={(e) => setCreateModal((p) => ({ ...p, employeeNumber: e.target.value }))}
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
                  onChange={(e) => setCreateModal((p) => ({ ...p, name: e.target.value }))}
                  placeholder="이름 입력"
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">부서</label>
                <input
                  type="text"
                  value={createModal.department}
                  onChange={(e) => setCreateModal((p) => ({ ...p, department: e.target.value }))}
                  placeholder="부서명 입력"
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">포지션</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['employee', 'manager', 'admin'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setCreateModal((p) => ({ ...p, role: r }))}
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
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">비밀번호</label>
                <input
                  type="password"
                  value={createModal.password}
                  onChange={(e) => setCreateModal((p) => ({ ...p, password: e.target.value }))}
                  placeholder="6자 이상"
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">비밀번호 확인</label>
                <input
                  type="password"
                  value={createModal.passwordConfirm}
                  onChange={(e) => setCreateModal((p) => ({ ...p, passwordConfirm: e.target.value }))}
                  placeholder="비밀번호 재입력"
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>

              {actionError && <p className="text-xs text-danger-500">{actionError}</p>}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setCreateModal((p) => ({ ...p, open: false })); setActionError('') }}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={handleCreateUser}
                disabled={actionLoading}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
              >
                {actionLoading ? '처리중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 초기화 모달 */}
      {resetModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setResetModal((p) => ({ ...p, open: false })); setActionError('') }} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">비밀번호 초기화</h3>
              <button onClick={() => { setResetModal((p) => ({ ...p, open: false })); setActionError('') }}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>

            <p className="text-sm text-dark-600 mb-4">
              <span className="font-semibold">{resetModal.name}</span>의 비밀번호를 초기화합니다.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">인사담당자 비밀번호 입력</label>
                <input
                  type="password"
                  value={resetModal.adminPassword}
                  onChange={(e) => { setResetModal((p) => ({ ...p, adminPassword: e.target.value })); setActionError('') }}
                  placeholder="본인 비밀번호 입력"
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">{resetModal.name}의 새 임시 비밀번호</label>
                <input
                  type="password"
                  value={resetModal.newPassword}
                  onChange={(e) => setResetModal((p) => ({ ...p, newPassword: e.target.value }))}
                  placeholder="6자 이상"
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>

            {actionError && <p className="text-xs text-danger-500 mt-2">{actionError}</p>}

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setResetModal((p) => ({ ...p, open: false })); setActionError('') }}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={handleResetPassword}
                disabled={actionLoading}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-warning-500 rounded-xl hover:bg-warning-600 transition-colors disabled:opacity-50"
              >
                {actionLoading ? '처리중...' : '초기화'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 수정 모달 */}
      {editModal.open && editModal.employee && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">사용자 정보 수정</h3>
              <button onClick={() => setEditModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-dark-400 mb-2">{getEmployeeNumber(editModal.employee.email)}</p>
                <label className="block text-xs font-medium text-dark-600 mb-1">이름</label>
                <input
                  type="text"
                  value={editModal.name}
                  onChange={(e) => setEditModal((p) => ({ ...p, name: e.target.value }))}
                  placeholder="이름 입력"
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">부서</label>
                <input
                  type="text"
                  value={editModal.department}
                  onChange={(e) => setEditModal((p) => ({ ...p, department: e.target.value }))}
                  placeholder="부서명 입력"
                  className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-dark-600 mb-1">포지션</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['employee', 'manager', 'admin'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setEditModal((p) => ({ ...p, role: r }))}
                      className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                        editModal.role === r
                          ? 'bg-primary-500 text-white border-primary-600'
                          : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                      }`}
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-dark-600">계정 활성화</span>
                <button
                  onClick={() => setEditModal((p) => ({ ...p, isActive: !p.isActive }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    editModal.isActive ? 'bg-success-500' : 'bg-dark-300'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    editModal.isActive ? 'translate-x-5' : ''
                  }`} />
                </button>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setEditModal((p) => ({ ...p, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteModal({ open: false, id: '', name: '' })} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-dark-900">사용자 삭제</h3>
              <button onClick={() => setDeleteModal({ open: false, id: '', name: '' })}>
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <p className="text-sm text-dark-600 mb-2">
              <span className="font-semibold">{deleteModal.name}</span> 사용자를 삭제하시겠습니까?
            </p>
            <p className="text-xs text-danger-600 bg-danger-50 rounded-lg px-3 py-2">
              삭제된 사용자의 관련 데이터(야근, 휴가, 경비 등)도 함께 삭제됩니다.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setDeleteModal({ open: false, id: '', name: '' })}
                className="flex-1 py-2.5 text-sm font-medium text-dark-600 border border-dark-200 rounded-xl hover:bg-dark-50"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-danger-500 rounded-xl hover:bg-danger-600 transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

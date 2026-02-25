import { useState, useEffect } from 'react'
import { Users, UserCheck, UserX, Shield, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { Employee, UserRole } from '../types'

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

interface EditModal {
  open: boolean
  employee: Employee | null
  role: UserRole
  department: string
  isActive: boolean
}

export function AdminUsersPage() {
  const { employee: currentUser } = useAuth()
  const [employees, setEmployees] = useState<Employee[]>([])

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) setEmployees(data)
      })
  }, [])
  const [editModal, setEditModal] = useState<EditModal>({
    open: false, employee: null, role: 'employee', department: '', isActive: true,
  })

  function openEdit(emp: Employee) {
    setEditModal({
      open: true,
      employee: emp,
      role: emp.role,
      department: emp.department,
      isActive: emp.is_active,
    })
  }

  async function saveEdit() {
    if (!editModal.employee) return
    const id = editModal.employee.id
    const updates = { role: editModal.role, department: editModal.department, is_active: editModal.isActive }
    await supabase.from('employees').update(updates).eq('id', id)
    setEmployees((prev) =>
      prev.map((e) => e.id === id ? { ...e, ...updates } : e),
    )
    setEditModal({ open: false, employee: null, role: 'employee', department: '', isActive: true })
  }

  async function toggleActive(id: string) {
    const emp = employees.find((e) => e.id === id)
    if (!emp) return
    const newActive = !emp.is_active
    await supabase.from('employees').update({ is_active: newActive }).eq('id', id)
    setEmployees((prev) =>
      prev.map((e) => e.id === id ? { ...e, is_active: newActive } : e),
    )
  }

  const activeCount = employees.filter((e) => e.is_active).length
  const inactiveCount = employees.filter((e) => !e.is_active).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">사용자 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">로그인한 사용자에게 포지션을 부여하고 관리합니다</p>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <Users className="w-5 h-5 text-gray-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-900">{employees.length}</p>
          <p className="text-xs text-gray-500">전체</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <UserCheck className="w-5 h-5 text-success-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-success-600">{activeCount}</p>
          <p className="text-xs text-gray-500">활성</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <UserX className="w-5 h-5 text-warning-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-warning-600">{inactiveCount}</p>
          <p className="text-xs text-gray-500">대기</p>
        </div>
      </div>

      {/* 사용자 목록 */}
      {employees.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Shield className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">등록된 사용자가 없습니다</p>
          <p className="text-xs text-gray-400">Google 로그인한 사용자가 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">이름</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500">이메일</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">부서</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">포지션</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">상태</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary-700">{emp.name.charAt(0)}</span>
                      </div>
                      <span className="font-medium text-gray-900">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-gray-500 text-xs">{emp.email}</td>
                  <td className="px-3 py-3 text-center text-gray-600 text-xs">{emp.department || '-'}</td>
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
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {emp.is_active ? '활성' : '대기'}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      onClick={() => openEdit(emp)}
                      disabled={emp.id === currentUser?.id}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium disabled:text-gray-300 disabled:cursor-not-allowed"
                    >
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 수정 모달 */}
      {editModal.open && editModal.employee && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditModal((p) => ({ ...p, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">사용자 정보 수정</h3>
              <button onClick={() => setEditModal((p) => ({ ...p, open: false }))}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">{editModal.employee.name}</p>
                <p className="text-xs text-gray-400">{editModal.employee.email}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">부서</label>
                <input
                  type="text"
                  value={editModal.department}
                  onChange={(e) => setEditModal((p) => ({ ...p, department: e.target.value }))}
                  placeholder="부서명 입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">포지션</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['employee', 'manager', 'admin'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setEditModal((p) => ({ ...p, role: r }))}
                      className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                        editModal.role === r
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                      }`}
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">계정 활성화</span>
                <button
                  onClick={() => setEditModal((p) => ({ ...p, isActive: !p.isActive }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    editModal.isActive ? 'bg-success-500' : 'bg-gray-300'
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
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

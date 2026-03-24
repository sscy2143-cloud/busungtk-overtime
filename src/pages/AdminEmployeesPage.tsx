import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, UserCheck, UserX, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
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

interface EditState {
  empId: string
  name: string
  department: string
  role: UserRole
  employeeType: EmployeeType
  hourlyWage: string
}

export function AdminEmployeesPage() {
  const navigate = useNavigate()
  const { employee: currentUser } = useAuth()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'resigned'>('active')
  const [editEmp, setEditEmp] = useState<EditState | null>(null)
  const [resignConfirm, setResignConfirm] = useState<{ id: string; name: string } | null>(null)
  const [reinstateConfirm, setReinstateConfirm] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) setEmployees(data)
        setLoading(false)
      })
  }, [])

  const activeEmps = useMemo(() => employees.filter(e => e.is_active), [employees])
  const resignedEmps = useMemo(() => employees.filter(e => !e.is_active), [employees])
  const displayEmps = tab === 'active' ? activeEmps : resignedEmps

  function openEdit(emp: Employee) {
    setEditEmp({
      empId: emp.id,
      name: emp.name,
      department: emp.department,
      role: emp.role,
      employeeType: emp.employee_type,
      hourlyWage: emp.hourly_wage > 0 ? String(emp.hourly_wage) : '',
    })
  }

  async function saveEdit() {
    if (!editEmp) return
    const wage = parseInt(editEmp.hourlyWage.replace(/,/g, ''), 10)
    await supabase.from('employees').update({
      name: editEmp.name,
      department: editEmp.department,
      role: editEmp.role,
      employee_type: editEmp.employeeType,
      hourly_wage: isNaN(wage) ? 0 : wage,
    }).eq('id', editEmp.empId)
    setEmployees(prev => prev.map(e => e.id === editEmp.empId ? {
      ...e,
      name: editEmp.name,
      department: editEmp.department,
      role: editEmp.role,
      employee_type: editEmp.employeeType,
      hourly_wage: isNaN(wage) ? 0 : wage,
    } : e))
    setEditEmp(null)
  }

  async function handleResign(id: string) {
    await supabase.from('employees').update({ is_active: false }).eq('id', id)
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, is_active: false } : e))
    setResignConfirm(null)
  }

  async function handleReinstate(id: string) {
    await supabase.from('employees').update({ is_active: true }).eq('id', id)
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, is_active: true } : e))
    setReinstateConfirm(null)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <p className="text-sm text-dark-400">불러오는 중...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-dark-900">사원현황</h1>
        <p className="text-sm text-dark-500 mt-0.5">재직자 및 퇴직자 정보를 관리합니다</p>
      </div>

      {/* 요약 카드 */}
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

      {/* 탭 */}
      <div className="flex bg-dark-100 rounded-xl p-1 gap-1 w-fit">
        <button
          onClick={() => setTab('active')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            tab === 'active' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
          }`}
        >
          재직자 {activeEmps.length}
        </button>
        <button
          onClick={() => setTab('resigned')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            tab === 'resigned' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
          }`}
        >
          퇴직자 {resignedEmps.length}
        </button>
      </div>

      {/* 직원 목록 */}
      {displayEmps.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] py-16 text-center">
          <p className="text-sm text-dark-400">{tab === 'active' ? '재직 중인 직원이 없습니다' : '퇴직자가 없습니다'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-dark-50 border-b border-dark-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">이름</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-dark-500">부서</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-dark-500">고용형태</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-dark-500">권한</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-dark-500">시급</th>
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
                    <td className="px-3 py-3 text-xs text-dark-500">{emp.department || '-'}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        emp.employee_type === 'field'
                          ? 'bg-primary-50 text-primary-700'
                          : 'bg-primary-50 text-primary-700'
                      }`}>
                        {EMP_TYPE_LABEL[emp.employee_type]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[emp.role]}`}>
                        {ROLE_LABEL[emp.role]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-xs font-medium text-dark-700">
                      {emp.hourly_wage > 0
                        ? `${emp.hourly_wage.toLocaleString('ko-KR')}원`
                        : <span className="text-dark-300">미설정</span>
                      }
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-dark-400">
                      {new Date(emp.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-3">
                        <button
                          onClick={() => openEdit(emp)}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                        >
                          편집
                        </button>
                        {emp.is_active ? (
                          <button
                            onClick={() => setResignConfirm({ id: emp.id, name: emp.name })}
                            disabled={emp.id === currentUser?.id}
                            className="text-xs text-dark-400 hover:text-warning-600 font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            퇴직
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => setReinstateConfirm({ id: emp.id, name: emp.name })}
                              className="text-xs text-success-600 hover:text-success-700 font-medium"
                            >
                              복직
                            </button>
                            <button
                              onClick={() => navigate('/admin/overtime/employees')}
                              className="text-xs text-dark-400 hover:text-dark-600 font-medium"
                            >
                              이력
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 편집 모달 */}
      {editEmp && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditEmp(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-dark-900">직원 정보 수정</h3>
              <button onClick={() => setEditEmp(null)}><X className="w-5 h-5 text-dark-400" /></button>
            </div>

            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">이름</label>
              <input
                defaultValue={editEmp.name}
                onChange={e => setEditEmp(p => p ? { ...p, name: e.target.value } : p)}
                className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">부서</label>
              <input
                defaultValue={editEmp.department}
                onChange={e => setEditEmp(p => p ? { ...p, department: e.target.value } : p)}
                className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">고용형태</label>
              <div className="grid grid-cols-2 gap-2">
                {(['office', 'field'] as EmployeeType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEditEmp(p => p ? { ...p, employeeType: t } : p)}
                    className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                      editEmp.employeeType === t
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
                    onClick={() => setEditEmp(p => p ? { ...p, role: r } : p)}
                    className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                      editEmp.role === r
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
              <label className="block text-xs font-medium text-dark-600 mb-1">시급 (원)</label>
              <input
                type="number"
                defaultValue={editEmp.hourlyWage}
                onChange={e => setEditEmp(p => p ? { ...p, hourlyWage: e.target.value } : p)}
                placeholder="예: 10000"
                className="w-full px-3 py-2 text-sm border border-dark-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
              <p className="text-xs text-dark-400 mt-1">연장근무수당 자동 계산에 사용됩니다</p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setEditEmp(null)}
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

      {/* 퇴직 확인 */}
      {resignConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setResignConfirm(null)} />
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

      {/* 복직 확인 */}
      {reinstateConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setReinstateConfirm(null)} />
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
    </div>
  )
}

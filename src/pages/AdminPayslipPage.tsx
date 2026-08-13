import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, Download, FileText, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PayrollLedgerPanel } from '../components/payslip/PayrollLedgerPanel'

interface Payslip {
  id: string
  employee_id: string
  period: string
  file_path: string
  file_name: string
  message: string | null
  admin_note: string | null
  created_at: string
  work_start: string | null
  work_end: string | null
  employee: { name: string; department: string } | null
}

interface Employee {
  id: string
  name: string
  department: string
  hourly_wage: number
  hire_date: string | null
  employee_type: 'office' | 'field'
  is_active: boolean
}

interface RowForm {
  file: File | null
  message: string
  adminNote: string
  workStart: string
  workEnd: string
  uploading: boolean
  done: boolean
}

export function AdminPayslipPage() {
  const { employee: currentUser } = useAuth()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [tab, setTab] = useState<'register' | 'list' | 'ledger'>('register')
  const [filterEmpId, setFilterEmpId] = useState('')

  // 사원별 폼 상태
  const [rowForms, setRowForms] = useState<Record<string, RowForm>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => { fetchAll() }, [])

  // period 변경 시 기존 등록 여부 확인해서 rowForms 업데이트
  useEffect(() => {
    const newForms: Record<string, RowForm> = {}
    for (const emp of employees) {
      const existing = payslips.find(s => s.employee_id === emp.id && s.period === period)
      newForms[emp.id] = {
        file: null,
        message: existing?.message ?? '',
        adminNote: existing?.admin_note ?? '',
        workStart: existing?.work_start ?? '',
        workEnd: existing?.work_end ?? '',
        uploading: false,
        done: !!existing,
      }
    }
    setRowForms(newForms)
  }, [period, employees, payslips])

  async function fetchAll() {
    const [{ data: slips }, { data: emps }] = await Promise.all([
      supabase
        .from('payslips')
        .select('*, employee:employees!payslips_employee_id_fkey(name, department)')
        .order('period', { ascending: false }),
      supabase
        .from('employees')
        .select('id, name, department, hourly_wage, hire_date, employee_type, is_active')
        .order('name'),
    ])
    if (slips) setPayslips(slips as any)
    if (emps) setEmployees(emps as Employee[])
    setLoading(false)
  }

  function updateRow(empId: string, patch: Partial<RowForm>) {
    setRowForms(prev => ({ ...prev, [empId]: { ...prev[empId], ...patch } }))
  }

  async function handleUploadRow(empId: string) {
    const row = rowForms[empId]
    if (!row?.file) return

    // 파일 검증
    const MAX_SIZE = 5 * 1024 * 1024 // 5MB
    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (row.file.size > MAX_SIZE) {
      alert('파일 크기가 5MB를 초과합니다.')
      return
    }
    if (!ALLOWED.includes(row.file.type)) {
      alert('허용되지 않는 파일 형식입니다. (PDF, JPG, PNG, WEBP)')
      return
    }

    updateRow(empId, { uploading: true })

    // 파일명: 기간_랜덤.확장자 (경로 예측 방지)
    const ext = row.file.name.split('.').pop()
    const rand = crypto.randomUUID().slice(0, 8)
    const path = `${empId}/${period}_${rand}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('payslips')
      .upload(path, row.file, { upsert: true })

    if (uploadError) {
      updateRow(empId, { uploading: false })
      alert('업로드에 실패했습니다. 잠시 후 다시 시도해주세요.')
      return
    }

    // 기존 레코드 삭제 후 재삽입
    await supabase.from('payslips').delete().eq('employee_id', empId).eq('period', period)
    const { error: insertError } = await supabase.from('payslips').insert({
      employee_id: empId,
      period,
      file_path: path,
      file_name: row.file.name,
      message: row.message.trim() || null,
      admin_note: row.adminNote.trim() || null,
      work_start: row.workStart || null,
      work_end: row.workEnd || null,
      uploaded_by: currentUser?.id,
    })

    if (insertError) {
      updateRow(empId, { uploading: false })
      alert('등록에 실패했습니다. 잠시 후 다시 시도해주세요.')
      return
    }

    updateRow(empId, { uploading: false, done: true, file: null })
    fetchAll()
  }

  async function handleDelete(slip: Payslip) {
    if (!confirm(`${slip.employee?.name}의 ${fmtPeriod(slip.period)} 명세서를 삭제할까요?`)) return
    await supabase.storage.from('payslips').remove([slip.file_path])
    await supabase.from('payslips').delete().eq('id', slip.id)
    fetchAll()
  }

  async function handleDownload(slip: Payslip) {
    const { data } = await supabase.storage.from('payslips').createSignedUrl(slip.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  function fmtPeriod(p: string) {
    const [y, m] = p.split('-')
    return `${y}년 ${parseInt(m)}월`
  }

  const filteredList = filterEmpId ? payslips.filter(s => s.employee_id === filterEmpId) : payslips

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-dark-400">불러오는 중...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-dark-900">급여명세서 관리</h1>

      {/* 탭 */}
      <div className="flex gap-1 bg-dark-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('register')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'register' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
          }`}
        >
          명세서 등록
        </button>
        <button
          onClick={() => setTab('list')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'list' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
          }`}
        >
          등록 현황
        </button>
        <button
          onClick={() => setTab('ledger')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'ledger' ? 'bg-white text-dark-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)]' : 'text-dark-500 hover:text-dark-700'
          }`}
        >
          급여대장
        </button>
      </div>

      {tab === 'ledger' ? (
        <div className="mx-[calc(50%-50vw)] px-2">
          <PayrollLedgerPanel employees={employees} onSaved={fetchAll} />
        </div>
      ) : tab === 'register' ? (
        <>
          {/* 기간 선택 */}
          <div className="bg-white rounded-xl border border-dark-200 p-4 flex items-center gap-3">
            <label className="text-sm font-medium text-dark-600">지급월</label>
            <input
              type="month"
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="px-3 py-2 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <span className="text-xs text-dark-400">
              {employees.length}명 재직 중 · {payslips.filter(s => s.period === period).length}명 등록 완료
            </span>
          </div>

          {/* 사원 리스트 */}
          <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-100 bg-dark-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500 w-28">직원</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">파일</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">실근로일</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">전달 문구</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">기타 (관리자 메모)</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-dark-400 w-20">등록</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-50">
                  {employees.map(emp => {
                    const row = rowForms[emp.id]
                    if (!row) return null
                    const existing = payslips.find(s => s.employee_id === emp.id && s.period === period)
                    return (
                      <tr key={emp.id} className={`transition-colors ${row.done ? 'bg-dark-50/50' : 'hover:bg-dark-50'}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-dark-800 text-sm">{emp.name}</p>
                          <p className="text-xs text-dark-400">{emp.department}</p>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            ref={el => { fileRefs.current[emp.id] = el }}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={e => updateRow(emp.id, { file: e.target.files?.[0] ?? null, done: false })}
                            className="hidden"
                          />
                          {existing && !row.file ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-dark-700 font-medium flex items-center gap-1">
                                <Check size={12} />
                                {existing.file_name}
                              </span>
                              <button
                                onClick={() => fileRefs.current[emp.id]?.click()}
                                className="text-xs text-primary-600 hover:underline"
                              >
                                변경
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => fileRefs.current[emp.id]?.click()}
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border border-dashed rounded-lg transition-colors ${
                                row.file
                                  ? 'border-primary-400 text-primary-700 bg-primary-50'
                                  : 'border-dark-200 text-dark-400 hover:border-primary-400'
                              }`}
                            >
                              <Upload size={12} />
                              {row.file ? row.file.name : '파일 선택'}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              value={row.workStart}
                              onChange={e => updateRow(emp.id, { workStart: e.target.value })}
                              className="w-[120px] px-1.5 py-1.5 text-xs border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
                            />
                            <span className="text-xs text-dark-400">~</span>
                            <input
                              type="date"
                              value={row.workEnd}
                              onChange={e => updateRow(emp.id, { workEnd: e.target.value })}
                              className="w-[120px] px-1.5 py-1.5 text-xs border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={row.message}
                            onChange={e => updateRow(emp.id, { message: e.target.value })}
                            placeholder="직원에게 전달할 문구"
                            className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={row.adminNote}
                            onChange={e => updateRow(emp.id, { adminNote: e.target.value })}
                            placeholder="관리자 메모 (직원 비공개)"
                            className="w-full px-2 py-1.5 text-xs border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 bg-primary-50/30"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.done && !row.file ? (
                            <span className="text-xs text-dark-700 font-medium">완료</span>
                          ) : (
                            <button
                              onClick={() => handleUploadRow(emp.id)}
                              disabled={!row.file || row.uploading}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-40 transition-colors"
                            >
                              {row.uploading ? '...' : '등록'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* 등록 현황 탭 */}
          <div className="flex gap-2">
            <select
              value={filterEmpId}
              onChange={e => setFilterEmpId(e.target.value)}
              className="px-3 py-2 text-sm border border-dark-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            >
              <option value="">전체 직원</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name} ({e.department})</option>
              ))}
            </select>
            {filterEmpId && (
              <button
                onClick={() => setFilterEmpId('')}
                className="px-3 py-2 text-xs text-dark-500 border border-dark-200 rounded-lg hover:bg-dark-50"
              >
                초기화
              </button>
            )}
          </div>

          {filteredList.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] py-16 text-center">
              <FileText className="w-8 h-8 text-dark-200 mx-auto mb-3" />
              <p className="text-sm text-dark-400">등록된 급여명세서가 없습니다</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-100 bg-dark-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500">직원</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400">부서</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-dark-500">지급월</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-dark-400">실근로일</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400">파일명</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400">전달 문구</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400">기타</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-dark-400">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-50">
                    {filteredList.map(slip => (
                      <tr key={slip.id} className="hover:bg-dark-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-dark-800">{slip.employee?.name ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-dark-400">{slip.employee?.department ?? '-'}</td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-dark-700">{fmtPeriod(slip.period)}</td>
                        <td className="px-4 py-3 text-center text-xs text-dark-500">
                          {slip.work_start && slip.work_end
                            ? `${slip.work_start.slice(5).replace('-', '/')} ~ ${slip.work_end.slice(5).replace('-', '/')}`
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-xs text-dark-500 max-w-[150px] truncate">{slip.file_name}</td>
                        <td className="px-4 py-3 text-xs text-dark-600 max-w-[150px] truncate">{slip.message ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-primary-600 max-w-[150px] truncate">{slip.admin_note ?? '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleDownload(slip)}
                              className="p-1.5 rounded-lg hover:bg-primary-50 text-primary-600 transition-colors"
                              title="다운로드"
                            >
                              <Download size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(slip)}
                              className="p-1.5 rounded-lg hover:bg-primary-50 text-primary-400 transition-colors"
                              title="삭제"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

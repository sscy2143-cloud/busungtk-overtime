import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, Download, Plus, X, FileText } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

interface Payslip {
  id: string
  employee_id: string
  period: string
  file_path: string
  file_name: string
  created_at: string
  employee: { name: string; department: string } | null
}

interface EmpOption {
  id: string
  name: string
  department: string
}

interface UploadModal {
  open: boolean
  employeeId: string
  period: string
  file: File | null
}

export function AdminPayslipPage() {
  const { employee: currentUser } = useAuth()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<EmpOption[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [filterEmpId, setFilterEmpId] = useState('')
  const [modal, setModal] = useState<UploadModal>({
    open: false,
    employeeId: '',
    period: new Date().toISOString().slice(0, 7),
    file: null,
  })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: slips }, { data: emps }] = await Promise.all([
      supabase
        .from('payslips')
        .select('*, employee:employees!payslips_employee_id_fkey(name, department)')
        .order('period', { ascending: false }),
      supabase
        .from('employees')
        .select('id, name, department')
        .eq('is_active', true)
        .order('name'),
    ])
    if (slips) setPayslips(slips as any)
    if (emps) setEmployees(emps as EmpOption[])
    setLoading(false)
  }

  async function handleUpload() {
    const { employeeId, period, file } = modal
    if (!file || !employeeId || !period) return
    setUploading(true)

    const ext = file.name.split('.').pop()
    const path = `${employeeId}/${period}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('payslips')
      .upload(path, file, { upsert: true })

    if (uploadError) {
      setUploading(false)
      alert('업로드 실패: ' + uploadError.message)
      return
    }

    // 기존 레코드 삭제 후 재삽입 (upsert 대신)
    await supabase.from('payslips').delete().eq('employee_id', employeeId).eq('period', period)
    await supabase.from('payslips').insert({
      employee_id: employeeId,
      period,
      file_path: path,
      file_name: file.name,
      uploaded_by: currentUser?.id,
    })

    setModal({ open: false, employeeId: '', period: new Date().toISOString().slice(0, 7), file: null })
    setUploading(false)
    fetchAll()
  }

  async function handleDelete(slip: Payslip) {
    if (!confirm(`${slip.employee?.name}의 ${slip.period} 명세서를 삭제할까요?`)) return
    await supabase.storage.from('payslips').remove([slip.file_path])
    await supabase.from('payslips').delete().eq('id', slip.id)
    fetchAll()
  }

  async function handleDownload(slip: Payslip) {
    const { data } = await supabase.storage.from('payslips').createSignedUrl(slip.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  function fmtPeriod(p: string) {
    const [y, m] = p.split('-')
    return `${y}년 ${parseInt(m)}월`
  }

  const filtered = filterEmpId ? payslips.filter(s => s.employee_id === filterEmpId) : payslips

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-bold text-gray-900">급여명세서 관리</h1>
        <button
          onClick={() => setModal(m => ({ ...m, open: true }))}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus size={16} />
          명세서 등록
        </button>
      </div>

      {/* 필터 */}
      <div className="flex gap-2">
        <select
          value={filterEmpId}
          onChange={e => setFilterEmpId(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
        >
          <option value="">전체 직원</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.name} ({e.department})</option>
          ))}
        </select>
        {filterEmpId && (
          <button
            onClick={() => setFilterEmpId('')}
            className="px-3 py-2 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            초기화
          </button>
        )}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-gray-400">불러오는 중...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <FileText className="w-8 h-8 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">등록된 급여명세서가 없습니다</p>
          <p className="text-xs text-gray-300 mt-1">명세서 등록 버튼을 눌러 파일을 업로드하세요</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">직원</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">부서</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 whitespace-nowrap">지급월</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 whitespace-nowrap">파일명</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 whitespace-nowrap">등록일</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(slip => (
                  <tr key={slip.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{slip.employee?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{slip.employee?.department ?? '-'}</td>
                    <td className="px-4 py-3 text-center text-sm font-semibold text-gray-700">{fmtPeriod(slip.period)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{slip.file_name}</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-400">
                      {new Date(slip.created_at).toLocaleDateString('ko-KR')}
                    </td>
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
                          className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
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

      {/* 업로드 모달 */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(m => ({ ...m, open: false }))} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">급여명세서 등록</h3>
              <button onClick={() => setModal(m => ({ ...m, open: false }))}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  직원 <span className="text-red-500">*</span>
                </label>
                <select
                  value={modal.employeeId}
                  onChange={e => setModal(m => ({ ...m, employeeId: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                >
                  <option value="">직원을 선택하세요</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.department})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  지급월 <span className="text-red-500">*</span>
                </label>
                <input
                  type="month"
                  value={modal.period}
                  onChange={e => setModal(m => ({ ...m, period: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  파일 <span className="text-red-500">*</span>
                  <span className="text-gray-400 font-normal ml-1">(PDF, JPG, PNG)</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={e => setModal(m => ({ ...m, file: e.target.files?.[0] ?? null }))}
                  className="hidden"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className={`w-full px-3 py-2.5 text-sm border border-dashed rounded-xl transition-colors text-left ${
                    modal.file
                      ? 'border-primary-400 text-primary-700 bg-primary-50'
                      : 'border-gray-300 text-gray-400 hover:border-primary-400 hover:text-primary-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Upload size={14} />
                    {modal.file ? modal.file.name : '파일을 선택하세요'}
                  </div>
                </button>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setModal(m => ({ ...m, open: false }))}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleUpload}
                disabled={!modal.employeeId || !modal.period || !modal.file || uploading}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors"
              >
                {uploading ? '업로드 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

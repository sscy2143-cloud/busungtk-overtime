import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Trash2, Upload, Download, AlertTriangle, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface DailyWorker {
  id: string
  name: string
  resident_number: string | null
  project: string | null
  nationality: string | null
  visa_status: string | null
  job_type: string | null
  work_date: string | null
  daily_wage: number
  bank: string | null
  account_number: string | null
  mobile_phone: string | null
  phone: string | null
  note: string | null
}

interface WorkerForm {
  name: string
  resident_number: string
  project: string
  nationality: string
  visa_status: string
  job_type: string
  work_date: string
  daily_wage: string
  bank: string
  account_number: string
  mobile_phone: string
  phone: string
  note: string
}

const EMPTY_FORM: WorkerForm = {
  name: '', resident_number: '', project: '', nationality: '', visa_status: '',
  job_type: '', work_date: '', daily_wage: '', bank: '', account_number: '', mobile_phone: '', phone: '', note: '',
}

function fmt(n: number) {
  return n.toLocaleString('ko-KR')
}

export function DailyWorkerPanel() {
  const [workers, setWorkers] = useState<DailyWorker[]>([])
  const [loading, setLoading] = useState(true)
  const [migrationReady, setMigrationReady] = useState<boolean | null>(null)
  const [projectFilter, setProjectFilter] = useState('')
  const [nameFilter, setNameFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<WorkerForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const { data, error } = await supabase.from('daily_workers').select('*').order('created_at', { ascending: false })
    setMigrationReady(!error)
    if (data) setWorkers(data as DailyWorker[])
    setLoading(false)
  }

  const projects = Array.from(new Set(workers.map(w => w.project).filter((p): p is string => !!p)))

  const filtered = workers.filter(w =>
    (!projectFilter || w.project === projectFilter) &&
    (!nameFilter || w.name.includes(nameFilter))
  )

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(w: DailyWorker) {
    setEditingId(w.id)
    setForm({
      name: w.name, resident_number: w.resident_number ?? '', project: w.project ?? '',
      nationality: w.nationality ?? '', visa_status: w.visa_status ?? '', job_type: w.job_type ?? '',
      work_date: w.work_date ?? '', daily_wage: String(w.daily_wage ?? 0), bank: w.bank ?? '',
      account_number: w.account_number ?? '', mobile_phone: w.mobile_phone ?? '', phone: w.phone ?? '',
      note: w.note ?? '',
    })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { alert('사원명을 입력해주세요'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      resident_number: form.resident_number.trim() || null,
      project: form.project.trim() || null,
      nationality: form.nationality.trim() || null,
      visa_status: form.visa_status.trim() || null,
      job_type: form.job_type.trim() || null,
      work_date: form.work_date || null,
      daily_wage: Number(form.daily_wage) || 0,
      bank: form.bank.trim() || null,
      account_number: form.account_number.trim() || null,
      mobile_phone: form.mobile_phone.trim() || null,
      phone: form.phone.trim() || null,
      note: form.note.trim() || null,
    }
    const { error } = editingId
      ? await supabase.from('daily_workers').update(payload).eq('id', editingId)
      : await supabase.from('daily_workers').insert(payload)
    setSaving(false)
    if (error) { alert('저장에 실패했습니다. 잠시 후 다시 시도해주세요.'); return }
    setShowForm(false)
    fetchAll()
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    if (!confirm(`선택한 ${selectedIds.size}명을 삭제할까요?`)) return
    await supabase.from('daily_workers').delete().in('id', Array.from(selectedIds))
    setSelectedIds(new Set())
    fetchAll()
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev => (prev.size === filtered.length ? new Set() : new Set(filtered.map(w => w.id))))
  }

  async function handleExportExcel() {
    setExporting(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('일용직사원')
      ws.columns = [
        { header: '사원명', key: 'name', width: 12 },
        { header: '주민(외국인)번호', key: 'resident_number', width: 18 },
        { header: '프로젝트', key: 'project', width: 16 },
        { header: '국적', key: 'nationality', width: 10 },
        { header: '체류자격', key: 'visa_status', width: 10 },
        { header: '직종', key: 'job_type', width: 12 },
        { header: '근무일', key: 'work_date', width: 12 },
        { header: '일지급금', key: 'daily_wage', width: 12 },
        { header: '은행', key: 'bank', width: 10 },
        { header: '계좌번호', key: 'account_number', width: 18 },
        { header: '휴대전화', key: 'mobile_phone', width: 14 },
        { header: '전화번호', key: 'phone', width: 14 },
        { header: '비고', key: 'note', width: 20 },
      ]
      ws.getRow(1).font = { bold: true }
      for (const w of filtered) {
        ws.addRow({
          name: w.name,
          resident_number: w.resident_number ?? '',
          project: w.project ?? '',
          nationality: w.nationality ?? '',
          visa_status: w.visa_status ?? '',
          job_type: w.job_type ?? '',
          work_date: w.work_date ?? '',
          daily_wage: w.daily_wage,
          bank: w.bank ?? '',
          account_number: w.account_number ?? '',
          mobile_phone: w.mobile_phone ?? '',
          phone: w.phone ?? '',
          note: w.note ?? '',
        })
      }
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '일용직사원목록.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await file.arrayBuffer())
      const ws = wb.worksheets[0]
      if (!ws) return
      const rows: Array<Record<string, string | number | null>> = []
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        const cell = (c: number) => {
          const val = row.getCell(c).value
          return val == null ? '' : String(val).trim()
        }
        const name = cell(1)
        if (!name) return
        rows.push({
          name,
          resident_number: cell(2) || null,
          project: cell(3) || null,
          nationality: cell(4) || null,
          visa_status: cell(5) || null,
          job_type: cell(6) || null,
          work_date: cell(7) || null,
          daily_wage: Number(cell(8)) || 0,
          bank: cell(9) || null,
          account_number: cell(10) || null,
          mobile_phone: cell(11) || null,
          phone: cell(12) || null,
          note: cell(13) || null,
        })
      })
      if (rows.length === 0) { alert('가져올 데이터가 없습니다.'); return }
      const { error } = await supabase.from('daily_workers').insert(rows)
      if (error) { alert('업로드에 실패했습니다. 잠시 후 다시 시도해주세요.'); return }
      alert(`${rows.length}명 등록되었습니다.`)
      fetchAll()
    } finally {
      setImporting(false)
    }
  }

  if (migrationReady === false) {
    return (
      <div className="flex items-start gap-2 bg-warning-50 border border-warning-200 rounded-xl px-4 py-3 text-xs text-warning-700">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <span>DB 마이그레이션이 아직 실행되지 않았습니다. <code>supabase/migrations/20260813010000_daily_workers.sql</code>을 Supabase에서 먼저 실행해주세요.</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-dark-900">일용직대장</h2>
        <p className="text-xs text-dark-400 mt-0.5">시공건이 있을 때 사용한 일용직 인력 정보를 관리합니다.</p>
      </div>

      <div className="bg-white rounded-xl border border-dark-200 p-4 flex flex-wrap items-center gap-2">
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="px-3 py-2 text-sm border border-dark-200 rounded-lg bg-white">
          <option value="">프로젝트명 전체</option>
          {projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-300" />
          <input
            type="text"
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            placeholder="사원명을 입력하세요"
            className="pl-7 pr-3 py-2 text-sm border border-dark-200 rounded-lg"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-dark-600">총 <b className="text-dark-900">{filtered.length}</b>명</span>
        <span className="text-dark-200">|</span>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors"
        >
          <Plus size={14} /> 일용직 사원등록
        </button>
        <button
          onClick={handleDeleteSelected}
          disabled={selectedIds.size === 0}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-dark-600 border border-dark-200 rounded-lg hover:bg-dark-50 transition-colors disabled:opacity-40"
        >
          <Trash2 size={14} /> 삭제
        </button>

        <div className="ml-auto flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleImportExcel} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-dark-600 border border-dark-200 rounded-lg hover:bg-dark-50 transition-colors disabled:opacity-50"
          >
            <Upload size={14} /> {importing ? '업로드 중...' : '엑셀 업로드'}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={exporting || filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-dark-600 border border-dark-200 rounded-lg hover:bg-dark-50 transition-colors disabled:opacity-50"
          >
            <Download size={14} /> {exporting ? '생성 중...' : '엑셀 다운로드'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-dark-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-100 bg-dark-50">
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" checked={filtered.length > 0 && selectedIds.size === filtered.length} onChange={toggleSelectAll} className="rounded border-dark-300" />
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-500">사원명</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">주민(외국인)번호</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">프로젝트</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">국적</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">체류자격</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">직종</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-dark-400">근무일</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-dark-500">일지급금</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">은행</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">계좌번호</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">휴대전화</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">전화번호</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-dark-400">비고</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-50">
              {loading ? (
                <tr><td colSpan={13} className="py-16 text-center text-sm text-dark-400">불러오는 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={13} className="py-16 text-center text-sm text-dark-400">검색된 결과가 없습니다.</td></tr>
              ) : filtered.map(w => (
                <tr key={w.id} className="hover:bg-dark-50 transition-colors cursor-pointer" onClick={() => openEdit(w)}>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(w.id)} onChange={() => toggleSelect(w.id)} className="rounded border-dark-300" />
                  </td>
                  <td className="px-3 py-2.5 font-medium text-dark-800">{w.name}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.resident_number || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.project || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.nationality || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.visa_status || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.job_type || '-'}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-dark-500">{w.work_date || '-'}</td>
                  <td className="px-3 py-2.5 text-right text-dark-700">{fmt(w.daily_wage)}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.bank || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.account_number || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.mobile_phone || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500">{w.phone || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-dark-500 max-w-[160px] truncate">{w.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
              <p className="text-base font-bold text-dark-900">{editingId ? '일용직 사원 수정' : '일용직 사원등록'}</p>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-dark-100"><X size={18} className="text-dark-500" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-dark-500 block mb-1">사원명 *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">주민(외국인)번호</label>
                <input type="text" value={form.resident_number} onChange={e => setForm(f => ({ ...f, resident_number: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">프로젝트</label>
                <input type="text" value={form.project} onChange={e => setForm(f => ({ ...f, project: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">국적</label>
                <input type="text" value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">체류자격</label>
                <input type="text" value={form.visa_status} onChange={e => setForm(f => ({ ...f, visa_status: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">직종</label>
                <input type="text" value={form.job_type} onChange={e => setForm(f => ({ ...f, job_type: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">근무일</label>
                <input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">일지급금</label>
                <input type="number" value={form.daily_wage} onChange={e => setForm(f => ({ ...f, daily_wage: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">은행</label>
                <input type="text" value={form.bank} onChange={e => setForm(f => ({ ...f, bank: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">계좌번호</label>
                <input type="text" value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">휴대전화</label>
                <input type="text" value={form.mobile_phone} onChange={e => setForm(f => ({ ...f, mobile_phone: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-dark-500 block mb-1">전화번호</label>
                <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-dark-500 block mb-1">비고</label>
                <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={3} className="w-full px-2 py-1.5 text-sm border border-dark-200 rounded-lg resize-none" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-dark-100">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-dark-600 border border-dark-200 rounded-lg hover:bg-dark-50">취소</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

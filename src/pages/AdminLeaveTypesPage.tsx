import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface LeaveType {
  id: string
  name: string
  consumes_annual: boolean
  annual_days: number
  absence_days: number
  sort_order: number
  is_active: boolean
}

interface FormState {
  name: string
  consumes_annual: boolean
  annual_days: string
  absence_days: string
  sort_order: string
  is_active: boolean
}

const defaultForm: FormState = {
  name: '',
  consumes_annual: false,
  annual_days: '0',
  absence_days: '0',
  sort_order: '0',
  is_active: true,
}

export function AdminLeaveTypesPage() {
  const [types, setTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingType, setEditingType] = useState<LeaveType | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchTypes()
  }, [])

  async function fetchTypes() {
    setLoading(true)
    const { data, error } = await supabase
      .from('leave_types')
      .select('*')
      .order('sort_order')

    if (!error && data) {
      setTypes(data as LeaveType[])
    }
    setLoading(false)
  }

  function openCreate() {
    setEditingType(null)
    setForm(defaultForm)
    setShowModal(true)
  }

  function openEdit(type: LeaveType) {
    setEditingType(type)
    setForm({
      name: type.name,
      consumes_annual: type.consumes_annual,
      annual_days: String(type.annual_days),
      absence_days: String(type.absence_days),
      sort_order: String(type.sort_order),
      is_active: type.is_active,
    })
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingType(null)
    setForm(defaultForm)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      consumes_annual: form.consumes_annual,
      annual_days: parseFloat(form.annual_days) || 0,
      absence_days: parseFloat(form.absence_days) || 0,
      sort_order: parseInt(form.sort_order) || 0,
      is_active: form.is_active,
    }

    if (editingType) {
      const { error } = await supabase
        .from('leave_types')
        .update(payload)
        .eq('id', editingType.id)

      if (!error) {
        setTypes((prev) =>
          prev.map((t) => (t.id === editingType.id ? { ...t, ...payload } : t))
        )
        closeModal()
      }
    } else {
      const { data, error } = await supabase
        .from('leave_types')
        .insert(payload)
        .select()
        .single()

      if (!error && data) {
        setTypes((prev) => [...prev, data as LeaveType])
        closeModal()
      }
    }

    setSaving(false)
  }

  async function handleDelete(type: LeaveType) {
    if (!window.confirm(`"${type.name}" 휴가 종류를 삭제하시겠습니까?`)) return

    const { error } = await supabase
      .from('leave_types')
      .delete()
      .eq('id', type.id)

    if (!error) {
      setTypes((prev) => prev.filter((t) => t.id !== type.id))
    }
  }

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">휴가 종류 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">휴가 종류를 추가, 수정, 삭제합니다</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors"
        >
          <Plus size={16} />
          새로 만들기
        </button>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-center text-sm text-gray-400 py-10">불러오는 중...</p>
        ) : types.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            등록된 휴가 종류가 없습니다. 새로 만들기를 눌러 추가해주세요.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">이름</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">연차 소비</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">연차소진일</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">부재일</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">순서</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">상태</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {types.map((type) => (
                <tr key={type.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-gray-900">{type.name}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {type.consumes_annual ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                        O
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                        X
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-sm text-gray-700">
                    {type.annual_days}
                  </td>
                  <td className="px-3 py-3 text-center text-sm text-gray-700">
                    {type.absence_days}
                  </td>
                  <td className="px-3 py-3 text-center text-sm text-gray-500">
                    {type.sort_order}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {type.is_active ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                        활성
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-400">
                        비활성
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => openEdit(type)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        title="수정"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(type)}
                        className="p-1.5 text-gray-400 hover:text-danger-600 hover:bg-danger-50 rounded-lg transition-colors"
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
        )}
      </div>

      {/* 생성/수정 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-gray-900">
                {editingType ? '휴가 종류 수정' : '새 휴가 종류'}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {/* 폼 */}
            <div className="space-y-4">
              {/* 이름 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  이름 <span className="text-danger-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="예: 연차, 반차, 특별휴가"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>

              {/* 연차 소비 토글 */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-600">연차 소비</p>
                  <p className="text-xs text-gray-400 mt-0.5">이 휴가가 연차를 차감하는지 여부</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, consumes_annual: !p.consumes_annual }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    form.consumes_annual ? 'bg-primary-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      form.consumes_annual ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 연차소진일 / 부재일 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">연차소진일</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={form.annual_days}
                    onChange={(e) => setForm((p) => ({ ...p, annual_days: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">부재일</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={form.absence_days}
                    onChange={(e) => setForm((p) => ({ ...p, absence_days: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                  />
                </div>
              </div>

              {/* 정렬 순서 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">정렬 순서</label>
                <input
                  type="number"
                  min="0"
                  value={form.sort_order}
                  onChange={(e) => setForm((p) => ({ ...p, sort_order: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>

              {/* 활성 상태 토글 */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-600">활성 상태</p>
                  <p className="text-xs text-gray-400 mt-0.5">비활성 시 휴가 신청 목록에서 제외</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, is_active: !p.is_active }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    form.is_active ? 'bg-primary-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      form.is_active ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* 버튼 */}
            <div className="flex gap-2 mt-5">
              <button
                onClick={closeModal}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || saving}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors"
              >
                {saving ? '저장 중...' : editingType ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

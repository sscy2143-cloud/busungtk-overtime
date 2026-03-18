import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, X, Megaphone, Paperclip, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'

interface Notice {
  id: string
  title: string
  category: string
  content: string
  is_active: boolean
  created_at: string
  file_path: string | null
  file_name: string | null
}

const CATEGORIES = ['공지', '업데이트', '긴급'] as const

// 에디터 툴바
function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null

  const btnClass = (active: boolean) =>
    `px-2 py-1 text-xs rounded transition-colors ${
      active ? 'bg-primary-100 text-primary-700 font-bold' : 'text-gray-500 hover:bg-gray-100'
    }`

  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200 px-3 py-2 bg-gray-50 rounded-t-xl">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btnClass(editor.isActive('bold'))} title="굵게">
        <strong>B</strong>
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btnClass(editor.isActive('italic'))} title="기울임">
        <em>I</em>
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btnClass(editor.isActive('underline'))} title="밑줄">
        <u>U</u>
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={btnClass(editor.isActive('strike'))} title="취소선">
        <s>S</s>
      </button>

      <div className="w-px h-5 bg-gray-200 mx-1 self-center" />

      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btnClass(editor.isActive('heading', { level: 2 }))} title="제목">
        H2
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btnClass(editor.isActive('heading', { level: 3 }))} title="소제목">
        H3
      </button>

      <div className="w-px h-5 bg-gray-200 mx-1 self-center" />

      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btnClass(editor.isActive('bulletList'))} title="글머리 기호">
        • 목록
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btnClass(editor.isActive('orderedList'))} title="번호 목록">
        1. 목록
      </button>

      <div className="w-px h-5 bg-gray-200 mx-1 self-center" />

      <button type="button" onClick={() => editor.chain().focus().setTextAlign('left').run()} className={btnClass(editor.isActive({ textAlign: 'left' }))} title="왼쪽 정렬">
        ≡←
      </button>
      <button type="button" onClick={() => editor.chain().focus().setTextAlign('center').run()} className={btnClass(editor.isActive({ textAlign: 'center' }))} title="가운데 정렬">
        ≡↔
      </button>
      <button type="button" onClick={() => editor.chain().focus().setTextAlign('right').run()} className={btnClass(editor.isActive({ textAlign: 'right' }))} title="오른쪽 정렬">
        →≡
      </button>

      <div className="w-px h-5 bg-gray-200 mx-1 self-center" />

      {/* 글자 색상 */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-400">색:</span>
        {['#000000', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6'].map(color => (
          <button
            key={color}
            type="button"
            onClick={() => editor.chain().focus().setColor(color).run()}
            className="w-5 h-5 rounded border border-gray-200 hover:scale-110 transition-transform"
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
        <button
          type="button"
          onClick={() => editor.chain().focus().unsetColor().run()}
          className="text-xs text-gray-400 hover:text-gray-600 px-1"
          title="색상 초기화"
        >
          ✕
        </button>
      </div>

      <div className="w-px h-5 bg-gray-200 mx-1 self-center" />

      <button
        type="button"
        onClick={() => {
          const url = window.prompt('링크 URL을 입력하세요')
          if (url) editor.chain().focus().setLink({ href: url }).run()
        }}
        className={btnClass(editor.isActive('link'))}
        title="링크"
      >
        🔗
      </button>
      {editor.isActive('link') && (
        <button
          type="button"
          onClick={() => editor.chain().focus().unsetLink().run()}
          className="text-xs text-red-400 hover:text-red-600 px-1"
          title="링크 제거"
        >
          링크해제
        </button>
      )}

      <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btnClass(editor.isActive('blockquote'))} title="인용">
        " 인용
      </button>
      <button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()} className={btnClass(false)} title="구분선">
        ―
      </button>
    </div>
  )
}

export function AdminNoticePage() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formCategory, setFormCategory] = useState<string>('공지')
  const [formFile, setFormFile] = useState<File | null>(null)
  const [existingFile, setExistingFile] = useState<{ path: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false }),
      Image,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none px-4 py-3 min-h-[200px] focus:outline-none',
      },
    },
  })

  useEffect(() => { fetchNotices() }, [])

  async function fetchNotices() {
    const { data } = await supabase
      .from('notices')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setNotices(data)
    setLoading(false)
  }

  function openNew() {
    setEditId(null)
    setFormTitle('')
    setFormCategory('공지')
    setFormFile(null)
    setExistingFile(null)
    editor?.commands.setContent('')
    setShowModal(true)
  }

  function openEdit(notice: Notice) {
    setEditId(notice.id)
    setFormTitle(notice.title)
    setFormCategory(notice.category)
    setFormFile(null)
    setExistingFile(notice.file_path ? { path: notice.file_path, name: notice.file_name ?? '' } : null)
    editor?.commands.setContent(notice.content ?? '')
    setShowModal(true)
  }

  // 에디터에 이미지 삽입
  const handleImageInsert = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file || !editor) return

      const path = `notices/images/${Date.now()}_${file.name}`
      const { error } = await supabase.storage.from('payslips').upload(path, file, { upsert: true })
      if (error) {
        alert('이미지 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      const { data } = supabase.storage.from('payslips').getPublicUrl(path)
      if (data?.publicUrl) {
        editor.chain().focus().setImage({ src: data.publicUrl }).run()
      }
    }
    input.click()
  }, [editor])

  async function handleSave() {
    if (!formTitle.trim()) return
    setSaving(true)
    try {
      let filePath = existingFile?.path ?? null
      let fileName = existingFile?.name ?? null

      // 파일 업로드
      if (formFile) {
        const path = `notices/files/${Date.now()}_${formFile.name}`
        const { error } = await supabase.storage.from('payslips').upload(path, formFile, { upsert: true })
        if (error) throw error
        filePath = path
        fileName = formFile.name
      }

      const content = editor?.getHTML() ?? ''

      if (editId) {
        await supabase.from('notices').update({
          title: formTitle.trim(),
          category: formCategory,
          content,
          file_path: filePath,
          file_name: fileName,
        }).eq('id', editId)
      } else {
        await supabase.from('notices').insert({
          title: formTitle.trim(),
          category: formCategory,
          content,
          is_active: true,
          file_path: filePath,
          file_name: fileName,
        })
      }
      setShowModal(false)
      fetchNotices()
    } catch (err: any) {
      alert('저장에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(notice: Notice) {
    await supabase.from('notices').update({ is_active: !notice.is_active }).eq('id', notice.id)
    fetchNotices()
  }

  async function handleDelete(notice: Notice) {
    if (!confirm(`"${notice.title}" 공지를 삭제하시겠습니까?`)) return
    if (notice.file_path) {
      await supabase.storage.from('payslips').remove([notice.file_path])
    }
    await supabase.from('notices').delete().eq('id', notice.id)
    fetchNotices()
  }

  async function handleDownloadFile(notice: Notice) {
    if (!notice.file_path) return
    const { data } = await supabase.storage.from('payslips').createSignedUrl(notice.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const categoryBadge = (cat: string) => {
    const cls = cat === '업데이트' ? 'bg-blue-50 text-blue-600'
      : cat === '공지' ? 'bg-amber-50 text-amber-600'
      : 'bg-red-50 text-red-500'
    return `inline-flex text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-bold text-gray-900">공지사항 관리</h1>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus size={16} />
          공지 등록
        </button>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-gray-400">불러오는 중...</p>
        </div>
      ) : notices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <Megaphone className="w-8 h-8 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">등록된 공지사항이 없습니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">분류</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">제목</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400">첨부</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400">상태</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400">등록일</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {notices.map(notice => (
                  <tr key={notice.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={categoryBadge(notice.category)}>{notice.category}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(notice)}
                        className="text-sm font-medium text-gray-800 hover:text-primary-600 text-left"
                      >
                        {notice.title}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {notice.file_path ? (
                        <button
                          onClick={() => handleDownloadFile(notice)}
                          className="text-primary-600 hover:text-primary-700"
                          title={notice.file_name ?? '첨부파일'}
                        >
                          <Paperclip size={14} />
                        </button>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleActive(notice)}
                        className={`text-xs font-medium px-2 py-1 rounded-full transition-colors ${
                          notice.is_active
                            ? 'bg-green-50 text-green-600 hover:bg-green-100'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                        }`}
                      >
                        {notice.is_active ? '게시중' : '숨김'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-400">
                      {new Date(notice.created_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => handleDelete(notice)}
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

      {/* 등록/수정 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-2xl p-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">
                {editId ? '공지 수정' : '공지 등록'}
              </h3>
              <button onClick={() => setShowModal(false)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              {/* 분류 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  분류 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setFormCategory(cat)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        formCategory === cat
                          ? 'border-primary-400 bg-primary-50 text-primary-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* 제목 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  제목 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="공지 제목을 입력하세요"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>

              {/* 리치 텍스트 에디터 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-gray-600">내용</label>
                  <button
                    type="button"
                    onClick={handleImageInsert}
                    className="text-xs text-primary-600 hover:underline"
                  >
                    이미지 삽입
                  </button>
                </div>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <EditorToolbar editor={editor} />
                  <EditorContent editor={editor} />
                </div>
              </div>

              {/* 첨부파일 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  첨부파일 <span className="text-gray-400 font-normal">(선택)</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  onChange={e => {
                    setFormFile(e.target.files?.[0] ?? null)
                    setExistingFile(null)
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className={`flex items-center gap-2 w-full px-3 py-2.5 text-sm border border-dashed rounded-xl transition-colors text-left ${
                    formFile || existingFile
                      ? 'border-primary-400 text-primary-700 bg-primary-50'
                      : 'border-gray-300 text-gray-400 hover:border-primary-400'
                  }`}
                >
                  <Paperclip size={14} />
                  {formFile ? formFile.name : existingFile ? existingFile.name : '파일을 선택하세요'}
                </button>
                {(formFile || existingFile) && (
                  <button
                    type="button"
                    onClick={() => { setFormFile(null); setExistingFile(null) }}
                    className="text-xs text-red-400 hover:text-red-600 mt-1"
                  >
                    첨부파일 제거
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!formTitle.trim() || saving}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors"
              >
                {saving ? '저장 중...' : editId ? '수정' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

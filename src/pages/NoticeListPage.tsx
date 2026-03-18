import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Paperclip, Download, X } from 'lucide-react'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabase'

const ALLOWED_TAGS = ['h1','h2','h3','h4','h5','h6','p','br','strong','b','em','i','u','s','ul','ol','li','a','img','blockquote','pre','code','hr','table','thead','tbody','tr','th','td','span','div','sup','sub']
const ALLOWED_ATTR = ['href','src','alt','title','class','target','rel','width','height','colspan','rowspan']

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
}

interface Notice {
  id: string
  title: string
  category: string
  content: string
  file_path: string | null
  file_name: string | null
  created_at: string
}

export function NoticeListPage() {
  const navigate = useNavigate()
  const [notices, setNotices] = useState<Notice[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Notice | null>(null)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('notices')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
      if (data) setNotices(data)
      setLoading(false)
    }
    fetch()
  }, [])

  const categoryBadge = (cat: string) => {
    const cls = cat === '업데이트' ? 'bg-blue-50 text-blue-600'
      : cat === '공지' ? 'bg-amber-50 text-amber-600'
      : 'bg-red-50 text-red-500'
    return `inline-flex text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`
  }

  async function handleDownload(notice: Notice) {
    if (!notice.file_path) return
    const { data } = await supabase.storage.from('payslips').createSignedUrl(notice.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronLeft size={20} className="text-gray-500" />
        </button>
        <h1 className="text-xl font-bold text-gray-900">공지사항</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-gray-400">불러오는 중...</p>
        </div>
      ) : notices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <p className="text-sm text-gray-400">등록된 공지사항이 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 w-12">No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">분류</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">제목</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400">첨부</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400">등록일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {notices.map((notice, idx) => (
                <tr
                  key={notice.id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => setSelected(notice)}
                >
                  <td className="px-4 py-3 text-center text-xs text-gray-400">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <span className={categoryBadge(notice.category)}>{notice.category}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-800">{notice.title}</td>
                  <td className="px-4 py-3 text-center">
                    {notice.file_path ? <Paperclip size={14} className="text-gray-400 mx-auto" /> : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-400">
                    {new Date(notice.created_at).toLocaleDateString('ko-KR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 공지 상세 팝업 */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className={categoryBadge(selected.category)}>{selected.category}</span>
                <h3 className="text-base font-bold text-gray-900">{selected.title}</h3>
              </div>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} className="text-gray-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="text-xs text-gray-400 mb-4">
                {new Date(selected.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              {selected.content ? (
                <div
                  className="prose prose-sm max-w-none text-gray-700"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.content) }}
                />
              ) : (
                <p className="text-sm text-gray-400">내용이 없습니다.</p>
              )}
              {selected.file_path && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => handleDownload(selected)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                  >
                    <Download size={14} />
                    {selected.file_name ?? '첨부파일 다운로드'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

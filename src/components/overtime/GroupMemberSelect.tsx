import { useState } from 'react'
import { Search, X, Check } from 'lucide-react'

interface Employee {
  id: string
  name: string
  department: string
}

interface GroupMemberSelectProps {
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  employees?: Employee[]
}

export function GroupMemberSelect({
  selectedIds,
  onSelect,
  employees = [],
}: GroupMemberSelectProps) {
  const [query, setQuery] = useState('')

  const filtered = employees.filter(
    (e) =>
      e.name.includes(query) || e.department.includes(query),
  )

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onSelect(selectedIds.filter((s) => s !== id))
    } else {
      onSelect([...selectedIds, id])
    }
  }

  function remove(id: string) {
    onSelect(selectedIds.filter((s) => s !== id))
  }

  const selectedEmployees = employees.filter((e) => selectedIds.includes(e.id))

  return (
    <div className="space-y-3">
      {/* 선택된 직원 칩 */}
      {selectedEmployees.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedEmployees.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary-50 text-primary-700 text-sm rounded-full border border-primary-200"
            >
              <span className="w-5 h-5 rounded-full bg-primary-200 flex items-center justify-center text-xs font-bold text-primary-700">
                {e.name[0]}
              </span>
              {e.name}
              <button
                type="button"
                onClick={() => remove(e.id)}
                className="text-primary-400 hover:text-primary-700"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 검색 입력 */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 또는 부서 검색"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
        />
      </div>

      {/* 직원 목록 */}
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400 text-center">검색 결과가 없습니다</p>
        ) : (
          filtered.map((e) => {
            const selected = selectedIds.includes(e.id)
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => toggle(e.id)}
                className={`flex items-center gap-3 w-full px-4 py-3 text-left transition-colors ${
                  selected ? 'bg-primary-50' : 'bg-white hover:bg-gray-50'
                }`}
              >
                {/* 아바타 */}
                <span className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
                  {e.name[0]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{e.name}</p>
                  <p className="text-xs text-gray-400">{e.department}</p>
                </div>
                {selected && (
                  <Check size={16} className="text-primary-600 shrink-0" />
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

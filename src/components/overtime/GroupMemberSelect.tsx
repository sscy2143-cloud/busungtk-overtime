import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, Check } from 'lucide-react'

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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

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

      {/* 드롭다운 */}
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm border border-dark-200 rounded-xl bg-dark-50 hover:bg-dark-100 transition-colors"
        >
          <span className={selectedIds.length > 0 ? 'text-dark-800' : 'text-dark-400'}>
            {selectedIds.length > 0 ? `${selectedIds.length}명 선택됨` : '직원 선택'}
          </span>
          <ChevronDown
            size={16}
            className={`text-dark-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-dark-200 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
            {employees.length === 0 ? (
              <p className="px-4 py-3 text-sm text-dark-400 text-center">직원 정보를 불러올 수 없습니다</p>
            ) : (
              employees.map((e) => {
                const selected = selectedIds.includes(e.id)
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(e.id)}
                    className={`flex items-center gap-3 w-full px-4 py-3 text-left transition-colors border-b border-dark-100 last:border-0 ${
                      selected ? 'bg-primary-50' : 'bg-white hover:bg-dark-50'
                    }`}
                  >
                    <span className="w-8 h-8 rounded-full bg-dark-200 flex items-center justify-center text-sm font-bold text-dark-600 shrink-0">
                      {e.name[0]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark-800">{e.name}</p>
                      <p className="text-xs text-dark-400">{e.department}</p>
                    </div>
                    {selected && <Check size={16} className="text-primary-600 shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}

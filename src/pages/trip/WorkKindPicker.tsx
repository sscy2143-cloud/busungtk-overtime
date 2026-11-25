import { Building2, HardHat, Plane } from 'lucide-react'
import type { WorkKind } from './trip-glue'

/**
 * 연장근무 신청 화면 맨 위의 근무 장소 선택 (2026-11-25).
 *  - 사무실·외부 현장: 기존 야근 양식 그대로 (외부 현장은 출장수당 대상이 아니다)
 *  - 출장: 출장수당 양식 (지역별 표준 이동시간 자동 계산)
 * 출장 코드 스위치가 꺼져 있으면 이 선택 자체를 그리지 않는다 (RequestPage 에서 판단).
 */

const OPTIONS: { kind: WorkKind; label: string; icon: typeof Plane }[] = [
  { kind: 'office', label: '사무실', icon: Building2 },
  { kind: 'field', label: '외부 현장', icon: HardHat },
  { kind: 'trip', label: '출장', icon: Plane },
]

const GUIDE: Record<WorkKind, string> = {
  office: '사무실에서 한 야근·잔업을 신청합니다.',
  field: '외부 현장 근무는 출장수당 대상이 아닙니다. 야근·잔업 시간만 신청합니다.',
  trip: '출장수당 대상 출장입니다. 지역과 현장 시각만 넣으면 이동시간·출장시간이 자동으로 계산됩니다.',
}

export function WorkKindPicker({ value, onChange }: { value: WorkKind; onChange: (k: WorkKind) => void }) {
  return (
    <div className="mb-6" data-testid="work-kind-picker">
      <p className="mb-2 text-sm font-semibold text-dark-700">어디서 일했나요?</p>
      <div role="radiogroup" aria-label="근무 장소" className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ kind, label, icon: Icon }) => {
          const on = value === kind
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(kind)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-medium transition-colors ${
                on ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-dark-200 bg-white text-dark-600 hover:border-primary-300'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-dark-500">{GUIDE[value]}</p>
    </div>
  )
}

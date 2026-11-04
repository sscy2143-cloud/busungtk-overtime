import { X } from 'lucide-react'
import { REGIONS } from '../engine'
import { Button, Field, inputClass } from './parts'
import { regionLabel } from './helpers'

const GROUPS: { label: string; match: (code: string) => boolean }[] = [
  { label: '서울·인천·경기 (근거리)', match: (c) => REGIONS[c].kind === 'excluded' },
  { label: '편도 1시간', match: (c) => REGIONS[c].kind === 'standard' && REGIONS[c].oneWayHours === 1 },
  { label: '편도 2시간', match: (c) => REGIONS[c].kind === 'standard' && REGIONS[c].oneWayHours === 2 },
  { label: '편도 3시간', match: (c) => REGIONS[c].kind === 'standard' && REGIONS[c].oneWayHours === 3 },
  { label: '편도 4시간', match: (c) => REGIONS[c].kind === 'standard' && REGIONS[c].oneWayHours === 4 },
  { label: '제주 (실제 시각·증빙)', match: (c) => REGIONS[c].kind === 'jeju' },
]
const CODES = Object.keys(REGIONS)

/** 방문 순서대로 고른다. 여러 지역이면 첫 지역·마지막 지역 표준시간을 쓴다 (5-8) */
export function RegionPicker({ value, onChange, label = '지역 (방문 순서)' }: { value: string[]; onChange: (regions: string[]) => void; label?: string }) {
  return (
    <div className="space-y-2">
      <Field label={label} hint={value.length > 1 ? '여러 지역: 첫 지역과 마지막 지역의 표준 이동시간을 씁니다' : undefined}>
        <select
          className={inputClass}
          value=""
          onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]) }}
        >
          <option value="">{value.length === 0 ? '지역을 고르세요' : '지역 추가 (경유·다음 현장)'}</option>
          {GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {CODES.filter(g.match).map((c) => <option key={c} value={c}>{regionLabel(c)}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      {value.length > 0 && (
        <ol className="flex flex-wrap gap-2">
          {value.map((c, i) => (
            <li key={`${c}-${i}`} className="flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-sm text-primary-800">
              <span>{i + 1}. {regionLabel(c)}</span>
              <Button kind="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={14} aria-label="지역 빼기" /></Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

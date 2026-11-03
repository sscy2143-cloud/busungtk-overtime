import { formSections, visibleSections, type FormSection, type SectionKey } from '../ui'
import type { ClaimHeader, Classification, DayEntry } from '../data'
import { Field, TimeRange, inputClass } from './parts'
import { RegionPicker } from './RegionPicker'

interface Props {
  header: ClaimHeader
  entry: DayEntry
  classification: Classification
  onPatch: (patch: Partial<DayEntry>) => void
}

const SECTION_TITLE: Record<SectionKey, string> = {
  regions: '이날만 다른 지역',
  schedule: '일정',
  site: '현장 작업',
  lunch: '점심',
  office: '사무실 근무 (현장 전후)',
  noSiteWork: '현장 작업 없음 (이동만)',
  travelStarts: '이동 출발 시각',
  breaks: '점심 외 휴게',
  directedWaits: '회사 지시 대기',
  jeju: '제주 실제 이동·증빙',
  assembly: '사무실 집결 지시',
  delay: '경유·지연',
  actual: '실제 출발·도착 (기록용)',
}

/**
 * 하루 입력. 기본은 현장 시작·종료와 점심뿐이고, 나머지는 분류 결과가 요구하거나 권할 때 펼친다.
 * 선택 항목은 "추가 상황" 안에 접어 둔다.
 */
export function DayEntryEditor({ header, entry, classification, onPatch }: Props) {
  const cls = { ...classification }
  const sections = formSections(header, entry, cls)
  const shown = visibleSections(sections).filter((s) => s.key !== 'regions' && s.key !== 'schedule')
  const optional = sections.filter((s) => s.mode === 'optional')
  const shownKeys = new Set(shown.map((s) => s.key))

  const render = (s: FormSection) => {
    const badge = s.mode === 'required' ? <span className="ml-2 text-xs text-red-700">필수</span>
      : s.mode === 'suggested' ? <span className="ml-2 text-xs text-amber-700">확인</span> : null
    const title = <span>{SECTION_TITLE[s.key]}{badge}</span>
    const body = sectionBody(s.key, entry, onPatch, header)
    if (!body) return null
    return (
      <div key={s.key} className="space-y-2">
        <p className="text-sm font-medium text-dark-700">{title}</p>
        {s.reason && <p className="text-xs text-dark-500">{s.reason}</p>}
        {body}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {shown.map(render)}
      {optional.length > 0 && (
        <details className="rounded-lg border border-dashed border-dark-300 p-3">
          <summary className="cursor-pointer text-sm text-dark-600">추가 상황 (해당할 때만)</summary>
          <div className="mt-3 space-y-4">
            {optional.filter((s) => !shownKeys.has(s.key)).map(render)}
            <div className="space-y-2">
              <p className="text-sm font-medium text-dark-700">{SECTION_TITLE.regions}</p>
              <RegionPicker label="이날 방문 지역 (비우면 출장 공통 지역)" value={entry.regions ?? []} onChange={(r) => onPatch({ regions: r.length ? r : undefined })} />
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

function sectionBody(key: SectionKey, entry: DayEntry, onPatch: (p: Partial<DayEntry>) => void, header: ClaimHeader) {
  void header
  switch (key) {
    case 'site':
      return <TimeRange value={entry.site} onChange={(site) => onPatch({ site })} labelStart="현장 시작" labelEnd="현장 종료" />
    case 'lunch':
      return (
        <label className="flex min-h-11 items-center gap-2 text-sm text-dark-800">
          <input type="checkbox" className="h-5 w-5" checked={entry.lunchTaken ?? true} onChange={(e) => onPatch({ lunchTaken: e.target.checked ? undefined : false })} />
          점심시간(1시간)을 썼습니다
        </label>
      )
    case 'office':
      return <TimeRange value={entry.office} onChange={(office) => onPatch({ office })} labelStart="사무실 시작" labelEnd="사무실 종료" />
    case 'noSiteWork':
      return (
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm text-dark-800">
            <input type="checkbox" className="h-5 w-5" checked={entry.noSiteWork !== undefined} onChange={(e) => onPatch({ noSiteWork: e.target.checked ? { reason: entry.noSiteWork?.reason ?? '' } : undefined })} />
            이날 현장 작업을 하지 않았습니다 (이동만·작업 취소)
          </label>
          {entry.noSiteWork && (
            <Field label="사유"><input className={inputClass} value={entry.noSiteWork.reason} onChange={(e) => onPatch({ noSiteWork: { reason: e.target.value } })} placeholder="예: 고객 사정으로 작업 취소" /></Field>
          )}
        </div>
      )
    case 'travelStarts':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="출발 (사무실→현장)" hint="비우면 표준 위치로 계산"><input type="time" className={inputClass} value={entry.travelStarts?.out ?? ''} onChange={(e) => onPatch({ travelStarts: clean({ ...entry.travelStarts, out: e.target.value || undefined }) })} /></Field>
          <Field label="복귀 출발 (현장→)"><input type="time" className={inputClass} value={entry.travelStarts?.back ?? ''} onChange={(e) => onPatch({ travelStarts: clean({ ...entry.travelStarts, back: e.target.value || undefined }) })} /></Field>
        </div>
      )
    case 'breaks':
      return <RangeList label="휴게" value={entry.breaks ?? []} onChange={(breaks) => onPatch({ breaks: breaks.length ? breaks : undefined })} />
    case 'directedWaits':
      return <RangeList label="대기" value={entry.directedWaits ?? []} onChange={(directedWaits) => onPatch({ directedWaits: directedWaits.length ? directedWaits : undefined })} />
    case 'jeju':
      return (
        <div className="space-y-2">
          <RangeList label="실제 이동 구간" value={entry.jeju?.legs ?? []} onChange={(legs) => onPatch({ jeju: { legs, evidenceFileIds: entry.jeju?.evidenceFileIds ?? [] } })} />
          <label className="flex min-h-11 items-center gap-2 text-sm text-dark-800">
            <input type="checkbox" className="h-5 w-5" checked={(entry.jeju?.evidenceFileIds.length ?? 0) > 0} onChange={(e) => onPatch({ jeju: { legs: entry.jeju?.legs ?? [], evidenceFileIds: e.target.checked ? ['pending-upload'] : [] } })} />
            항공권 등 증빙을 첨부했습니다 (첨부 기능은 실제 연결 단계)
          </label>
        </div>
      )
    case 'assembly':
      return <Field label="집결 시각" hint="회사가 사무실 집결을 지시한 날만"><input type="time" className={inputClass} value={entry.assemblyAt ?? ''} onChange={(e) => onPatch({ assemblyAt: e.target.value || undefined })} /></Field>
    case 'delay':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="추가 시간"><input type="number" min={0} step={0.5} className={inputClass} value={entry.delay?.hours ?? ''} onChange={(e) => onPatch({ delay: e.target.value ? { hours: Number(e.target.value), evidenceFileIds: entry.delay?.evidenceFileIds ?? [] } : undefined })} /></Field>
          <label className="flex min-h-11 items-end gap-2 pb-2 text-sm text-dark-800">
            <input type="checkbox" className="h-5 w-5" checked={(entry.delay?.evidenceFileIds.length ?? 0) > 0} disabled={!entry.delay} onChange={(e) => entry.delay && onPatch({ delay: { hours: entry.delay.hours, evidenceFileIds: e.target.checked ? ['pending-upload'] : [] } })} />
            증빙 있음
          </label>
        </div>
      )
    case 'actual':
      return (
        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-2">
            <Field label="실제 출발"><input type="time" className={inputClass} value={entry.actual?.departAt ?? ''} onChange={(e) => onPatch({ actual: actualPatch(entry, { departAt: e.target.value || undefined }) })} /></Field>
            <Field label="실제 도착"><input type="time" className={inputClass} value={entry.actual?.arriveAt ?? ''} onChange={(e) => onPatch({ actual: actualPatch(entry, { arriveAt: e.target.value || undefined }) })} /></Field>
          </div>
          {entry.actual?.arriveAt && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-dark-800">
              <input type="checkbox" className="h-5 w-5" checked={entry.actual.arriveNextDay ?? false} onChange={(e) => onPatch({ actual: actualPatch(entry, { arriveNextDay: e.target.checked || undefined }) })} />
              도착이 다음 날(자정 이후)입니다
            </label>
          )}
          <p className="text-xs text-dark-500">기록만 하고 계산에는 쓰지 않습니다. 기억나지 않으면 비워 두세요 — 표준시간을 대신 넣지 않습니다</p>
        </div>
      )
    default:
      return null
  }
}

function clean(v: { out?: string; back?: string }): DayEntry['travelStarts'] {
  const o = { ...(v.out ? { out: v.out } : {}), ...(v.back ? { back: v.back } : {}) }
  return Object.keys(o).length ? o : undefined
}

function actualPatch(entry: DayEntry, patch: { departAt?: string; arriveAt?: string; arriveNextDay?: boolean }): DayEntry['actual'] {
  const next = { ...(entry.actual ?? { source: 'self' as const }), ...patch }
  if (!next.departAt) delete next.departAt
  if (!next.arriveAt) { delete next.arriveAt; delete next.arriveNextDay }
  if (!next.arriveNextDay) delete next.arriveNextDay
  return next.departAt || next.arriveAt ? next : undefined
}

function RangeList({ label, value, onChange }: { label: string; value: { start: string; end: string }[]; onChange: (v: { start: string; end: string }[]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((r, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1"><TimeRange value={r} onChange={(v) => onChange(value.map((x, j) => (j === i ? (v ?? { start: '', end: '' }) : x)))} /></div>
          <button type="button" className="min-h-11 px-2 text-sm text-dark-500" onClick={() => onChange(value.filter((_, j) => j !== i))}>빼기</button>
        </div>
      ))}
      <button type="button" className="min-h-11 text-sm text-primary-700" onClick={() => onChange([...value, { start: '', end: '' }])}>+ {label} 추가</button>
    </div>
  )
}

import { useReducer, useState } from 'react'
import { dayKindOf, weekdayOf, type DayEntry, type Schedule } from '../data'
import {
  DAY_KIND_LABEL, buildDayPreview, formReducer, initialFormState, previewDays, submitBlockers, type TripFormState,
} from '../ui'
import { useTrip } from './context'
import { Button, Card, ErrorBanner, Field, NoticeList, inputClass } from './parts'
import { RegionPicker } from './RegionPicker'
import { DayEntryEditor } from './DayEntryEditor'
import { DayPreviewCard } from './DayPreviewCard'
import { CompanionInvite } from './CompanionInvite'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

interface Props {
  /** 기존 신청을 다시 열 때 */
  claimId?: string
  onSubmitted?: () => void
  onBack?: () => void
}

/**
 * 출장 신청 화면 (T3). 입력 → 미리보기(저장 전, 같은 계산) → 저장 → 제출.
 * 근무 유형은 고르지 않는다. 지역·일정·현장 시각·점심만 기본 입력이다.
 */
export function TripClaimForm({ claimId, onSubmitted, onBack }: Props) {
  const { service, actor, calendar, today, bump } = useTrip()
  const [state, dispatch] = useReducer(formReducer, claimId, (id): TripFormState => {
    if (!id) return initialFormState(today)
    const r = service.myClaim(actor, id)
    if (!r.ok) return { ...initialFormState(today), error: { code: r.code, message: r.message } }
    return formReducer(initialFormState(today), { type: 'loaded', claim: r.value.claim, entries: r.value.days.map((d) => d.entry) })
  })
  const [submittedNote, setSubmittedNote] = useState<string | null>(null)

  const computed = previewDays(state, calendar)
  const blockers = submitBlockers(state, computed)
  const editable = !state.saved || state.saved.status === 'draft' || state.saved.status === 'returned'
  const weekResult = state.saved ? service.weeklyCheck(actor, state.entries[0].date) : null
  const week = weekResult?.ok ? weekResult.value : null

  const reload = () => {
    if (!state.saved) { dispatch({ type: 'clearError' }); return }
    const r = service.myClaim(actor, state.saved.id)
    if (r.ok) dispatch({ type: 'loaded', claim: r.value.claim, entries: r.value.days.map((d) => d.entry) })
    else dispatch({ type: 'failed', code: r.code, message: r.message })
  }

  const save = () => {
    const r = state.saved
      ? service.updateDraft(actor, state.saved.id, state.saved.version, { header: state.header, entries: state.entries })
      : service.createClaim(actor, { header: state.header, entries: state.entries })
    if (r.ok) { dispatch({ type: 'saved', claim: r.value }); bump() } else dispatch({ type: 'failed', code: r.code, message: r.message })
  }

  const submit = () => {
    if (!state.saved) return
    const r = service.submit(actor, state.saved.id, state.saved.version)
    if (r.ok) {
      dispatch({ type: 'saved', claim: r.value })
      setSubmittedNote('제출했습니다. 관리자가 검토한 뒤 승인·되돌림·반려 중 하나로 답합니다')
      bump()
      onSubmitted?.()
    } else dispatch({ type: 'failed', code: r.code, message: r.message })
  }

  const cancel = () => {
    if (!state.saved) return
    const r = service.cancel(actor, state.saved.id, state.saved.version)
    if (r.ok) { dispatch({ type: 'saved', claim: r.value }); bump() } else dispatch({ type: 'failed', code: r.code, message: r.message })
  }

  const setSchedule = (s: Schedule) => dispatch({ type: 'setSchedule', schedule: s })
  const sched = state.header.schedule

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-28 pt-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-dark-900">출장 신청</h2>
        {onBack && <Button kind="ghost" onClick={onBack}>목록</Button>}
      </header>
      {state.saved?.origin === 'companion_draft' && (
        <NoticeList items={['동행자가 보낸 초안입니다. 내용을 확인하고 점심·휴게 등 내 상황을 입력한 뒤 직접 제출하세요']} />
      )}
      {!calendar.verified && (
        <NoticeList tone="warn" items={['공휴일 달력이 검증되지 않아 평일·휴일 구분을 관리자가 확인합니다']} />
      )}

      <ErrorBanner error={state.error} onAction={(a) => (a === 'reload' ? reload() : undefined)} onDismiss={() => dispatch({ type: 'clearError' })} />
      {submittedNote && <NoticeList items={[submittedNote]} />}

      <Card title="어디로, 언제">
        <fieldset disabled={!editable} className="space-y-3">
          <RegionPicker value={state.header.regions} onChange={(regions) => dispatch({ type: 'setRegions', regions })} />
          <div className="flex gap-2">
            {(['day', 'stay'] as const).map((k) => (
              <label key={k} className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border text-sm ${sched.kind === k ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-dark-300 text-dark-700'}`}>
                <input
                  type="radio" name="schedule-kind" className="sr-only" checked={sched.kind === k}
                  onChange={() => setSchedule(k === 'day'
                    ? { kind: 'day', date: sched.kind === 'day' ? sched.date : sched.startDate }
                    : { kind: 'stay', startDate: sched.kind === 'day' ? sched.date : sched.startDate, endDate: sched.kind === 'day' ? sched.date : sched.endDate })}
                />
                {k === 'day' ? '당일 출장' : '숙박 출장'}
              </label>
            ))}
          </div>
          {sched.kind === 'day'
            ? <Field label="날짜"><input type="date" className={inputClass} value={sched.date} onChange={(e) => e.target.value && setSchedule({ kind: 'day', date: e.target.value })} /></Field>
            : (
              <div className="grid grid-cols-2 gap-2">
                <Field label="출발일"><input type="date" className={inputClass} value={sched.startDate} onChange={(e) => e.target.value && setSchedule({ ...sched, startDate: e.target.value })} /></Field>
                <Field label="복귀일"><input type="date" className={inputClass} value={sched.endDate} onChange={(e) => e.target.value && setSchedule({ ...sched, endDate: e.target.value })} /></Field>
              </div>
            )}
        </fieldset>
      </Card>

      {computed.map((c) => {
        const entry = c.entry
        const kind = dayKindOf(c.date, calendar.holidays)
        return (
          <Card key={c.date} title={<span>{c.date} ({WEEKDAY[weekdayOf(c.date)]}) <span className="font-normal text-dark-500">· {DAY_KIND_LABEL[kind]}</span></span>}>
            <fieldset disabled={!editable} className="space-y-4">
              <DayEntryEditor
                header={state.header} entry={entry}
                classification={{ ...c.classification, input: null }}
                onPatch={(patch: Partial<DayEntry>) => dispatch({ type: 'patchEntry', date: c.date, patch })}
              />
            </fieldset>
            <div className="mt-4 border-t border-dark-100 pt-3">
              <p className="mb-2 text-xs font-semibold text-dark-500">인정시간 미리보기 {state.dirty && state.saved ? '(저장 전 값)' : ''}</p>
              <DayPreviewCard preview={buildDayPreview({ classification: c.classification, result: c.result })} />
            </div>
          </Card>
        )
      })}

      {week && week.level !== 'ok' && (
        <NoticeList tone="warn" items={week.flags.map((f) => f.message)} />
      )}

      {state.saved && editable && <CompanionInvite claimId={state.saved.id} />}

      <div className="fixed inset-x-0 bottom-0 border-t border-dark-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          {blockers.length > 0 && state.saved && !state.dirty && (
            <p className="text-xs text-dark-500">{blockers.join(' · ')}</p>
          )}
          <div className="flex gap-2">
            {editable && <Button kind="secondary" onClick={save} disabled={state.saved ? !state.dirty : false}>{state.saved ? '저장' : '저장하고 계속'}</Button>}
            {editable && <Button onClick={submit} disabled={blockers.length > 0}>제출</Button>}
            {state.saved && ['draft', 'submitted', 'returned'].includes(state.saved.status) && <Button kind="danger" onClick={cancel}>신청 취소</Button>}
          </div>
        </div>
      </div>
    </div>
  )
}

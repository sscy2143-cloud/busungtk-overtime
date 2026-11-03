import { useState } from 'react'
import type { ClaimHeader, DayEntry, TripDayRecord } from '../../data'
import { computeDay } from '../../data'
import { useTrip } from '../context'
import { Button, ErrorBanner, Field, inputClass } from '../parts'
import { DayEntryEditor } from '../DayEntryEditor'

/** 관리자 입력값 수정. 사유 필수, 원본은 이력으로 남고 계산은 새로 만들어진다 */
export function AdjustDayForm({ claimId, header, day, onDone, onCancel }: {
  claimId: string
  header: ClaimHeader
  day: TripDayRecord
  onDone: () => void
  onCancel: () => void
}) {
  const { service, actor, calendar } = useTrip()
  const [entry, setEntry] = useState<DayEntry>(day.entry)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<{ code: string; message: string } | undefined>()
  const cls = computeDay(header, entry, { calendar }).classification

  const apply = async () => {
    const r = await service.adminAdjustDay(actor, claimId, day.id, day.revision, entry, reason)
    if (r.ok) onDone()
    else setError({ code: r.code, message: r.message })
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900">{day.date} 입력값 수정 (관리자)</p>
      <DayEntryEditor
        header={header} entry={entry} classification={{ ...cls, input: null }}
        onPatch={(patch) => setEntry((e) => {
          const next: Record<string, unknown> = { ...e }
          for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v }
          return { ...(next as Omit<DayEntry, 'date'>), date: e.date }
        })}
      />
      <Field label="수정 사유 (필수)"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 채널톡 완료보고 기준 07시 시작" /></Field>
      <ErrorBanner error={error} onDismiss={() => setError(undefined)} />
      <div className="flex gap-2">
        <Button onClick={() => { void apply() }} disabled={!reason.trim()}>수정하고 다시 계산</Button>
        <Button kind="ghost" onClick={onCancel}>취소</Button>
      </div>
    </div>
  )
}

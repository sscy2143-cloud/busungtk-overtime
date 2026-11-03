import { useState } from 'react'
import type { DayEntry, FlagDecision } from '../../data'
import { buildClaimDetail, formatHours } from '../../ui'
import { employeeName, useTrip } from '../context'
import { Button, Card, ErrorBanner, NoticeList, StatusPill } from '../parts'
import { DayPreviewCard } from '../DayPreviewCard'
import { claimDates, regionLabel } from '../helpers'
import { AdjustDayForm } from './AdjustDayForm'

type Tab = 'input' | 'calc' | 'history'

function entryLines(e: DayEntry): string[] {
  const out: string[] = []
  if (e.site) out.push(`현장 ${e.site.start}~${e.site.end}${e.site.endNextDay ? ' (다음 날)' : ''}`)
  out.push(`점심 ${e.lunchTaken === false ? '못 씀' : '사용'}`)
  if (e.office) out.push(`사무실 ${e.office.start}~${e.office.end}`)
  if (e.noSiteWork) out.push(`현장 작업 없음: ${e.noSiteWork.reason}`)
  if (e.travelStarts) out.push(`이동 출발 ${e.travelStarts.out ?? '—'} / 복귀 ${e.travelStarts.back ?? '—'}`)
  if (e.breaks?.length) out.push(`휴게 ${e.breaks.map((b) => `${b.start}~${b.end}`).join(', ')}`)
  if (e.directedWaits?.length) out.push(`지시 대기 ${e.directedWaits.map((b) => `${b.start}~${b.end}`).join(', ')}`)
  if (e.regions) out.push(`이날 지역 ${e.regions.map(regionLabel).join(' → ')}`)
  if (e.jeju) out.push(`제주 실제 이동 ${e.jeju.legs.map((b) => `${b.start}~${b.end}`).join(', ')} / 증빙 ${e.jeju.evidenceFileIds.length}건`)
  if (e.assemblyAt) out.push(`집결 ${e.assemblyAt}`)
  if (e.delay) out.push(`경유·지연 ${e.delay.hours}시간 / 증빙 ${e.delay.evidenceFileIds.length}건`)
  if (e.earlyLeaveDirected) out.push('회사 지시 조기 퇴근')
  if (e.actual) out.push(`실제 출발 ${e.actual.departAt ?? '—'} 도착 ${e.actual.arriveAt ?? '—'}${e.actual.arriveNextDay ? ' (다음 날)' : ''} (출처: ${e.actual.source})`)
  return out
}

/** 관리자 검토 상세 (T4). 승인은 화면에 보인 계산 결과 id 묶음에 고정된다 */
export function ClaimReviewDetail({ claimId, onBack }: { claimId: string; onBack: () => void }) {
  const { service, actor, employees, bump, revision } = useTrip()
  const [tab, setTab] = useState<Tab>('calc')
  const [decisions, setDecisions] = useState<FlagDecision[]>([])
  const [reason, setReason] = useState('')
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | undefined>()
  const [done, setDone] = useState<string | null>(null)

  const r = service.claimDetail(actor, claimId)
  if (!r.ok) {
    return <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4"><ErrorBanner error={{ code: r.code, message: r.message }} /><Button kind="ghost" onClick={onBack}>목록</Button></div>
  }
  const data = r.value
  const view = buildClaimDetail(data, decisions)
  const computeIssue = service.computeIssue(claimId)
  const { claim } = data
  const isSubmitted = claim.status === 'submitted'

  const toggle = (calcId: string, code: string, on: boolean) =>
    setDecisions((d) => on ? [...d, { calcId, code, decision: 'acknowledged' }] : d.filter((x) => !(x.calcId === calcId && x.code === code)))

  const act = async (action: 'approve' | 'reject' | 'return') => {
    const x = await service.review(actor, claimId, { action, expectedCalcIds: view.expectedCalcIds, flagDecisions: decisions, ...(reason.trim() ? { reason } : {}) })
    if (!x.ok) { setError({ code: x.code, message: x.message }); return }
    setError(undefined)
    setDone(action === 'approve' ? '승인했습니다. 승인은 지금 화면의 계산 결과에 묶였습니다' : action === 'return' ? '직원에게 되돌렸습니다' : '반려했습니다')
    bump()
  }

  const settlement = claim.status === 'approved' ? service.settlementPreview(actor, claimId) : null

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-32 pt-4" key={revision}>
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-dark-900">{employeeName(employees, claim.employeeId)} · {claimDates(claim)}</h2>
          <p className="text-sm text-dark-600">{claim.header.regions.map(regionLabel).join(' → ')} {claim.origin === 'companion_draft' && <span className="ml-1 text-xs text-sky-800">동행</span>}</p>
        </div>
        <div className="flex items-center gap-2"><StatusPill status={claim.status} /><Button kind="ghost" onClick={onBack}>목록</Button></div>
      </header>

      <ErrorBanner error={error} onAction={(a) => a === 'reload' && (setDecisions([]), setError(undefined), bump())} onDismiss={() => setError(undefined)} />
      {done && <NoticeList items={[done]} />}
      {computeIssue && <NoticeList tone="warn" items={[`서버 계산을 갱신하지 못했습니다 (${computeIssue.code}): ${computeIssue.message}. 화면의 계산 결과는 마지막으로 저장된 값입니다`]} />}
      {view.warnings.length > 0 && <NoticeList tone="warn" items={view.warnings} />}
      {view.proposedNote && <NoticeList tone="warn" items={[view.proposedNote]} />}

      <div className="flex gap-1 border-b border-dark-200">
        {([['calc', '계산 결과'], ['input', '입력 원본'], ['history', '이력']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`min-h-11 px-3 text-sm ${tab === k ? 'border-b-2 border-primary-500 font-semibold text-primary-700' : 'text-dark-600'}`}>{label}</button>
        ))}
      </div>

      {tab === 'calc' && view.days.map((d) => (
        <Card key={d.dayId} title={d.date}>
          <DayPreviewCard preview={d.preview} />
          {d.carryIn && <p className="mt-2 text-xs text-sky-900">← {d.carryIn.fromDate}에서 넘어옴: {d.carryIn.text}</p>}
          {d.carryOut && <p className="mt-1 text-xs text-sky-900">→ {d.carryOut.toDate}로 넘김: {d.carryOut.text} {d.carryOut.linked ? '(연결됨)' : '(다음 날 기록 없음)'}</p>}
          {d.items.length > 0 && (
            <div className="mt-3 space-y-2 rounded-lg bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">승인 전 확인 항목</p>
              {d.items.map((it) => (
                <label key={it.code} className="flex items-start gap-2 text-sm text-dark-800">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={it.acknowledged} disabled={!isSubmitted} onChange={(e) => toggle(it.calcId, it.code, e.target.checked)} />
                  <span>
                    <span className="font-medium">{it.title}</span>{it.undecidedRule && <span className="ml-1 text-xs text-amber-800">미확정 규칙 · 제안값</span>}
                    <span className="block text-xs text-dark-600">{it.message}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {isSubmitted && adjusting !== d.dayId && <div className="mt-3"><Button kind="secondary" onClick={() => setAdjusting(d.dayId)}>입력값 수정</Button></div>}
          {adjusting === d.dayId && (
            <div className="mt-3">
              <AdjustDayForm
                claimId={claimId} header={claim.header} day={data.days.find((x) => x.id === d.dayId)!}
                onDone={() => { setAdjusting(null); setDecisions([]); bump() }} onCancel={() => setAdjusting(null)}
              />
            </div>
          )}
        </Card>
      ))}

      {tab === 'input' && data.days.map((d) => (
        <Card key={d.id} title={`${d.date} (입력 ${d.revision}판)`}>
          <ul className="space-y-1 text-sm text-dark-800">{entryLines(d.entry).map((t) => <li key={t}>{t}</li>)}</ul>
        </Card>
      ))}

      {tab === 'history' && (
        <>
          <Card title="관리자 수정 이력">
            {data.adjustments.length === 0 ? <p className="text-sm text-dark-500">없음</p> : data.adjustments.map((a) => (
              <div key={a.id} className="border-t border-dark-100 py-2 text-sm first:border-t-0">
                <p className="text-dark-900">{a.at.slice(0, 16).replace('T', ' ')} · {employeeName(employees, a.adminId)} · {a.reason}</p>
                <p className="text-xs text-dark-500">전: {entryLines(a.before).join(' / ')}</p>
                <p className="text-xs text-dark-700">후: {entryLines(a.after).join(' / ')}</p>
              </div>
            ))}
          </Card>
          <Card title="검토 이력">
            {data.reviews.length === 0 ? <p className="text-sm text-dark-500">없음</p> : data.reviews.map((rv) => (
              <div key={rv.id} className="border-t border-dark-100 py-2 text-sm first:border-t-0">
                <p className="text-dark-900">{rv.at.slice(0, 16).replace('T', ' ')} · {employeeName(employees, rv.adminId)} · {rv.action === 'approve' ? '승인' : rv.action === 'return' ? '되돌림' : '반려'}{rv.reason ? ` — ${rv.reason}` : ''}</p>
                <p className="text-xs text-dark-500">묶인 계산 결과: {rv.calcIds.join(', ')} · 확인 {rv.flagDecisions.length}건</p>
              </div>
            ))}
            {view.approvedSnapshot && (
              <p className={`mt-2 text-xs ${view.approvedSnapshot.changedSinceApproval ? 'text-amber-800' : 'text-green-800'}`}>
                승인 당시 계산 결과 {view.approvedSnapshot.calcIds.length}건 보존됨{view.approvedSnapshot.changedSinceApproval ? ' — 그 뒤 계산이 바뀜' : ' — 현재와 같음'}
              </p>
            )}
          </Card>
          {settlement && settlement.ok && (
            <Card title="정산 미리보기 (급여 미반영)">
              <p className="mb-2 text-xs text-dark-600">{settlement.value.note}</p>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-dark-500"><th>날짜</th><th>확정</th><th>보류(제안값)</th></tr></thead>
                <tbody>
                  {settlement.value.days.map((d) => (
                    <tr key={d.calcId} className="border-t border-dark-100">
                      <td className="py-1">{d.date}</td>
                      <td className="py-1">{Object.entries(d.confirmed).map(([k, v]) => `${k} ${formatHours(v)}`).join(', ') || '—'}</td>
                      <td className="py-1 text-amber-900">{Object.entries(d.held).map(([k, v]) => `${k} ${formatHours(v)}`).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {isSubmitted && (
        <div className="fixed inset-x-0 bottom-0 border-t border-dark-200 bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-2xl space-y-2">
            <input className="h-11 w-full rounded-lg border border-dark-300 px-3 text-sm" placeholder="되돌림·반려 사유 (승인에는 선택)" value={reason} onChange={(e) => setReason(e.target.value)} />
            {view.blockers.length > 0 && <p className="text-xs text-dark-500">승인 불가: {view.blockers.join(' · ')}</p>}
            <div className="flex gap-2">
              <Button onClick={() => act('approve')} disabled={view.blockers.length > 0}>승인</Button>
              <Button kind="secondary" onClick={() => act('return')} disabled={!reason.trim()}>되돌림</Button>
              <Button kind="danger" onClick={() => act('reject')} disabled={!reason.trim()}>반려</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

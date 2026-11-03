import { useState } from 'react'
import { useTrip, employeeName } from './context'
import { Button, Card, ErrorBanner, NoticeList } from './parts'

/** 동행자에게 초안을 보낸다. 각자 확인하고 각자 제출한다 — 신청자가 대신 제출할 수 없다 */
export function CompanionInvite({ claimId }: { claimId: string }) {
  const { service, actor, employees, bump } = useTrip()
  const [picked, setPicked] = useState<string[]>([])
  const [result, setResult] = useState<{ created: string[]; skipped: { employeeId: string; reason: string }[] } | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | undefined>()
  const others = employees.filter((e) => e.id !== actor.id)

  const send = async () => {
    const r = await service.inviteCompanions(actor, claimId, picked)
    if (!r.ok) { setError({ code: r.code, message: r.message }); return }
    setResult(r.value)
    setPicked([])
    setError(undefined)
    bump()
  }

  return (
    <Card title="동행 출장">
      <p className="mb-2 text-xs text-dark-500">같은 지역·일정·현장 시각만 복사됩니다. 점심·휴게·사무실 근무는 각자 입력하고, 각자 제출해야 신청됩니다.</p>
      <ul className="space-y-1">
        {others.map((e) => (
          <li key={e.id}>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={picked.includes(e.id)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.id] : picked.filter((x) => x !== e.id))} />
              {e.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2"><Button kind="secondary" disabled={picked.length === 0} onClick={() => { void send() }}>초안 보내기</Button></div>
      {result && (
        <div className="mt-3 space-y-2">
          {result.created.length > 0 && <NoticeList items={[`초안 ${result.created.length}건을 보냈습니다. 동행자가 각자 확인·제출합니다`]} />}
          {result.skipped.length > 0 && <NoticeList tone="warn" items={result.skipped.map((s) => `${employeeName(employees, s.employeeId)}: ${s.reason}`)} />}
        </div>
      )}
      <div className="mt-3"><ErrorBanner error={error} onDismiss={() => setError(undefined)} /></div>
    </Card>
  )
}

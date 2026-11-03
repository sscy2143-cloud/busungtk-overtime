import { useState } from 'react'
import { employeeName, useTrip } from '../context'
import { Button, Card, ErrorBanner, Field, NoticeList, inputClass } from '../parts'

/**
 * 출장 내역 조회 권한 관리 (admin 전용).
 * - 대상: 활성 직원 중 admin 이 아닌 사람 전부. 운영 employees 에는 직급 칼럼이 없어(11-03 대조) "팀장" 여부는 admin 이 판단한다.
 * - 부여되는 것은 전체 출장 내역 "조회" 뿐. 수정·승인·반려·급여 반영은 어떤 권한으로도 열리지 않는다.
 * - 부여·회수에는 사유가 필요하고, 서버가 이력(trip_view_grant_history)을 남긴다.
 */
export function TripViewGrantsAdmin() {
  const { service, actor, employees, bump } = useTrip()
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<{ employeeId: string; enabled: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | undefined>()
  const [done, setDone] = useState<string | null>(null)

  if (actor.role !== 'admin') {
    return <div className="mx-auto max-w-2xl px-4 pt-4"><Card title="출장 조회 권한"><NoticeList items={['대표(admin)만 조회 권한을 관리할 수 있습니다']} /></Card></div>
  }
  const grants = service.viewGrants(actor)
  if (!grants.ok) return <div className="mx-auto max-w-2xl px-4 pt-4"><ErrorBanner error={{ code: grants.code, message: grants.message }} /></div>
  const granted = new Map(grants.value.map((g) => [g.employeeId, g]))
  const candidates = employees.filter((e) => e.id !== actor.id)

  const apply = async () => {
    if (!pending || busy) return
    setBusy(true)
    const r = await service.setViewGrant(actor, pending.employeeId, pending.enabled, note)
    setBusy(false)
    if (!r.ok) { setError({ code: r.code, message: r.message }); return }
    setError(undefined)
    setDone(`${employeeName(employees, pending.employeeId)}: 전체 출장 내역 조회 권한을 ${pending.enabled ? '부여' : '회수'}했습니다${r.value.changed ? '' : ' (이미 같은 상태였습니다)'}`)
    setPending(null)
    setNote('')
    bump()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-8 pt-4">
      <h2 className="text-lg font-bold text-dark-900">출장 내역 조회 권한</h2>
      <NoticeList items={['부여되는 것은 "전체 출장 내역 조회" 하나뿐입니다. 신청 수정·승인·반려·급여 반영 권한은 생기지 않습니다', '직원 명단에 직급 정보가 없어 팀장 여부는 직접 판단해 지정합니다']} />
      <ErrorBanner error={error} onDismiss={() => setError(undefined)} />
      {done && <NoticeList items={[done]} />}
      {candidates.length === 0 && <p className="text-sm text-dark-500">대상 직원이 없습니다</p>}
      {candidates.map((e) => {
        const g = granted.get(e.id)
        return (
          <Card key={e.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-dark-900">{e.name}</p>
                <p className="text-xs text-dark-500">{g ? `조회 권한 있음 · ${g.grantedAt.slice(0, 16).replace('T', ' ')} · ${employeeName(employees, g.grantedBy)} · ${g.note}` : '조회 권한 없음 (본인 신청만)'}</p>
              </div>
              <Button kind={g ? 'danger' : 'secondary'} onClick={() => { setPending({ employeeId: e.id, enabled: !g }); setDone(null) }} disabled={busy}>
                {g ? '회수' : '부여'}
              </Button>
            </div>
            {pending?.employeeId === e.id && (
              <div className="mt-3 space-y-2 rounded-lg bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">{employeeName(employees, e.id)}에게 전체 출장 내역 조회 권한을 {pending.enabled ? '부여' : '회수'}합니다</p>
                <Field label="사유 (필수, 이력에 남습니다)"><input className={inputClass} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={pending.enabled ? '예: 영업1팀 팀장 — 팀원 출장 확인' : '예: 팀장 보직 해제'} /></Field>
                <div className="flex gap-2">
                  <Button onClick={() => { void apply() }} disabled={busy || !note.trim()}>확인</Button>
                  <Button kind="ghost" onClick={() => { setPending(null); setNote('') }}>취소</Button>
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

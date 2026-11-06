import { useState } from 'react'
import { employeeName, useTrip } from '../context'
import { Button, Card, ErrorBanner, NoticeList } from '../parts'
import { comparePilot, parseManualCsv, toPilotCsv, type CsvIssue, type PilotReport } from '../../pilot'
import { PILOT_KEY_LABEL, PILOT_STATUS_LABEL, collectPilotSystemRows } from '../../ui'

/**
 * 시범 운영 수기 병행 비교 (admin 전용, 읽기 전용).
 * 승인된 신청의 시스템 계산 결과를 CSV 로 내려받아 담당자가 수기로 계산한 값과 같은 형식의 CSV 로 올려 대조한다.
 * 급여에는 어떤 값도 쓰지 않는다. 일치 여부는 참고용이며, 급여 반영 결정과 연결되지 않는다.
 */
export function PilotCompare() {
  const { service, actor, employees } = useTrip()
  const [text, setText] = useState('')
  const [issues, setIssues] = useState<CsvIssue[]>([])
  const [report, setReport] = useState<PilotReport | null>(null)

  if (actor.role !== 'admin') {
    return <div className="mx-auto max-w-2xl px-4 pt-4"><Card title="시범 비교"><NoticeList items={['대표(admin)만 사용할 수 있습니다']} /></Card></div>
  }
  const collected = collectPilotSystemRows(service, actor, (id) => employeeName(employees, id))
  if (!collected.ok) return <div className="mx-auto max-w-2xl px-4 pt-4"><ErrorBanner error={{ code: collected.code, message: collected.message }} /></div>
  const { rows, errors, claims } = collected.value
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + toPilotCsv(rows))}`

  const run = () => {
    const parsed = parseManualCsv(text)
    setIssues(parsed.issues)
    setReport(parsed.rows.length > 0 ? comparePilot(rows, parsed.rows) : null)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-8 pt-4">
      <h2 className="text-lg font-bold text-dark-900">시범 비교 (수기 계산과 대조)</h2>
      <NoticeList items={[
        '시범 운영 기간에 시스템 계산과 수기 계산을 나란히 놓고 같은지 확인하는 화면입니다. 급여에는 반영되지 않습니다',
        '아래 CSV 는 승인된 신청의 시스템 결과입니다. 회사 결정 전 값(제안값)은 heldKeys 열에 표시됩니다',
        '수기 계산표는 같은 열(ref, date, trip, nightTravel, overtime, nightOvertime, holidayWithin8, holidayOver8)로 만들어 붙여 넣거나 파일로 올립니다. 시간 단위, 비어 있으면 0',
      ]} />
      <Card title={`시스템 결과 — 승인된 신청 ${claims}건, ${rows.length}일`}>
        {errors.length > 0 && <NoticeList items={errors.map((e) => `정산 미리보기를 가져오지 못했습니다: ${e.message}`)} />}
        {rows.length === 0
          ? <p className="text-sm text-dark-500">승인된 신청이 아직 없습니다</p>
          : <a href={csvHref} download="trip-system-results.csv" className="inline-flex min-h-11 items-center rounded-lg border border-dark-300 px-4 text-sm font-medium text-dark-800">CSV 내려받기</a>}
      </Card>
      <Card title="수기 계산표 올리기">
        <input
          type="file" accept=".csv,text/csv" aria-label="수기 계산표 CSV 파일"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }}
          className="mb-2 block w-full text-sm"
        />
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="수기 계산표 CSV 내용"
          placeholder={'ref,date,trip,overtime\n홍길동,2026-11-09,4,'}
          className="w-full rounded-lg border border-dark-300 p-3 font-mono text-sm"
        />
        <div className="mt-2"><Button onClick={run} disabled={text.trim() === ''}>대조하기</Button></div>
      </Card>
      {issues.length > 0 && (
        <Card title="읽지 못한 줄" tone="warn">
          <NoticeList items={issues.map((i) => `${i.line}번째 줄: ${i.message}`)} />
        </Card>
      )}
      {report && (
        <Card title={`대조 결과 — 일치 ${report.summary.match} / 전체 ${report.summary.total} (${report.summary.matchRate ?? 0}%)`}>
          <p className="mb-2 text-xs text-dark-500">
            차이 {report.summary.diff} · 시스템에만 {report.summary.systemOnly} · 수기표에만 {report.summary.manualOnly}
            {report.summary.matchedWithHeld > 0 && ` · 일치하지만 회사 결정 전 값 포함 ${report.summary.matchedWithHeld}`}
          </p>
          <ul className="divide-y divide-dark-100">
            {report.rows.map((r) => (
              <li key={`${r.ref}|${r.date}`} className="py-2 text-sm">
                <p className="font-medium text-dark-900">{r.ref} · {r.date} — <span className={r.status === 'match' ? 'text-emerald-700' : 'text-amber-800'}>{PILOT_STATUS_LABEL[r.status]}</span>{r.merged && <span className="ml-2 text-xs text-dark-500">(여러 줄 합산)</span>}</p>
                {r.diffs.map((d) => (
                  <p key={d.key} className="text-xs text-dark-700">{PILOT_KEY_LABEL[d.key]}: 시스템 {d.system}시간 · 수기 {d.manual}시간 (차이 {d.diff > 0 ? '+' : ''}{d.diff}){d.fromHeld && ' — 회사 결정 전 값'}</p>
                ))}
                {r.heldKeys.length > 0 && <p className="text-xs text-amber-800">회사 결정 전 값 포함: {r.heldKeys.map((k) => PILOT_KEY_LABEL[k]).join(', ')}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

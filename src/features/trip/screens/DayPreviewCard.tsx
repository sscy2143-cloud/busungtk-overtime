import type { DayPreview } from '../ui'
import { ValuePill } from './parts'

/**
 * 하루 계산 결과 미리보기 — 직원 신청 화면과 관리자 상세가 같이 쓴다.
 * showDetails=false 면 계산 근거(표준 이동 구간)와 담당자용 안내(자정 넘김 자동 판단)를 숨긴다 (2026-11-25: 대표·인사담당만 보기)
 */
export function DayPreviewCard({ preview, compact = false, showDetails = true }: { preview: DayPreview; compact?: boolean; showDetails?: boolean }) {
  const p = preview
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-dark-800">{p.heading}</p>
      {p.prompts.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 p-2 text-amber-900">
          {p.prompts.map((t) => <li key={t}>❓ {t}</li>)}
        </ul>
      )}
      {p.errors.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-red-50 p-2 text-red-800">
          {p.errors.map((t) => <li key={t}>⚠ {t}</li>)}
        </ul>
      )}
      {p.rows.length > 0 && (
        <table className="w-full">
          <tbody>
            {p.rows.filter((r) => !compact || r.hours > 0 || r.label === '출장' || r.label === '연장').map((r) => (
              <tr key={r.label} className="border-t border-dark-100">
                <td className="py-1 pr-2 text-dark-600">{r.label}</td>
                <td className="py-1 text-right font-medium tabular-nums text-dark-900">{r.text}</td>
                <td className="py-1 pl-2 text-right"><ValuePill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showDetails && p.standardTravel.length > 0 && (
        <p className="text-xs text-dark-500">계산에 쓴 표준 이동 구간: {p.standardTravel.join(', ')} (실제 시각 아님)</p>
      )}
      {p.proposedNote && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{p.proposedNote}</p>}
      {p.flags.length > 0 && !compact && (
        <ul className="space-y-1 text-xs text-dark-700">
          {p.flags.map((f) => <li key={f.title + f.message}><span className="font-medium">{f.title}</span> <span className="text-dark-500">[{f.kind}]</span> — {f.message}</li>)}
        </ul>
      )}
      {(p.notices.length > 0 || (showDetails && p.staffNotices.length > 0)) && (
        <ul className="space-y-1 text-xs text-sky-900">
          {[...p.notices, ...(showDetails ? p.staffNotices : [])].map((t) => <li key={t}>ℹ {t}</li>)}
        </ul>
      )}
    </div>
  )
}

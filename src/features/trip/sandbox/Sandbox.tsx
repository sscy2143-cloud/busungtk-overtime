/**
 * 출장수당 화면 샌드박스 — 브라우저에서 직접 눌러 보는 로컬 시험 환경.
 *
 *  - 메모리 저장소만 쓴다. DB·네트워크·기존 앱 코드 없음. 새로고침하면 데이터가 사라진다.
 *  - 직원 A / 동행 B·C / 관리자 를 바꿔 가며 같은 저장소를 조작한다 (동행·검토 흐름 확인용).
 *  - 기능 스위치는 화면 안의 토글로만 바뀐다 (운영 플래그와 무관).
 */
import { useState } from 'react'
import { createMemoryRepository, type Actor, type FeatureKey, type HolidayCalendar } from '../data'
import { AdminTripReview, EmployeeTripScreen, TripScreenProvider } from '../screens'

const EMPLOYEES = [
  { id: 'emp-a', name: '김직원', role: 'employee' as const },
  { id: 'emp-b', name: '이동행', role: 'employee' as const },
  { id: 'emp-c', name: '최동행', role: 'employee' as const },
  { id: 'admin-1', name: '박관리', role: 'admin' as const },
]
const repo = createMemoryRepository()
const TODAY = new Date().toISOString().slice(0, 10)
const VERIFIED: HolidayCalendar = { holidays: new Set(['2026-12-25', '2027-01-01']), verified: true, source: '샌드박스 임시 달력 (검증 아님 — 시험용 표시)' }
const UNVERIFIED: HolidayCalendar = { holidays: new Set(), verified: false, source: 'none' }

export function Sandbox() {
  const [who, setWho] = useState(0)
  const [flags, setFlags] = useState<Partial<Record<FeatureKey, boolean>>>({ employeeForm: true, adminReview: true })
  const [verified, setVerified] = useState(false)
  const actor: Actor = { id: EMPLOYEES[who].id, role: EMPLOYEES[who].role }

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm">
        <strong className="text-amber-900">샌드박스 · 메모리 저장소 · 운영 아님</strong>
        <label>사용자
          <select className="ml-1 rounded border px-2 py-1" value={who} onChange={(e) => setWho(Number(e.target.value))}>
            {EMPLOYEES.map((e, i) => <option key={e.id} value={i}>{e.name} ({e.role})</option>)}
          </select>
        </label>
        {(['employeeForm', 'adminReview'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input type="checkbox" checked={flags[k] ?? false} onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))} />{k}
          </label>
        ))}
        <label className="flex items-center gap-1"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />달력 검증됨으로 표시</label>
      </div>
      <TripScreenProvider key={`${actor.id}-${JSON.stringify(flags)}-${verified}`} actor={actor} employees={EMPLOYEES} today={TODAY} repo={repo} flags={flags} calendar={verified ? VERIFIED : UNVERIFIED}>
        {actor.role === 'admin' ? <AdminTripReview /> : <EmployeeTripScreen />}
      </TripScreenProvider>
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { isDemoMode, supabase } from '../../lib/supabase'
import { NO_CALENDAR, type Actor } from '../../features/trip/data'
import { TripRemoteProvider } from '../../features/trip/screens'
import { todayIso, tripActorOf } from './trip-glue'

interface EmployeeRow { id: string; name: string; role: 'employee' | 'manager' | 'admin' }

/** 기존 세션의 access_token — 출장 모듈은 이 함수로만 토큰을 받는다 (키 자체는 모듈로 넘어가지 않는다) */
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export function TripClosedNotice({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      <div className="rounded-2xl border border-dark-100 bg-white p-6 text-center">
        <p className="font-semibold text-dark-800">{title}</p>
        <p className="mt-2 text-sm text-dark-500">출장수당 기능은 아직 열리지 않았습니다. 도입 공지 후 사용할 수 있습니다.</p>
      </div>
    </div>
  )
}

/**
 * 기존 앱의 세션·DB 설정을 출장 모듈의 TripRemoteProvider 에 넘긴다.
 *  - actor 는 기존 employees 행에서 (역할은 서버가 다시 확인). key={employee.id} 라 계정이 바뀌면 거울째 새로 만든다
 *  - revalidateKey 가 바뀌면 거울을 서버 값으로 다시 채운다 (조회 권한자 화면: 복귀·주기)
 *  - employees 목록은 동행자 선택·이름 표시용 (활성 직원의 id·이름·역할만, employees_directory 뷰)
 *  - 공휴일 달력은 서버 계산이 holidays 표로 판단한다. 화면 미리보기는 검증된 달력이 없으면 전부 "관리자 확인" 으로 표시 (NO_CALENDAR)
 */
export function TripConnected({ children, revalidateKey, quiet = false }: { children: ReactNode; revalidateKey?: number; quiet?: boolean }) {
  const { employee } = useAuth()
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode || !employee?.id) return
    let alive = true
    // 이름·역할만 필요하므로 이름 목록 뷰(employees_directory, 008a)를 읽는다 — base 표는 일반 직원에게 본인 행만 열린다
    supabase.from('employees_directory').select('id, name, role').eq('is_active', true).order('name')
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { setLoadError(error.message); setEmployees([]) }
        else setEmployees((data ?? []) as EmployeeRow[])
      })
    return () => { alive = false }
  }, [employee?.id])

  if (isDemoMode) return quiet ? null : <TripClosedNotice title="데모 모드에서는 출장 신청을 쓸 수 없습니다" />
  if (!employee) return null
  if (employees === null && quiet) return null
  if (employees === null) {
    return <div className="mx-auto max-w-lg px-4 pt-4"><p className="text-sm text-dark-500">불러오는 중…</p></div>
  }

  const actor: Actor = tripActorOf(employee)
  const list = (employees.some((e) => e.id === employee.id) ? employees : [...employees, { id: employee.id, name: employee.name, role: employee.role }])
    .map((e) => ({ id: e.id, name: e.name, role: e.role === 'admin' ? 'admin' as const : 'employee' as const }))

  return (
    <>
      {loadError && !quiet && <p className="mx-auto max-w-lg px-4 pt-2 text-xs text-amber-800">직원 목록을 불러오지 못했습니다 — 동행자 선택이 제한됩니다</p>}
      <TripRemoteProvider
        key={employee.id}
        revalidateKey={revalidateKey}
        quiet={quiet}
        baseUrl={import.meta.env.VITE_SUPABASE_URL}
        anonKey={import.meta.env.VITE_SUPABASE_ANON_KEY}
        getAccessToken={getAccessToken}
        actor={actor}
        employees={list}
        today={todayIso()}
        calendar={NO_CALENDAR}
        // 계산 근거(표준 이동 구간·자정 넘김 판단)는 대표·인사담당에게만 보인다 (2026-11-25 사용자 요청). 일반 직원·팀장(직원)에게는 숨김
        showCalcDetails={employee.role === 'admin' || employee.role === 'manager'}
      >
        {children}
      </TripRemoteProvider>
    </>
  )
}
